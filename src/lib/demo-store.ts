import { createEnvelope, decryptEnvelope, type EncryptedEnvelope } from "@/lib/crypto/envelope";
import { getKekMaterial, KEK_KEY_ID } from "@/lib/crypto/kek";
import { createPseudonymId, createTicketId } from "@/lib/crypto/pseudonym";
import { TICKET_STATUSES, type TicketMetadata, type TicketStatus } from "@/lib/ticket-types";

export const DEMO_TICKET_STATUSES = TICKET_STATUSES;

export type DemoTicketStatus = TicketStatus;

/**
 * Baris tiket apa adanya.
 *
 * ciphertext. Sebelumnya isi aduan disimpan apa adanya di memori, sehingga
 * halaman detail bisa merendernya tanpa pernah melewati jalur dekripsi: siapa
 * pun yang bisa membuka `/aduan/[id]` langsung membaca seluruh isi aduan
 * tanpa catatan audit apa pun.
 */
export interface DemoTicketRecord {
  ticketId: string;
  /** Identitas pelapor. Tidak pernah keluar dari server. */
  reporterEmail: string;
  subject: string;
  category: string;
  /** Isi aduan dalam amplop terenkripsi. Tidak ada plaintext di baris ini. */
  bodyEnvelope: EncryptedEnvelope;
  riskBand: string;
  pseudonym: string;
  status: DemoTicketStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tampilan untuk satuan tugas: metadata saja.
 *
 * Email pelapor dan isi aduan sengaja tidak ada di sini. Satuan tugas hanya
 * boleh membaca badan aduan melalui `POST /api/satgas/decrypt`, yang memeriksa
 * sesi dan mencatat audit. Kalau keduanya ikut dikembalikan di sini, jalur
 * dekripsi tersebut tidak pernah dipakai dan seluruh alasan sistem ini ada
 * menjadi tidak ada.
 */
export type DemoTicketStaffView = TicketMetadata;

/**
 * Tampilan untuk pelapor sendiri.
 *
 * Berbeda dengan baris mentah: ciphertext ikut disertakan agar pemanggil bisa
 * mendekripsinya di server untuk ditampilkan kembali ke pemiliknya. Pelapor
 * berhak membaca isi aduannya sendiri; yang dibatasi adalah pihak lain.
 */
export type DemoTicketOwnerView = DemoTicketRecord;

export class TicketBodyUnavailableError extends Error {
  constructor(ticketId: string) {
    super(`Isi tiket ${ticketId} tidak dapat didekripsi: material kunci tidak tersedia.`);
    this.name = "TicketBodyUnavailableError";
  }
}

const tickets = new Map<string, DemoTicketRecord>();

function normalizeTicketId(ticketId: string): string {
  return ticketId.trim().toUpperCase();
}

export function createDemoTicket(input: {
  email: string;
  subject: string;
  category: string;
  body: string;
  riskBand: string;
}): DemoTicketRecord {
  const keyMaterial = getKekMaterial();

  if (!keyMaterial) {
    // Menolak membuat tiket lebih baik daripada menyimpan plaintext karena
    // "tidak ada kunci saat ini". Production wajib punya KEK.
    throw new Error("KEK_MASTER_BASE64 wajib disetel sebelumimpan aduan.");
  }

  let ticketId = createTicketId("TR");
  // Tabrakan sangat kecil peluangnya, tapi dijamin tidak akan menimpa tiket lama.
  while (tickets.has(ticketId)) {
    ticketId = createTicketId("TR");
  }

  const now = new Date().toISOString();
  const record: DemoTicketRecord = {
    ticketId,
    reporterEmail: input.email.trim().toLowerCase(),
    subject: input.subject,
    category: input.category,
    bodyEnvelope: createEnvelope(keyMaterial, input.body, KEK_KEY_ID),
    riskBand: input.riskBand,
    pseudonym: createPseudonymId(input.email, "PS"),
    status: "DALAM_PENANGANAN",
    createdAt: now,
    updatedAt: now,
  };

  tickets.set(ticketId, record);
  return record;
}

/**
 * Membaca isi tiket di sisi server.
 *
 * Hanya dipanggil setelah pemanggil membuktikan haknya: pemilik tiket untuk
 * menampilkan aduannya sendiri, atau satuan tugas lewat jalur dekripsi yang
 * tercatat. Fungsi ini tidak memeriksa hak akses dengan sendirinya.
 */
export function readDemoTicketBody(ticketId: string): string {
  const record = getDemoTicket(ticketId);

  if (!record) {
    throw new Error(`Tiket ${ticketId} tidak ada.`);
  }

  const keyMaterial = getKekMaterial();

  if (!keyMaterial) {
    throw new TicketBodyUnavailableError(record.ticketId);
  }

  return decryptEnvelope(keyMaterial, record.bodyEnvelope);
}

/**
 * Lookup tiket dengan normalisasi id yang sama untuk semua fungsi.
 *
 * Versi sebelumnya hanya melakukan `tickets.get(ticketId)` sementara
 * `updateDemoTicketStatus` melakukan `.toUpperCase()`. Akibatnya kode yang
 * menemukan id dari UI (yang tidak pernah huruf kecil) berhasil, sementara
 * pemanggilan yang tidak melakukan uppercase sendiri gagal diam-diam.
 */
export function getDemoTicket(ticketId: string): DemoTicketRecord | undefined {
  return tickets.get(normalizeTicketId(ticketId));
}

export function isDemoTicketOwnedBy(
  ticketId: string,
  email: string,
): boolean {
  const record = getDemoTicket(ticketId);
  return record?.reporterEmail === email.trim().toLowerCase();
}

export function updateDemoTicketStatus(
  ticketId: string,
  status: DemoTicketStatus,
): DemoTicketRecord | undefined {
  const record = tickets.get(normalizeTicketId(ticketId));

  if (!record) {
    return undefined;
  }

  record.status = status;
  record.updatedAt = new Date().toISOString();
  return record;
}

export function listDemoTickets(): DemoTicketRecord[] {
  return Array.from(tickets.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function findDemoTicketsByEmail(email: string): DemoTicketRecord[] {
  const normalized = email.trim().toLowerCase();
  return listDemoTickets().filter((ticket) => ticket.reporterEmail === normalized);
}

export function toStaffView(record: DemoTicketRecord): DemoTicketStaffView {
  return {
    ticketId: record.ticketId,
    pseudonym: record.pseudonym,
    subject: record.subject,
    category: record.category,
    riskBand: record.riskBand,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Dipakai tes; menyisakan keadaan antar berkas tetap bersih. */
export function __resetDemoStore(): void {
  tickets.clear();
}