import "server-only";
import { randomUUID } from "node:crypto";
import { ApiError } from "./api/errors";
import { MAX_EVIDENCE_BYTES, MAX_EVIDENCE_FILES, MAX_TOTAL_EVIDENCE_BYTES, type EvidenceInput, type StoredComplaint } from "./complaint-payload";

export function prepareEvidence(files: EvidenceInput[] = []): NonNullable<StoredComplaint["attachments"]> {
  if (files.length > MAX_EVIDENCE_FILES) throw new ApiError(400, "Lampiran maksimal 3 file.", "INVALID_EVIDENCE");
  let total = 0;
  return files.map((file) => {
    const bytes = Buffer.from(file.base64, "base64");
    if (!bytes.length || bytes.length > MAX_EVIDENCE_BYTES || bytes.toString("base64") !== file.base64) throw new ApiError(400, "Lampiran tidak valid atau melebihi 1 MB.", "INVALID_EVIDENCE");
    total += bytes.length;
    if (total > MAX_TOTAL_EVIDENCE_BYTES) throw new ApiError(400, "Total lampiran maksimal 2 MB.", "INVALID_EVIDENCE");
    const valid = file.mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : file.mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : file.mimeType === "image/webp" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
      : bytes.subarray(0, 5).toString() === "%PDF-";
    if (!valid) throw new ApiError(400, "Isi lampiran tidak sesuai jenis gambar atau PDF.", "INVALID_EVIDENCE");
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" }[file.mimeType];
    const safe = file.name.replace(/[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "_").replace(/\.[^.]*$/, "").slice(0, 150).trim() || "bukti";
    return { ...file, id: randomUUID(), name: `${safe}.${extension}`, size: bytes.length };
  });
}
