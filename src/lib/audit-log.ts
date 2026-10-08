import { createHash } from "node:crypto";

/**
 * Log audit append-only untuk akses terhadap isi aduan.
 *
 * Setiap entri dirangkai dengan hash entri sebelumnya, jadi mengubah atau
 * menghapus satu baris di tengah rantai membuat `verifyAuditChain` bernilai
 * false. Itulah alasan modul ini tidak menyediakan fungsi hapus maupun ubah:
 * keduanya harus ditolak oleh tipe dan struktur data, bukan oleh disiplin.
 *
 * Batasnya harus disebut jujur: penyimpanannya in-memory, jadi log hilang saat
 * proses restart dan tidak dibagikan antar-instance. Pada deployment sebenarnya
 * log ini pindah ke tabel append-only dengan trigger yang menolak `UPDATE` dan
 * `DELETE`.
 */

export type AuditAction =
  | "DECRYPT_REQUESTED"
  | "DECRYPT_DENIED"
  | "TICKET_STATUS_CHANGED";

export interface AuditEntry {
  seq: number;
  at: string;
  action: AuditAction;
  actorEmail: string;
  actorRole: string;
  ticketId: string | null;
  detail: string;
  /** Hash entri sebelum ini. `GENESIS_HASH` untuk entri pertama. */
  previousHash: string;
  hash: string;
}

const GENESIS_HASH = "0".repeat(64);
const MAX_DETAIL_LENGTH = 120;

const entries: AuditEntry[] = [];

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function compact(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return value.length > MAX_DETAIL_LENGTH
    ? `${value.slice(0, MAX_DETAIL_LENGTH)}...`
    : value;
}

function computeHash(entry: Omit<AuditEntry, "hash">): string {
  return sha256Hex(
    [
      entry.seq,
      entry.at,
      entry.action,
      entry.actorEmail,
      entry.actorRole,
      entry.ticketId ?? "-",
      entry.detail,
      entry.previousHash,
    ].join("|"),
  );
}

export function appendAuditEntry(input: {
  action: AuditAction;
  actorEmail: string;
  actorRole: string;
  ticketId?: string | null;
  detail?: string | null;
}): AuditEntry {
  const previous = entries.length > 0 ? entries[entries.length - 1] : undefined;
  const previousHash = previous ? previous.hash : GENESIS_HASH;

  const draft = {
    seq: entries.length + 1,
    at: new Date().toISOString(),
    action: input.action,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    ticketId: input.ticketId ?? null,
    detail: compact(input.detail),
    previousHash,
  };

  const entry: AuditEntry = Object.freeze({ ...draft, hash: computeHash(draft) });

  entries.push(entry);
  return entry;
}

export function listAuditEntries(): AuditEntry[] {
  // Entri dibekukan saat ditulis. `slice()` hanya menyalin array, jadi tanpa
  // `freeze` pemanggil bisa mengubah `entry.ticketId` pada objek yang sama dan
  // merusak rantai tanpa pernah memakai API untuk itu.
  return entries.slice();
}

export function findAuditEntriesForTicket(ticketId: string): AuditEntry[] {
  return entries.filter((entry) => entry.ticketId === ticketId);
}

/**
 * Menelusuri ulang rantai hash dari awal.
 *
 * `source` bisa diisi untuk memeriksa daftar entri yang datang dari luar, yang
 * dipakai tes untuk membuktikan bahwa verifier benar-benar menolak riwayat
 * yang dimanipulasi. Nilai bakanya adalah log yang tersimpan.
 */
export function verifyAuditChain(source: readonly AuditEntry[] = entries): boolean {
  let previousHash = GENESIS_HASH;

  for (const entry of source) {
    if (entry.previousHash !== previousHash) {
      return false;
    }

    const { hash, ...rest } = entry;

    if (computeHash(rest) !== hash) {
      return false;
    }

    previousHash = hash;
  }

  return true;
}

/** Dipakai tes. */
export function __resetAuditLog(): void {
  entries.length = 0;
}
