import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { SessionClaims } from "@/lib/auth/jwt";
import { ApiError } from "@/lib/api/errors";
import { getPseudonymHmacKey } from "@/lib/crypto/pseudonym";
import { getKekMaterial } from "@/lib/crypto/kek";
import { decodeAdaptiveCipher, decryptTicketPayload, encodeAdaptiveCipher, encryptTicketPayload, type AdaptiveCipher } from "@/lib/crypto/ticket-cipher";
import { ADUAN_CLOSED_STATUS, RETENTION_DAYS_BY_RISK, type AduanCategory, type AduanStatus, type AuditAction } from "@/lib/domain/enums";
import { getRiskBand } from "@/lib/crypto/adaptive";
import { assertFreshMfa, assertSessionContext, assertStaffAccess, submissionRisk, type StaffAccess } from "@/lib/ztna/access-policy";
import { canTransitionStatus } from "@/lib/ticket-workflow";
import type { TicketMetadata } from "@/lib/ticket-types";
import { resolveActorId } from "./actors";
import { withActorContext } from "./client";
import type { Aduan, Database } from "./types";

const metadataColumns = ["id", "ticket_code", "pseudonym_id", "category", "status", "risk_score", "risk_band", "title_masked", "kek_version", "row_version", "closed_at", "created_at", "updated_at"] as const;
const cipherColumns = ["body_ciphertext", "body_iv", "body_auth_tag", "dek_wrapped", "dek_wrap_iv", "dek_wrap_auth_tag", "aad_context", "crypto_algorithm"] as const;
type TicketRow = Pick<Aduan, typeof metadataColumns[number]>;
type EncryptedRow = TicketRow & Pick<Aduan, typeof cipherColumns[number]>;
type Context = { trx: Kysely<Database>; session: SessionClaims; pseudonym: string | null; profile?: StaffAccess };
export interface TimelineEntry { id: string; fromStatus: AduanStatus | null; toStatus: AduanStatus; actorRole: string | null; createdAt: string }
export interface ReplyView { id: string; authorRole: string; body: string; createdAt: string }
export interface TicketDetail { ticket: TicketMetadata; body?: string; timeline: TimelineEntry[] }

function pseudonymFor(identity: string): string {
  const key = Buffer.from(getPseudonymHmacKey(), "base64");
  if (key.length < 32) throw new ApiError(503, "Konfigurasi kunci pseudonim tidak valid.");
  return createHmac("sha256", key).update(identity.trim().toLowerCase()).digest("hex");
}

function keyMaterial(version?: number): Buffer {
  const active = Number(process.env.KEK_ACTIVE_VERSION ?? "1");
  const configured = version && version !== active ? process.env[`KEK_MASTER_V${version}_BASE64`] : undefined;
  const key = version && version !== active ? (configured ? Buffer.from(configured, "base64") : null) : getKekMaterial();
  if (!key || key.length !== 32) throw new ApiError(503, "Material kunci untuk data ini belum tersedia.", "KEY_UNAVAILABLE");
  return key;
}

function bodyAad(ticket: string, pseudonym: string, category: string, risk: number): string {
  return JSON.stringify(["triase-ticket-v1", ticket, pseudonym, category, risk]);
}

function replyAad(ticket: TicketRow, id: string, role: string, pseudonym: string | null): string {
  return JSON.stringify(["triase-reply-v1", ticket.ticket_code, id, role, pseudonym, ticket.risk_score]);
}

