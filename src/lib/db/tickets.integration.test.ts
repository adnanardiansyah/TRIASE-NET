import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { addReply, changeTicketStatus, createTicket, decryptTicket, listReplies, listTickets, ticketDetail, listNotifications, readNotifications } from "./tickets";
import { closeDb, getDb, withActorContext } from "./client";
import { deviceHash } from "@/lib/ztna/access-policy";
import type { SessionClaims } from "@/lib/auth/jwt";

const url = process.env.TRIASE_INTEGRATION_DATABASE_URL;
const ua = "integration-browser";
const studentId = randomUUID();
const otherId = randomUUID();
const staffId = randomUUID();
function session(userId: string, email: string, role: SessionClaims["role"]): SessionClaims {
  return { sub: email, email, role, userId, authVersion: 1, authMethod: role === "MAHASISWA" ? "PASSWORD" : "TOTP", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, mfaVerifiedAt: Math.floor(Date.now() / 1000), deviceHash: deviceHash(ua) };
}
const owner = session(studentId, `owner-${studentId}@example.test`, "MAHASISWA");
const other = session(otherId, `other-${otherId}@example.test`, "MAHASISWA");
const staff = session(staffId, `staff-${staffId}@example.test`, "SATGAS");
let admin: Pool;

describe.skipIf(!url)("PostgreSQL runtime workflow (isolated database)", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 });
    await admin.query("INSERT INTO public.kek_versions(version,label,key_reference) VALUES (1,'test','local://integration') ON CONFLICT(version) DO NOTHING");
    for (const actor of [owner, other, staff]) {
      await admin.query(`INSERT INTO public.users(id, role, status, institutional_email, display_name, password_hash)
        VALUES ($1,$2,'ACTIVE',$3,$4,$5)`, [actor.userId, actor.role, actor.email, actor.role === "SATGAS" ? "Staff test" : null, actor.role === "SATGAS" ? await hash(randomUUID()) : null]);
      await admin.query("INSERT INTO public.account_credentials(user_id,password_hash,email_verified_at) VALUES ($1,$2,now())", [actor.userId, await hash(randomUUID())]);
    }
    await admin.query(`INSERT INTO public.satgas_profiles(user_id,employee_id,unit_name,authorized_categories,max_decrypt_risk_score,duty_status,requires_step_up)
      VALUES ($1,'TEST','Testing',enum_range(NULL::public.aduan_category),100,'ON_DUTY',true)`, [staffId]);
    // Each pooled connection executes as the restricted runtime role, never as postgres.
    const role = await sql<{ safe: boolean }>`SELECT pg_has_role(current_user, 'triase_app', 'MEMBER') AND NOT rolsuper AND NOT rolbypassrls AS safe FROM pg_roles WHERE rolname=current_user`.execute(getDb());
    expect(role.rows[0]?.safe).toBe(true);
  });
  afterAll(async () => { await closeDb(); await admin?.end(); });

  it("persists all three cipher bands and hides bodies and reporter identity from staff metadata", async () => {
    for (const [category, band] of [["FASILITAS", "LOW"], ["KEUANGAN", "MEDIUM"], ["KEAMANAS_INFORMASI", "HIGH"]] as const) {
      const created = await createTicket(owner, ua, { subject: "Sensitive title", category, body: "Secret body" });
      expect(created.riskBand).toBe(band);
      const detail = await ticketDetail(owner, ua, created.ticketId);
      expect(detail.body).toBe("Secret body");
      expect(detail.ticket.subject).toBe("Sensitive title");
      expect(detail.timeline).toHaveLength(1);
      expect(detail.ticket.status).toBe("DITERIMA");
      const decoded = await decryptTicket(staff, ua, created.ticketId);
      expect(decoded.body).toBe("Secret body");
      await expect(ticketDetail(other, ua, created.ticketId)).rejects.toMatchObject({ status: 404 });
    }
    const metadata = JSON.stringify(await listTickets(staff, ua));
    expect(metadata).not.toContain("Secret body");
    expect(metadata).not.toContain("Sensitive title");
    expect(metadata).not.toContain(owner.email);
    const raw = await admin.query("SELECT body_ciphertext, title_masked, pseudonym_id FROM public.aduan");
    expect(raw.rows.every((r) => /^[0-9a-f]{64}$/.test(r.pseudonym_id))).toBe(true);
    expect(raw.rows.every((r) => !r.body_ciphertext.toString().includes("Secret body"))).toBe(true);
    await closeDb();
    expect((await listTickets(owner, ua)).length).toBe(3);
  });

  it("records transitions atomically, rejects stale versions, and closes and reopens conversation", async () => {
    const created = await createTicket(owner, ua, { subject: "Workflow", category: "FASILITAS", body: "body" });
    await expect(changeTicketStatus(staff, ua, created.ticketId, "SELESAI", 0)).rejects.toMatchObject({ status: 409 });
    const started = await changeTicketStatus(staff, ua, created.ticketId, "DALAM_PENANGANAN", 0);
    expect(started.rowVersion).toBe(1);
    await expect(changeTicketStatus(staff, ua, created.ticketId, "SELESAI", 0)).rejects.toMatchObject({ code: "STALE_VERSION" });
    const resolved = await changeTicketStatus(staff, ua, created.ticketId, "SELESAI", 1);
    await expect(addReply(owner, ua, created.ticketId, "Reply", randomUUID())).rejects.toMatchObject({ status: 409 });
    const reopened = await changeTicketStatus(staff, ua, created.ticketId, "DALAM_PENANGANAN", resolved.rowVersion!);
    expect(reopened.status).toBe("DALAM_PENANGANAN");
    const detail = await ticketDetail(owner, ua, created.ticketId);
    expect(detail.timeline.map((h) => h.toStatus)).toEqual(["DITERIMA", "DALAM_PENANGANAN", "SELESAI", "DALAM_PENANGANAN"]);
    const raw = await admin.query("SELECT closed_at FROM public.aduan WHERE ticket_code=$1", [created.ticketId]);
    expect(raw.rows[0].closed_at).toBeNull();
  });

  it("encrypts two-way replies, prevents duplicate submissions, and denies other owners", async () => {
    const ticket = await createTicket(owner, ua, { subject: "Replies", category: "KEAMANAS_INFORMASI", body: "body" });
    const id = randomUUID();
    await addReply(owner, ua, ticket.ticketId, "Student secret", id);
    await addReply(owner, ua, ticket.ticketId, "Student secret", id);
    await addReply(staff, ua, ticket.ticketId, "Staff secret", randomUUID());
    const result = await listReplies(owner, ua, ticket.ticketId);
    expect(result.items.map((m) => m.body)).toEqual(["Student secret", "Staff secret"]);
    expect(result.items.map((m) => m.authorRole)).toEqual(["MAHASISWA", "SATGAS"]);
    await expect(addReply(other, ua, ticket.ticketId, "Unauthorized", randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(addReply(owner, ua, ticket.ticketId, "Changed payload", id)).rejects.toMatchObject({ status: 409 });
    const raw = await admin.query("SELECT payload FROM public.aduan_replies WHERE id=$1", [id]);
    expect(JSON.stringify(raw.rows)).not.toContain("Student secret");
  });

  it("serializes competing status changes and duplicate replies", async () => {
    const ticket = await createTicket(owner, ua, { subject: "Concurrent", category: "FASILITAS", body: "body" });
    const changes = await Promise.allSettled([
      changeTicketStatus(staff, ua, ticket.ticketId, "DALAM_PENANGANAN", 0),
      changeTicketStatus(staff, ua, ticket.ticketId, "DITOLAK", 0),
    ]);
    expect(changes.filter((change) => change.status === "fulfilled")).toHaveLength(1);
    expect(changes.filter((change) => change.status === "rejected")).toHaveLength(1);
    const open = await createTicket(owner, ua, { subject: "Concurrent reply", category: "FASILITAS", body: "body" });
    const id = randomUUID();
    await Promise.all([addReply(owner, ua, open.ticketId, "Once", id), addReply(owner, ua, open.ticketId, "Once", id)]);
    expect((await listReplies(owner, ua, open.ticketId)).items).toHaveLength(1);
  });

  it("paginates replies with a stable timestamp/id cursor", async () => {
    const ticket = await createTicket(owner, ua, { subject: "Pagination", category: "FASILITAS", body: "body" });
    for (let index = 0; index < 52; index++) await addReply(owner, ua, ticket.ticketId, `Reply ${index}`, randomUUID());
    const latest = await listReplies(owner, ua, ticket.ticketId);
    expect(latest.items).toHaveLength(50);
    expect(latest.nextCursor).not.toBeNull();
    const older = await listReplies(owner, ua, ticket.ticketId, latest.nextCursor!);
    expect(older.items).toHaveLength(2);
    expect(older.nextCursor).toBeNull();
    expect(new Set([...older.items, ...latest.items].map((reply) => reply.id)).size).toBe(52);
  });

  it("enforces fresh MFA, active duty, category clearance, account status, and audits denials", async () => {
    const created = await createTicket(owner, ua, { subject: "Access", category: "FASILITAS", body: "body" });
    await expect(decryptTicket({ ...staff, mfaVerifiedAt: Math.floor(Date.now() / 1000) - 901 }, ua, created.ticketId)).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
    await admin.query("UPDATE public.satgas_profiles SET duty_status='OFF_DUTY' WHERE user_id=$1", [staffId]);
    await expect(decryptTicket(staff, ua, created.ticketId)).rejects.toMatchObject({ code: "STAFF_OFF_DUTY" });
    await admin.query("UPDATE public.satgas_profiles SET duty_status='ON_DUTY', authorized_categories=ARRAY['KEUANGAN']::public.aduan_category[] WHERE user_id=$1", [staffId]);
    await expect(decryptTicket(staff, ua, created.ticketId)).rejects.toMatchObject({ status: 404 });
    await admin.query("UPDATE public.satgas_profiles SET authorized_categories=enum_range(NULL::public.aduan_category) WHERE user_id=$1", [staffId]);
    await admin.query("UPDATE public.users SET status='SUSPENDED' WHERE id=$1", [staffId]);
    await expect(decryptTicket(staff, ua, created.ticketId)).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
    await admin.query("UPDATE public.users SET status='ACTIVE' WHERE id=$1", [staffId]);
    const logs = await admin.query("SELECT count(*)::int AS total FROM public.ztna_audit_logs WHERE decision IN ('DENY','CHALLENGE')");
    expect(logs.rows[0].total).toBeGreaterThanOrEqual(3);
  });

  it("scopes notification metadata and persists idempotent per-account read receipts", async () => {
    const ticket = await createTicket(owner, ua, { subject: "Private notification title", category: "FASILITAS", body: "Private notification body" });
    const created = (await listNotifications(staff, ua)).find((item) => item.ticketId === ticket.ticketId && item.kind === "SUBMITTED");
    expect(created).toBeDefined();
    expect((await listNotifications(owner, ua)).some((item) => item.ticketId === ticket.ticketId)).toBe(false);
    await changeTicketStatus(staff, ua, ticket.ticketId, "DALAM_PENANGANAN", ticket.rowVersion!);
    await addReply(staff, ua, ticket.ticketId, "Private staff reply", randomUUID());
    const feed = (await listNotifications(owner, ua)).filter((item) => item.ticketId === ticket.ticketId);
    expect(feed.map((item) => item.kind).sort()).toEqual(["REPLY", "STATUS"]);
    expect(JSON.stringify(feed)).not.toMatch(/Private|@example|PS-/);
    expect(feed.every((item) => !item.read)).toBe(true);
    expect((await listNotifications(other, ua)).some((item) => item.ticketId === ticket.ticketId)).toBe(false);
    await expect(readNotifications(other, ua, [feed[0]!.id])).rejects.toMatchObject({ status: 404 });
    await readNotifications(owner, ua, feed.map((item) => item.id));
    await readNotifications(owner, ua, [feed[0]!.id, feed[0]!.id]);
    await closeDb();
    expect((await listNotifications(owner, ua)).filter((item) => item.ticketId === ticket.ticketId).every((item) => item.read)).toBe(true);
    await expect(withActorContext({ userId: otherId, role: "MAHASISWA" }, (trx) => trx.insertInto("notification_reads")
      .values({ user_id: studentId, notification_key: "forged-receipt" }).execute())).rejects.toMatchObject({ code: "42501" });
    const invisible = await withActorContext({ userId: otherId, role: "MAHASISWA" }, (trx) => trx.selectFrom("notification_reads").selectAll().where("user_id", "=", studentId).execute());
    expect(invisible).toHaveLength(0);
  });

  it("limits staff notifications by category and duty and removes overdue alerts on closure", async () => {
    const ticket = await createTicket(owner, ua, { subject: "Deadline", category: "FASILITAS", body: "body" });
    await admin.query("UPDATE public.aduan SET created_at=now()-interval '20 days' WHERE ticket_code=$1", [ticket.ticketId]);
    expect((await listNotifications(staff, ua)).some((item) => item.ticketId === ticket.ticketId && item.kind === "OVERDUE")).toBe(true);
    expect((await listNotifications(owner, ua)).some((item) => item.kind === "OVERDUE")).toBe(false);
    try {
      await admin.query("UPDATE public.satgas_profiles SET authorized_categories=ARRAY['KEUANGAN']::public.aduan_category[] WHERE user_id=$1", [staffId]);
      expect((await listNotifications(staff, ua)).some((item) => item.ticketId === ticket.ticketId)).toBe(false);
      await admin.query("UPDATE public.satgas_profiles SET duty_status='OFF_DUTY' WHERE user_id=$1", [staffId]);
      await expect(listNotifications(staff, ua)).rejects.toMatchObject({ code: "STAFF_OFF_DUTY" });
    } finally {
      await admin.query("UPDATE public.satgas_profiles SET authorized_categories=enum_range(NULL::public.aduan_category), duty_status='ON_DUTY' WHERE user_id=$1", [staffId]);
    }
    const current = await ticketDetail(staff, ua, ticket.ticketId);
    await changeTicketStatus(staff, ua, ticket.ticketId, "DITOLAK", current.ticket.rowVersion!);
    expect((await listNotifications(staff, ua)).some((item) => item.ticketId === ticket.ticketId && item.kind === "OVERDUE")).toBe(false);
  });

  it("keeps the database audit hash chain intact", async () => {
    const result = await admin.query("SELECT ok, broken_count FROM public.fn_verify_audit_chain('global')");
    expect(result.rows[0].ok).toBe(true);
    expect(Number(result.rows[0].broken_count)).toBe(0);
  });
});
