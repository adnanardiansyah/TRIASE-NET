/**
 * Konstanta domain TRIASE-Net.
 *
 * SINGLE SOURCE OF TRUTH untuk nilai enum PostgreSQL. Nilai di sini WAJIB
 * identik dengan enum database setelah seluruh migrasi diterapkan. Jangan pernah
 * menulis string enum secara literal di kode lain.
 */

export const APP_ROLE = ["MAHASISWA", "SATGAS", "ADMIN"] as const;
export type AppRole = (typeof APP_ROLE)[number];

export const USER_STATUS = [
  "PENDING",
  "ACTIVE",
  "SUSPENDED",
  "LOCKED",
  "DEPROVISIONED",
] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const IDENTITY_PROVIDER = ["LOCAL", "OIDC", "SIB"] as const;
export type IdentityProvider = (typeof IDENTITY_PROVIDER)[number];

export const PERSONAL_SAFETY_CATEGORIES = [
  "PELECEHAN_SEKSUAL",
  "PELECEHAN_NON_SEKSUAL",
  "PERUNDUNGAN",
  "KEKERASAN_FISIK",
  "KEKERASAN_PSIKOLOGIS",
  "DISKRIMINASI",
  "ANCAMAN_INTIMIDASI",
] as const;

export const ADUAN_CATEGORY = [
  "AKADEMIK",
  "KEUANGAN",
  "FASILITAS",
  "KEAMANAS_INFORMASI",
  "KESEHATAN",
  "KEBERSAMAAN",
  "TEKNOLOGI",
  ...PERSONAL_SAFETY_CATEGORIES,
  "LAINNYA",
] as const;
export type AduanCategory = (typeof ADUAN_CATEGORY)[number];

export const ADUAN_STATUS = [
  "DITERIMA",
  "DALAM_PENANGANAN",
  "MENUNGGU_TINDAK_LANJUT",
  "SELESAI",
  "DITUTUP",
  "DITOLAK",
] as const;
export type AduanStatus = (typeof ADUAN_STATUS)[number];

export const ADUAN_CLOSED_STATUS: readonly AduanStatus[] = [
  "SELESAI",
  "DITUTUP",
  "DITOLAK",
];

export const SUBMISSION_CHANNEL = ["WEB", "MOBILE", "KIOSK", "API"] as const;
export type SubmissionChannel = (typeof SUBMISSION_CHANNEL)[number];

export const RISK_BAND = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskBand = (typeof RISK_BAND)[number];

export const DUTY_STATUS = ["ON_DUTY", "OFF_DUTY", "LEAVE"] as const;
export type DutyStatus = (typeof DUTY_STATUS)[number];

export const CRYPTO_ALGORITHM = [
  "AES_256_GCM",
  "CHACHA20_POLY1305",
  "HYBRID_DOUBLE",
] as const;
export type CryptoAlgorithm = (typeof CRYPTO_ALGORITHM)[number];

export const KEY_WRAP_ALGORITHM = [
  "AES_256_GCM_WRAP",
  "CHACHA20_POLY1305_WRAP",
  "RSA_OAEP_256",
] as const;
export type KeyWrapAlgorithm = (typeof KEY_WRAP_ALGORITHM)[number];

export const KEK_STATUS = ["ACTIVE", "RETIRED", "REVOKED"] as const;
export type KekStatus = (typeof KEK_STATUS)[number];

export const ATTACHMENT_SCAN_STATUS = [
  "PENDING",
  "CLEAN",
  "INFECTED",
  "FAILED",
] as const;
export type AttachmentScanStatus = (typeof ATTACHMENT_SCAN_STATUS)[number];

export const AUDIT_DECISION = ["ALLOW", "CHALLENGE", "DENY"] as const;
export type AuditDecision = (typeof AUDIT_DECISION)[number];

export const AUDIT_ACTION = [
  "ZTNA_EVALUATE",
  "ZTNA_BLOCK",
  "ZTNA_CHALLENGE",
  "SESSION_INIT",
  "LOGIN_ATTEMPT",
  "LOGIN_MFA_VERIFY",
  "LOGIN_MFA_FAIL",
  "LOGIN_BLOCKED",
  "LOGOUT",
  "TOKEN_REFRESH",
  "TOKEN_REUSE_DETECTED",
  "ADUAN_SUBMIT",
  "ADUAN_METADATA_READ",
  "ADUAN_DECRYPT",
  "ADUAN_DECRYPT_DENIED",
  "ADUAN_STATUS_CHANGE",
  "ADUAN_REPLY",
  "ADUAN_ATTACHMENT_READ",
  "KEK_ROTATE",
  "KEY_REENCRYPT",
  "RETENTION_CRYPTO_SHRED",
] as const;
export type AuditAction = (typeof AUDIT_ACTION)[number];

export const AUTH_METHOD = [
  "PASSWORD",
  "TOTP",
  "OIDC",
  "RECOVERY_CODE",
  "STEP_UP",
] as const;
export type AuthMethod = (typeof AUTH_METHOD)[number];

/* -------------------------------------------------------------------------- */
/* Konstanta kriptografi                                                        */
/* -------------------------------------------------------------------------- */

/** Panjang DEK (Data Encryption Key) : 256 bit. */
export const DEK_BYTES = 32;

/** Panjang nonce/IV : 96 bit, wajib untuk AES-GCM dan ChaCha20-Poly1305. */
export const NONCE_BYTES = 12;

/** Panjang authentication tag AEAD : 128 bit. */
export const AUTH_TAG_BYTES = 16;

/** Versi KEK yang boleh dibuka oleh sebuah profil satuan tugas. */
export const DEFAULT_KEK_ACCESS_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Aturan retensi                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Masa simpan. Setiap aduan harus punya jadwal crypto-shredding.
 * Nilai ini diselaraskan dengan kebijakan GDPR/PII --
 * di luar rentas ini, kunci dibuang sehingga data tidak dapat dibaca.
 */
export const RETENTION_DAYS_BY_RISK: Readonly<Record<RiskBand, number>> = {
  LOW: 365,
  MEDIUM: 730,
  HIGH: 1095,
};