function view(row: TicketRow): TicketMetadata {
  return { ticketId: row.ticket_code, pseudonym: `PS-${row.pseudonym_id.slice(0, 16).toUpperCase()}`, subject: row.title_masked ?? row.category,
    category: row.category, riskBand: row.risk_band, status: row.status, rowVersion: row.row_version, closedAt: row.closed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

async function audit(ctx: Context, action: AuditAction, decision: "ALLOW" | "DENY" | "CHALLENGE", row?: { id: string; ticket_code: string; risk_score: number }, reason?: string) {
  const id = randomUUID();
  const trace = randomUUID();
  // Allocate the audit sequence only after taking the chain lock.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended('global', 0))`.execute(ctx.trx);
  await sql`INSERT INTO public.ztna_audit_logs
    (id, trace_id, action, decision, ztna_risk_score, resource_type, resource_id, ticket_code, reason_code, mfa_verified, auth_method)
    VALUES (${id}::uuid, ${trace}::uuid, ${action}::public.audit_action, ${decision}::public.audit_decision,
      ${row?.risk_score ?? 0}, 'aduan', ${row?.id ?? null}, ${row?.ticket_code ?? null}, ${reason ?? null}, true, 'TOTP')`.execute(ctx.trx);
  return { id, trace };
}

async function actor<T>(session: SessionClaims, userAgent: string, work: (ctx: Context) => Promise<T>): Promise<T> {
  assertSessionContext(session, userAgent);
  const id = await resolveActorId(session.email ?? session.sub, session.role);
  if (id !== session.userId) throw new ApiError(401, "Identitas akun berubah. Silakan masuk ulang.");
  const pseudonym = session.role === "MAHASISWA" ? pseudonymFor(session.email ?? session.sub) : null;
  const context = { userId: id, role: session.role, pseudonymId: pseudonym };
  const result = await withActorContext(context, async (trx) => {
    const ctx: Context = { trx, session, pseudonym };
    if (session.role !== "MAHASISWA") {
      ctx.profile = await trx.selectFrom("satgas_profiles").select(["authorized_categories", "max_decrypt_risk_score", "duty_status", "expires_at", "requires_step_up", "kek_access_version"])
        .where("user_id", "=", id).executeTakeFirst();
      try { assertStaffAccess(ctx.profile); }
      catch (error) {
        await audit(ctx, "ZTNA_BLOCK", "DENY", undefined, "STAFF_OFF_DUTY");
        return { failed: error } as const;
      }
    }
    return { value: await work(ctx) } as const;
  }).catch(async (error: unknown) => {
    if (error instanceof ApiError) {
      await withActorContext(context, (trx) => audit({ trx, session, pseudonym }, "ZTNA_BLOCK",
        error.code === "STEP_UP_REQUIRED" ? "CHALLENGE" : "DENY", undefined, error.code));
    }
    throw error;
  });
  if ("failed" in result) throw result.failed;
  return result.value;
}

async function find(ctx: Context, code: string, lock = false): Promise<EncryptedRow> {
  let query = ctx.trx.selectFrom("aduan").select([...metadataColumns, ...cipherColumns]).where("ticket_code", "=", code);
  if (lock) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) throw new ApiError(404, "Tiket tidak ditemukan.");
  return row;
}

function sensitiveAccess(ctx: Context, row: TicketRow): void {
  if (ctx.session.role === "MAHASISWA") return;
  assertStaffAccess(ctx.profile, row.category, row.risk_score, row.kek_version);
  assertFreshMfa(ctx.session, !!ctx.profile?.requires_step_up || row.risk_score >= 70);
}

async function cipherFor(ctx: Context, row: EncryptedRow): Promise<AdaptiveCipher> {
  const layers = await ctx.trx.selectFrom("aduan_crypto_layers")
    .select(["layer_index", "algorithm", "ciphertext", "iv", "auth_tag", "wrapped_dek", "wrapped_dek_iv", "wrapped_dek_tag", "aad_context", "kek_version"])
    .where("aduan_id", "=", row.id).orderBy("layer_index").execute();
  if ((row.crypto_algorithm === "HYBRID_DOUBLE" && (layers.length !== 1 || layers[0]?.layer_index !== 2 || layers[0].algorithm !== "AES_256_GCM" || layers[0].kek_version !== row.kek_version)) || (row.crypto_algorithm !== "HYBRID_DOUBLE" && layers.length)) {
    throw new ApiError(422, "Lapisan enkripsi tidak lengkap atau tidak valid.");
  }
  const outer = layers[0];
  return {
    algorithm: row.crypto_algorithm,
    primary: { ciphertext: row.body_ciphertext, iv: row.body_iv, tag: row.body_auth_tag, wrappedDek: row.dek_wrapped, wrapIv: row.dek_wrap_iv, wrapTag: row.dek_wrap_auth_tag, aad: row.aad_context },
    outer: outer ? { ciphertext: outer.ciphertext, iv: outer.iv, tag: outer.auth_tag, wrappedDek: outer.wrapped_dek, wrapIv: outer.wrapped_dek_iv, wrapTag: outer.wrapped_dek_tag, aad: outer.aad_context } : null,
  };
}

async function plaintext(ctx: Context, row: EncryptedRow): Promise<{ subject: string; body: string }> {
  const key = keyMaterial(row.kek_version);
  const cipher = await cipherFor(ctx, row);
  try {
    return z.object({ subject: z.string(), body: z.string() }).parse(JSON.parse(decryptTicketPayload(key, cipher, row.risk_score, bodyAad(row.ticket_code, row.pseudonym_id, row.category, row.risk_score))));
  } catch { throw new ApiError(422, "Isi aduan gagal diverifikasi. Data atau kunci tidak cocok.", "CIPHERTEXT_INVALID"); }
}

async function history(ctx: Context, row: TicketRow, from: AduanStatus | null, log: { id: string; trace: string }) {
  await ctx.trx.insertInto("aduan_status_history").values({
    aduan_id: row.id, from_status: from, to_status: row.status, reason_code: from ? `STATUS_${row.status}` : "SUBMITTED",
    changed_by: ctx.session.userId!, changed_by_role: ctx.session.role, changed_by_pseudonym_id: ctx.pseudonym,
    ztna_audit_id: log.id, trace_id: log.trace,
  }).execute();
}

export async function listTickets(session: SessionClaims, userAgent: string): Promise<TicketMetadata[]> {
  return actor(session, userAgent, async (ctx) => {
    const rows = await ctx.trx.selectFrom("aduan").select(metadataColumns).orderBy("created_at", "desc").orderBy("id", "desc").execute();
    await audit(ctx, "ADUAN_METADATA_READ", "ALLOW");
    return rows.map(view);
  });
}

export async function createTicket(session: SessionClaims, userAgent: string, input: { subject: string; category: AduanCategory; body: string }) {
  if (session.role !== "MAHASISWA") throw new ApiError(403, "Hanya mahasiswa yang dapat membuat aduan.");
  return actor(session, userAgent, async (ctx) => {
    const id = randomUUID();
    const code = `TRX-${new Date().getUTCFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
    const risk = submissionRisk(input.category, session);
    const version = Number(process.env.KEK_ACTIVE_VERSION ?? "1");
    const registered = await ctx.trx.selectFrom("kek_versions").select("version").where("version", "=", version).where("status", "=", "ACTIVE").executeTakeFirst();
    if (!registered) throw new ApiError(503, "Versi kunci aktif belum terdaftar di database.");
    const aad = bodyAad(code, ctx.pseudonym!, input.category, risk);
    const encrypted = encryptTicketPayload(keyMaterial(), JSON.stringify({ subject: input.subject, body: input.body }), risk, aad);
    const p = encrypted.primary;
    const created = new Date();
    await ctx.trx.insertInto("aduan").values({
      id, ticket_code: code, pseudonym_id: ctx.pseudonym!, category: input.category,
      risk_score: risk, ztna_risk_score: risk, crypto_algorithm: encrypted.algorithm,
      risk_factors: { category: input.category, policy: "submission-v1" },
      body_ciphertext: p.ciphertext, body_iv: p.iv, body_auth_tag: p.tag, dek_wrapped: p.wrappedDek,
      dek_wrap_iv: p.wrapIv, dek_wrap_auth_tag: p.wrapTag, kek_version: version, aad_context: p.aad,
      title_masked: `Aduan ${input.category.toLowerCase().replaceAll("_", " ")}`,
      retention_expires_at: new Date(created.getTime() + RETENTION_DAYS_BY_RISK[getRiskBand(risk)] * 86400_000),
    }).execute();
    if (encrypted.outer) {
      const o = encrypted.outer;
      await ctx.trx.insertInto("aduan_crypto_layers").values({
        aduan_id: id, layer_index: 2, algorithm: "AES_256_GCM", ciphertext: o.ciphertext, iv: o.iv, auth_tag: o.tag,
        wrapped_dek: o.wrappedDek, wrapped_dek_iv: o.wrapIv, wrapped_dek_tag: o.wrapTag, kek_version: version, aad_context: o.aad,
      }).execute();
    }
    const row = await find(ctx, code);
    const log = await audit(ctx, "ADUAN_SUBMIT", "ALLOW", row);
    await history(ctx, row, null, log);
    return view(row);
  });
}

export async function ticketDetail(session: SessionClaims, userAgent: string, code: string): Promise<TicketDetail> {
  return actor(session, userAgent, async (ctx) => {
    const row = await find(ctx, code);
    const timeline = await ctx.trx.selectFrom("aduan_status_history").select(["id", "from_status", "to_status", "changed_by_role", "changed_at"])
      .where("aduan_id", "=", row.id).orderBy("changed_at").orderBy("id").execute();
    const detail: TicketDetail = { ticket: view(row), timeline: timeline.map((item) => ({ id: item.id, fromStatus: item.from_status, toStatus: item.to_status, actorRole: item.changed_by_role, createdAt: item.changed_at.toISOString() })) };
    if (session.role === "MAHASISWA") {
      const data = await plaintext(ctx, row);
      detail.body = data.body;
      detail.ticket.subject = data.subject;
    }
    await audit(ctx, "ADUAN_METADATA_READ", "ALLOW", row);
    return detail;
  });
}

export async function changeTicketStatus(session: SessionClaims, userAgent: string, code: string, status: AduanStatus, expectedVersion: number) {
  if (session.role === "MAHASISWA") throw new ApiError(403, "Akses staf diperlukan.");
  return actor(session, userAgent, async (ctx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${code}, 0))`.execute(ctx.trx);
    const row = await find(ctx, code, true);
    assertStaffAccess(ctx.profile, row.category, row.risk_score, row.kek_version);
    if (row.row_version !== expectedVersion) throw new ApiError(409, "Status sudah diubah petugas lain. Muat ulang antrean.", "STALE_VERSION");
    if (!canTransitionStatus(row.status, status)) throw new ApiError(409, "Perpindahan status tidak diizinkan.", "INVALID_TRANSITION");
    const log = await audit(ctx, "ADUAN_STATUS_CHANGE", "ALLOW", row);
    await ctx.trx.updateTable("aduan").set({ status, closed_at: ADUAN_CLOSED_STATUS.includes(status) ? new Date() : null })
      .where("id", "=", row.id).where("row_version", "=", expectedVersion).executeTakeFirstOrThrow();
    const updated = await find(ctx, code);
    await history(ctx, updated, row.status, log);
    return view(updated);
  });
}

export async function decryptTicket(session: SessionClaims, userAgent: string, code: string) {
  if (session.role === "MAHASISWA") throw new ApiError(403, "Akses staf diperlukan.");
  const result = await actor(session, userAgent, async (ctx) => {
    let row: EncryptedRow | undefined;
    try {
      row = await find(ctx, code);
      sensitiveAccess(ctx, row);
      const data = await plaintext(ctx, row);
      const log = await audit(ctx, "ADUAN_DECRYPT", "ALLOW", row);
      return { data: { ...data, audit: { id: log.id, at: new Date().toISOString() }, keyId: `kek-${row.kek_version}` } };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      await audit(ctx, "ADUAN_DECRYPT_DENIED", error.code === "STEP_UP_REQUIRED" ? "CHALLENGE" : "DENY", row, error.code);
      return { error };
    }
  });
  if (result.error) throw result.error;
  return result.data!;
}

export async function listReplies(session: SessionClaims, userAgent: string, code: string, before?: { at: string; id: string }) {
  return actor(session, userAgent, async (ctx) => {
    const row = await find(ctx, code);
    sensitiveAccess(ctx, row);
    let query = ctx.trx.selectFrom("aduan_replies").select(["id", "author_role", "author_pseudonym_id", "payload", "kek_version", "created_at"])
      .where("aduan_id", "=", row.id);
    if (before) query = query.where(sql<boolean>`(created_at, id) < (${before.at}::timestamptz, ${before.id}::uuid)`);
    const replies = await query.orderBy("created_at", "desc").orderBy("id", "desc").limit(51).execute();
    const page = replies.slice(0, 50);
    const items = page.map((reply): ReplyView => {
      try {
        return { id: reply.id, authorRole: reply.author_role, createdAt: reply.created_at.toISOString(), body: decryptTicketPayload(keyMaterial(reply.kek_version), decodeAdaptiveCipher(reply.payload), row.risk_score, replyAad(row, reply.id, reply.author_role, reply.author_pseudonym_id)) };
      } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(422, "Balasan gagal diverifikasi."); }
    }).reverse();
    const last = page.at(-1);
    await audit(ctx, "ADUAN_DECRYPT", "ALLOW", row, "REPLIES_READ");
    return { items, nextCursor: replies.length > 50 && last ? { at: last.created_at.toISOString(), id: last.id } : null };
  });
}

