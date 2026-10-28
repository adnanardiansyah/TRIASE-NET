import { describe, expect, it } from "vitest";
import { createComplaintSchema, detailsForCategory, complaintDetailRows, storedComplaintSchema } from "./complaint-payload";

const minimum = { subject: "Laporan", category: "FASILITAS", body: "Kronologi" };
describe("structured complaint validation", () => {
  it("keeps the original minimal input and encrypted payload compatible", () => {
    expect(createComplaintSchema.parse(minimum)).toEqual(minimum);
    expect(storedComplaintSchema.parse({ subject: "Lama", body: "Isi lama" })).toEqual({ subject: "Lama", body: "Isi lama" });
  });
  it("accepts unknown and approximate times without requiring identities", () => {
    expect(createComplaintSchema.safeParse({ ...minimum, details: { timePrecision: "UNKNOWN" } }).success).toBe(true);
    expect(createComplaintSchema.safeParse({ ...minimum, category: "PERUNDUNGAN", details: { involvement: "UNSPECIFIED", timePrecision: "APPROXIMATE", occurredAt: "2026-01-01T10:00:00+07:00" } }).success).toBe(true);
    expect(complaintDetailRows({ timePrecision: "APPROXIMATE", occurredAt: "2026-01-01T03:00:00Z" })[0]?.value).toContain("10.00");
  });
  it("rejects invalid/future times and fields belonging to another category", () => {
    for (const details of [
      { timePrecision: "EXACT" }, { timePrecision: "UNKNOWN", occurredAt: "2026-01-01T00:00:00Z" },
      { timePrecision: "EXACT", occurredAt: new Date(Date.now() + 86_400_000).toISOString() },
      { reportedParty: "Someone" }, { systemName: "A system" }, { email: "unnecessary@example.test" },
    ]) expect(createComplaintSchema.safeParse({ ...minimum, details }).success).toBe(false);
    expect(createComplaintSchema.safeParse({ ...minimum, category: "PERUNDUNGAN", details: { involvement: "SELF", affectedPerson: "Someone else" } }).success).toBe(false);
    expect(createComplaintSchema.safeParse({ ...minimum, attachment_count: 10 }).success).toBe(false);
  });
  it("removes hidden category-specific and third-party data before review", () => {
    const original = { timePrecision: "UNKNOWN" as const, location: "Kampus", involvement: "OTHER" as const, reportedParty: "Private person", affectedPerson: "Affected person", witnesses: "A witness", systemName: "Portal", facilityCondition: "Rusak", expectedOutcome: "Tindak lanjut" };
    const tech = detailsForCategory("TEKNOLOGI", original);
    expect(tech.systemName).toBe("Portal");
    expect(tech).not.toHaveProperty("reportedParty"); expect(tech).not.toHaveProperty("affectedPerson"); expect(tech).not.toHaveProperty("facilityCondition");
    expect(detailsForCategory("PERUNDUNGAN", { ...original, involvement: "SELF" })).not.toHaveProperty("affectedPerson");
    expect(original.reportedParty).toBe("Private person");
  });
});
