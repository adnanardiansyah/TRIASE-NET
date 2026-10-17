import { createHash } from "node:crypto";
import type { SessionClaims } from "@/lib/auth/jwt";
import type { AduanCategory, DutyStatus } from "@/lib/domain/enums";
import { ApiError } from "@/lib/api/errors";

export interface StaffAccess {
  authorized_categories: AduanCategory[];
  max_decrypt_risk_score: number;
  duty_status: DutyStatus;
  expires_at: Date | null;
  requires_step_up: boolean;
  kek_access_version: number;
}

export function deviceHash(userAgent: string): string {
  return createHash("sha256").update(userAgent).digest("hex");
}

export function assertSessionContext(session: SessionClaims, userAgent: string, now = Date.now()): void {
  if (!session.userId || !session.deviceHash || !session.authVersion || (session.role === "MAHASISWA" ? !["PASSWORD", "TOTP"].includes(session.authMethod ?? "") : session.authMethod !== "TOTP" || !session.mfaVerifiedAt)) {
    throw new ApiError(401, "Silakan masuk ulang untuk memperbarui sesi.", "SESSION_REFRESH_REQUIRED");
  }
  if (session.exp * 1000 <= now || session.deviceHash !== deviceHash(userAgent)) {
    throw new ApiError(401, "Konteks sesi berubah. Silakan masuk ulang.", "SESSION_CONTEXT_CHANGED");
  }
}

export function assertStaffAccess(profile: StaffAccess | undefined, category?: AduanCategory, risk = 0, keyVersion = 1, now = Date.now()): void {
  if (!profile || profile.duty_status !== "ON_DUTY" || (profile.expires_at && profile.expires_at.getTime() <= now)) {
    throw new ApiError(403, "Petugas tidak sedang bertugas atau mandat sudah berakhir.", "STAFF_OFF_DUTY");
  }
  if ((category && !profile.authorized_categories.includes(category)) || risk > profile.max_decrypt_risk_score || keyVersion > profile.kek_access_version) {
    throw new ApiError(403, "Aduan berada di luar kewenangan petugas.", "OUTSIDE_CLEARANCE");
  }
}

export function assertFreshMfa(session: SessionClaims, required: boolean, now = Date.now()): void {
  if (required && (!session.mfaVerifiedAt || now / 1000 - session.mfaVerifiedAt > 15 * 60)) {
    throw new ApiError(403, "Verifikasi ulang kode autentikator untuk melanjutkan.", "STEP_UP_REQUIRED");
  }
}

export function submissionRisk(category: AduanCategory, session: SessionClaims, now = Date.now()): number {
  const baseline = category === "KEAMANAS_INFORMASI" || category === "KESEHATAN" ? 75
    : category === "KEUANGAN" || category === "KEBERSAMAAN" ? 45 : 20;
  const agePenalty = Math.min(15, Math.max(0, Math.floor((now / 1000 - session.iat) / 1800)) * 5);
  return Math.min(100, baseline + agePenalty);
}