export async function addReply(session: SessionClaims, userAgent: string, code: string, body: string, id: string) {
  return actor(session, userAgent, async (ctx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${code}, 0))`.execute(ctx.trx);
    const row = await find(ctx, code);
    sensitiveAccess(ctx, row);
    if (ADUAN_CLOSED_STATUS.includes(row.status)) throw new ApiError(409, "Percakapan ditutup. Aduan harus dibuka kembali oleh petugas.");
    const existing = await ctx.trx.selectFrom("aduan_replies").select(["id", "author_role", "author_pseudonym_id", "payload", "kek_version"])
      .where("id", "=", id).where("aduan_id", "=", row.id).executeTakeFirst();
    if (existing) {
      if (existing.author_role !== session.role || existing.author_pseudonym_id !== ctx.pseudonym || decryptTicketPayload(keyMaterial(existing.kek_version), decodeAdaptiveCipher(existing.payload), row.risk_score, replyAad(row, id, session.role, ctx.pseudonym)) !== body) {
        throw new ApiError(409, "ID balasan sudah digunakan untuk pesan lain.");
      }
      return { id };
    }
    const version = Number(process.env.KEK_ACTIVE_VERSION ?? "1");
    const registered = await ctx.trx.selectFrom("kek_versions").select("version").where("version", "=", version).where("status", "=", "ACTIVE").executeTakeFirst();
    if (!registered) throw new ApiError(503, "Versi kunci aktif belum terdaftar.");
    if (ctx.profile) assertStaffAccess(ctx.profile, row.category, row.risk_score, version);
    const payload = encodeAdaptiveCipher(encryptTicketPayload(keyMaterial(), body, row.risk_score, replyAad(row, id, session.role, ctx.pseudonym)));
    const log = await audit(ctx, "ADUAN_REPLY", "ALLOW", row);
    await ctx.trx.insertInto("aduan_replies").values({ id, aduan_id: row.id, author_role: session.role, author_pseudonym_id: ctx.pseudonym, payload, kek_version: version, ztna_audit_id: log.id }).execute();
    return { id };
  });
}
