import { describe, expect, it } from "vitest";
import { prepareEvidence } from "./complaint-evidence";
import { MAX_EVIDENCE_BYTES, createComplaintSchema, type EvidenceInput } from "./complaint-payload";

const pdf: EvidenceInput = { name: "bukti.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.7\nSynthetic test evidence").toString("base64") };
describe("evidence validation", () => {
  it("preserves file bytes, creates identifiers and sanitizes names", () => {
    const [file] = prepareEvidence([{ ...pdf, name: "../../unsafe\r\n\u202e.exe" }]);
    expect(file?.name).not.toMatch(/[\\/\r\n\u202e]/); expect(file?.name).toMatch(/\.pdf$/);
    expect(file?.base64).toBe(pdf.base64); expect(file?.size).toBe(Buffer.from(pdf.base64, "base64").length);
    expect(file?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(prepareEvidence([pdf])[0]?.id).not.toBe(file?.id);
  });
  it("rejects MIME spoofing, malformed encoding and unsupported types", () => {
    expect(() => prepareEvidence([{ ...pdf, mimeType: "image/png" }])).toThrow();
    expect(() => prepareEvidence([{ ...pdf, base64: pdf.base64 + "=" }])).toThrow();
    expect(() => prepareEvidence([{ ...pdf, base64: "AAAA" }])).toThrow();
    expect(createComplaintSchema.safeParse({ subject: "x", body: "x", category: "LAINNYA", attachments: [{ ...pdf, mimeType: "text/html" }] }).success).toBe(false);
  });
  it("enforces per-file, aggregate and file count limits", () => {
    expect(() => prepareEvidence(Array(4).fill(pdf))).toThrow();
    const big = Buffer.alloc(MAX_EVIDENCE_BYTES + 1); big.write("%PDF-");
    expect(() => prepareEvidence([{ ...pdf, base64: big.toString("base64") }])).toThrow();
    const medium = Buffer.alloc(800_000); medium.write("%PDF-");
    expect(() => prepareEvidence(Array(3).fill({ ...pdf, base64: medium.toString("base64") }))).toThrow();
  });
});
