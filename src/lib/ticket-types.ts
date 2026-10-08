/**
 * Tipe dan konstanta tiket yang aman diimpor dari komponen klien.
 *
 * Modul ini sengaja tidak mengimpor apa pun: `demo-store` menarik
 * `node:crypto` untuk enkripsi badan aduan, dan mengimpornya dari client
 * component akan membuat build gagal karena modul itu bukan untuk browser.
 */
export const TICKET_STATUSES = [
  "DALAM_PENANGANAN",
  "MENUNGGU_TINDAK_LANJUT",
  "SELESAI",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type RiskBand = "LOW" | "MEDIUM" | "HIGH";

/**
 * Metadata tiket yang boleh dilihat satuan tugas.
 *
 * Email pelapor dan isi aduan tidak ada di sini. Isi aduan hanya dibaca lewat
 * `POST /api/satgas/decrypt`, yang memeriksa sesi dan mencatat audit.
 */
export interface TicketMetadata {
  ticketId: string;
  pseudonym: string;
  subject: string;
  category: string;
  riskBand: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
}
