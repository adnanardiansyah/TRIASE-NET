import { describe, expect, it } from "vitest";
import { ADUAN_CATEGORY, PERSONAL_SAFETY_CATEGORIES } from "./domain/enums";
import { createTicketSchema } from "./api/validation";
import { adminAccountMutation } from "./admin-account-schemas";
import { formatTicketCategory, buildCategoryDistribution } from "./dashboard-aggregates";
import { assertStaffAccess, submissionRisk, type StaffAccess } from "./ztna/access-policy";
import type { SessionClaims } from "./auth/jwt";

const now = Date.now();
const session = { iat: now / 1000 } as SessionClaims;
describe("personal safety complaint categories", () => {
  it.each(PERSONAL_SAFETY_CATEGORIES)("accepts and labels %s and applies sensitive-data protection", (category) => {
    expect(createTicketSchema.safeParse({ category, subject: "Laporan", body: "Kronologi" }).success).toBe(true);
    expect(formatTicketCategory(category)).not.toBe(category);
    expect(submissionRisk(category, session, now)).toBe(75);
    const distribution = buildCategoryDistribution([{ ticketId: "test", subject: "Masked", category, riskBand: "HIGH", status: "DITERIMA", pseudonym: "PS-test", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }]);
    expect(distribution[0]?.key).toBe(category);
    const profile: StaffAccess = { authorized_categories: ["KEBERSAMAAN"], max_decrypt_risk_score: 100, duty_status: "ON_DUTY", expires_at: null, requires_step_up: true, kek_access_version: 1 };
    expect(() => assertStaffAccess(profile, category, 75, 1, now)).toThrow();
    expect(() => assertStaffAccess({ ...profile, authorized_categories: [category], max_decrypt_risk_score: 69 }, category, 75, 1, now)).toThrow();
    expect(() => assertStaffAccess({ ...profile, authorized_categories: [category] }, category, 75, 1, now)).not.toThrow();
  });
  it("supports mandates covering the expanded catalogue and rejects duplicate categories", () => {
    const mutation = { action: "mandate", id: "11111111-1111-4111-8111-111111111111", version: 0, duty_status: "ON_DUTY", categories: [...ADUAN_CATEGORY], max_risk: 100, expires_at: new Date(now + 86_400_000).toISOString(), reason: "Penetapan kategori penanganan" };
    expect(adminAccountMutation.safeParse(mutation).success).toBe(true);
    expect(adminAccountMutation.safeParse({ ...mutation, categories: ["PELECEHAN_SEKSUAL", "PELECEHAN_SEKSUAL"] }).success).toBe(false);
  });
});
