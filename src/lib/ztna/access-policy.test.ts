import { describe, expect, it } from "vitest";
import { assertFreshMfa, assertSessionContext, assertStaffAccess, deviceHash, submissionRisk, type StaffAccess } from "./access-policy";
import type { SessionClaims } from "@/lib/auth/jwt";

const now = Date.now();
const session: SessionClaims = { sub: "user@example.test", role: "SATGAS", authVersion: 1, authMethod: "TOTP", userId: "11111111-1111-4111-8111-111111111111", iat: now / 1000, exp: now / 1000 + 3600, mfaVerifiedAt: now / 1000, deviceHash: deviceHash("browser") };
const profile: StaffAccess = { authorized_categories: ["FASILITAS"], max_decrypt_risk_score: 69, duty_status: "ON_DUTY", expires_at: null, requires_step_up: true, kek_access_version: 1 };
describe("server access policy", () => {
  it("binds access to a registered account and the signed device context", () => {
    expect(() => assertSessionContext(session, "browser", now)).not.toThrow();
    expect(() => assertSessionContext(session, "different-browser", now)).toThrow();
    expect(() => assertSessionContext({ ...session, userId: undefined }, "browser", now)).toThrow();
    expect(() => assertSessionContext({ ...session, exp: now / 1000 - 1 }, "browser", now)).toThrow();
  });
  it("allows verified student password sessions without MFA and rejects legacy sessions", () => {
    expect(() => assertSessionContext({ ...session, role: "MAHASISWA", authMethod: "PASSWORD", mfaVerifiedAt: undefined }, "browser", now)).not.toThrow();
    expect(() => assertSessionContext({ ...session, authVersion: undefined }, "browser", now)).toThrow();
    expect(() => assertSessionContext({ ...session, authMethod: "PASSWORD" }, "browser", now)).toThrow();
  });
  it("requires active duty, valid mandate, category, risk and key clearance", () => {
    expect(() => assertStaffAccess(profile, "FASILITAS", 50, 1, now)).not.toThrow();
    for (const bad of [undefined, { ...profile, duty_status: "OFF_DUTY" as const }, { ...profile, expires_at: new Date(now - 1) }]) expect(() => assertStaffAccess(bad, "FASILITAS", 0, 1, now)).toThrow();
    expect(() => assertStaffAccess(profile, "KEUANGAN", 20, 1, now)).toThrow();
    expect(() => assertStaffAccess(profile, "FASILITAS", 70, 1, now)).toThrow();
    expect(() => assertStaffAccess(profile, "FASILITAS", 20, 2, now)).toThrow();
  });
  it("challenges stale MFA without blocking fresh MFA", () => {
    expect(() => assertFreshMfa(session, true, now)).not.toThrow();
    expect(() => assertFreshMfa(session, true, now + 901000)).toThrow();
    expect(() => assertFreshMfa(session, false, now + 901000)).not.toThrow();
  });
  it("scores category sensitivity and session age on the server", () => {
    expect(submissionRisk("FASILITAS", session, now)).toBe(20);
    expect(submissionRisk("KEUANGAN", session, now)).toBe(45);
    expect(submissionRisk("KEAMANAS_INFORMASI", session, now)).toBe(75);
    expect(submissionRisk("FASILITAS", session, now + 3600000)).toBe(30);
  });
});
