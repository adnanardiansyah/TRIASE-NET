import { z } from "zod";
import { ADUAN_CATEGORY, PERSONAL_SAFETY_CATEGORIES, type AduanCategory } from "./domain/enums";

export const MAX_EVIDENCE_FILES = 3;
export const MAX_EVIDENCE_BYTES = 1024 * 1024;
export const MAX_TOTAL_EVIDENCE_BYTES = 2 * 1024 * 1024;
export const CREATE_TICKET_MAX_BYTES = 3_000_000;
export const EVIDENCE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export function complaintKind(category: AduanCategory) {
  if (category === "KEBERSAMAAN" || PERSONAL_SAFETY_CATEGORIES.some((value) => value === category)) return "PERSONAL";
  if (category === "TEKNOLOGI" || category === "KEAMANAS_INFORMASI") return "TECHNOLOGY";
  return category === "FASILITAS" ? "FACILITIES" : "GENERAL";
}

const text = (limit: number) => z.string().trim().max(limit).optional();
export const complaintDetailsSchema = z.object({
  timePrecision: z.enum(["EXACT", "APPROXIMATE", "UNKNOWN"]).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  location: text(500),
  facilityCondition: text(1000),
  systemName: text(200),
  errorMessage: text(1000),
  involvement: z.enum(["SELF", "OTHER", "UNSPECIFIED"]).optional(),
  affectedPerson: text(200),
  relationship: text(200),
  reportedParty: text(500),
  witnesses: text(500),
  expectedOutcome: text(1500),
}).strict();
export type ComplaintDetails = z.infer<typeof complaintDetailsSchema>;

export function detailsForCategory(category: AduanCategory, details: ComplaintDetails): ComplaintDetails {
  const common = { timePrecision: details.timePrecision, occurredAt: details.occurredAt, location: details.location, expectedOutcome: details.expectedOutcome };
  const kind = complaintKind(category);
  if (kind === "PERSONAL") return { ...common, involvement: details.involvement ?? "UNSPECIFIED", reportedParty: details.reportedParty, witnesses: details.witnesses,
    ...(details.involvement === "OTHER" ? { affectedPerson: details.affectedPerson, relationship: details.relationship } : {}) };
  if (kind === "FACILITIES") return { ...common, facilityCondition: details.facilityCondition };
  if (kind === "TECHNOLOGY") return { ...common, systemName: details.systemName, errorMessage: details.errorMessage };
  return common;
}

export const evidenceInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mimeType: z.enum(EVIDENCE_MIME_TYPES),
  base64: z.string().min(1).max(Math.ceil(MAX_EVIDENCE_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
export interface EvidenceDescriptor { id: string; name: string; mimeType: EvidenceInput["mimeType"]; size: number }

export const createComplaintSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  category: z.enum(ADUAN_CATEGORY),
  body: z.string().trim().min(1).max(8000),
  details: complaintDetailsSchema.optional(),
  attachments: z.array(evidenceInputSchema).max(MAX_EVIDENCE_FILES).optional(),
}).strict().superRefine(({ category, details }, ctx) => {
  if (!details) return;
  const add = (field: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["details", field], message });
  if (details.timePrecision === "EXACT" || details.timePrecision === "APPROXIMATE") {
    if (!details.occurredAt) add("occurredAt", "Isi waktu atau pilih tidak ingat.");
  } else if (details.occurredAt) add("occurredAt", "Pilih ketepatan waktu kejadian.");
  if (details.occurredAt && Date.parse(details.occurredAt) > Date.now()) add("occurredAt", "Waktu kejadian tidak boleh di masa depan.");
  const kind = complaintKind(category);
  if (kind !== "PERSONAL") {
    for (const field of ["involvement", "affectedPerson", "relationship", "reportedParty", "witnesses"] as const) {
      if (details[field]) add(field, "Informasi pihak terkait tidak sesuai kategori.");
    }
  } else if (details.involvement !== "OTHER" && (details.affectedPerson || details.relationship)) add("affectedPerson", "Informasi ini hanya untuk laporan terhadap orang lain.");
  if (kind !== "TECHNOLOGY" && (details.systemName || details.errorMessage)) add("systemName", "Informasi sistem tidak sesuai kategori.");
  if (kind !== "FACILITIES" && details.facilityCondition) add("facilityCondition", "Kondisi fasilitas tidak sesuai kategori.");
});
export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;

// Old encrypted tickets contain only subject/body and remain readable.
export const storedComplaintSchema = z.object({
  subject: z.string(), body: z.string(), details: complaintDetailsSchema.optional(),
  attachments: z.array(evidenceInputSchema.extend({ id: z.string().uuid(), size: z.number().int().positive().max(MAX_EVIDENCE_BYTES) })).max(MAX_EVIDENCE_FILES).optional(),
});
export type StoredComplaint = z.infer<typeof storedComplaintSchema>;

export function evidenceDescriptors(payload: StoredComplaint): EvidenceDescriptor[] {
  return (payload.attachments ?? []).map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size }));
}

/** Labels shared by review, owner detail and the audited staff decrypt panel. */
export function complaintDetailRows(details?: ComplaintDetails): { label: string; value: string }[] {
  if (!details) return [];
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value?: string) => { if (value?.trim()) rows.push({ label, value }); };
  if (details.occurredAt) push(details.timePrecision === "APPROXIMATE" ? "Perkiraan waktu kejadian" : "Waktu kejadian", new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(details.occurredAt)) + " WIB");
  else if (details.timePrecision) push("Waktu kejadian", "Tidak ingat / belum diketahui");
  push("Lokasi / media kejadian", details.location);
  push("Kondisi fasilitas", details.facilityCondition);
  push("Aplikasi / sistem", details.systemName); push("Pesan error / kendala", details.errorMessage);
  if (details.involvement) push("Posisi pelapor", { SELF: "Mengalami sendiri", OTHER: "Melaporkan kejadian terhadap orang lain", UNSPECIFIED: "Tidak ingin menyebutkan" }[details.involvement]);
  push("Pihak yang mengalami", details.affectedPerson); push("Hubungan dengan pihak tersebut", details.relationship);
  push("Pihak terlapor / ciri yang diketahui", details.reportedParty); push("Saksi / informasi pendukung", details.witnesses);
  push("Harapan tindak lanjut", details.expectedOutcome);
  return rows;
}
