/**
 * Tipe basis data TRIASE-Net untuk Kysely.
 *
 * These interfaces are a hand-maintained, type-safe mirror of the PostgreSQL
 * schema defined in `database/migrations/`. Keeping them in one place means
 * every query against an unknown column becomes a compile-time error.
 *
 * When the schema changes, regenerate with:
 *   npx kysely-codegen
 *
 * NOTE on bytea columns: node-postgres returns `Buffer`. We expose them as
 * `Buffer` here because the crypto layer works directly on byte buffers.
 */

import type {
  ColumnType,
  Generated,
  Insertable,
  Selectable,
  Updateable,
} from "kysely";

import type {
  AduanCategory,
  AduanStatus,
  AppRole,
  AttachmentScanStatus,
  AuditAction,
  AuditDecision,
  AuthMethod,
  CryptoAlgorithm,
  DutyStatus,
  IdentityProvider,
  KeyWrapAlgorithm,
  KekStatus,
  RiskBand,
  SubmissionChannel,
  UserStatus,
} from "@/lib/domain/enums";

/** timestamptz yang selalu diisi otomatis oleh basis data. */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/** timestamptz yang boleh NULL. */
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

/** bytea yang wajib diisi. */
type Blob = ColumnType<Buffer, Buffer | Uint8Array, Buffer | Uint8Array>;

export interface SchemaMigrationsTable {
  version: string;
  checksum: string;
  applied_at: Timestamp;
  applied_by: Generated<string>;
  execution_ms: Generated<number>;
}

export interface KekVersionsTable {
  version: number;
  label: string;
  wrap_algorithm: Generated<KeyWrapAlgorithm>;
  /** NULL pada produksi. Lihat fn_guard_kek_material(). */
  key_material: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  key_reference: ColumnType<string | null, string | null | undefined, never>;
  key_checksum: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  status: Generated<KekStatus>;
  activated_at: Timestamp;
  retired_at: NullableTimestamp;
  retired_reason: ColumnType<string | null, string | null | undefined, never>;
  created_at: Timestamp;
  updated_at: Timestamp;
  row_version: Generated<number>;
}

export interface UsersTable {
  id: Generated<string>;
  role: AppRole;
  status: Generated<UserStatus>;
  identity_provider: Generated<IdentityProvider>;
  /** Opaque OIDC `sub`. NULL untuk akun LOCAL. */
  subject_ref: ColumnType<string | null, string | null | undefined, never>;
  institutional_email: string;
  email_normalized: Generated<string>;
  /** Wajib NULL untuk MAHASISWA (ditegakkan CHECK). */
  display_name: ColumnType<string | null, string | null | undefined, never>;
  /** Argon2id. Wajib NULL untuk MAHASISWA (ditegakkan CHECK). */
  password_hash: ColumnType<string | null, string | null | undefined, string | null>;
  mfa_enrolled: Generated<boolean>;
  mfa_enrolled_at: NullableTimestamp;
  mfa_last_verified: NullableTimestamp;
  failed_login_count: Generated<number>;
  last_failed_login: NullableTimestamp;
  locked_until: NullableTimestamp;
  last_login_at: NullableTimestamp;
  last_login_ip: ColumnType<string | null, string | null | undefined, never>;
  last_login_network_zone: ColumnType<string | null, string | null | undefined, never>;
  password_changed_at: NullableTimestamp;
  row_version: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SatgasProfilesTable {
  user_id: string;
  employee_id: string;
  unit_name: string;
  position_title: ColumnType<string | null, string | null | undefined, never>;
  authorized_categories: AduanCategory[];
  max_decrypt_risk_score: Generated<number>;
  clearance_level: Generated<number>;
  duty_status: Generated<DutyStatus>;
  requires_step_up: Generated<boolean>;
  jwks_kid: ColumnType<string | null, string | null | undefined, never>;
  public_key_algorithm: ColumnType<string | null, string | null | undefined, never>;
  public_key: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  kek_access_version: Generated<number>;
  /** Envelope rahasia TOTP. TIDAK pernah plaintext. */
  mfa_secret_ciphertext: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  mfa_secret_iv: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  mfa_secret_auth_tag: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  mfa_secret_wrapped_dek: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  mfa_secret_wrap_iv: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  mfa_secret_wrap_auth_tag: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  mfa_secret_kek_version: ColumnType<number | null, number | null | undefined, never>;
  mfa_recovery_hashes: Generated<string[]>;
  mfa_recovery_used_count: Generated<number>;
  approved_by: ColumnType<string | null, string | null | undefined, never>;
  approved_at: NullableTimestamp;
  expires_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  row_version: Generated<number>;
}

export interface AduanTable {
  id: Generated<string>;
  /** Kode tiket publik, mis. TRX-2026-7F3A9C21. */
  ticket_code: string;
  /** HMAC-SHA256(identitas) dalam hex. 64 karakter. */
  pseudonym_id: string;
  category: AduanCategory;
  submission_channel: Generated<SubmissionChannel>;
  status: Generated<AduanStatus>;
  submitted_at: Timestamp;
  submitted_network_zone: ColumnType<string | null, string | null | undefined, never>;
  ztna_risk_score: Generated<number>;
  crypto_algorithm: CryptoAlgorithm;
  risk_score: Generated<number>;
  risk_band: Generated<RiskBand>;
  risk_factors: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, never>;
  body_ciphertext: Blob;
  body_iv: Blob;
  body_auth_tag: Blob;
  dek_wrapped: Blob;
  dek_wrap_iv: Blob;
  dek_wrap_auth_tag: Blob;
  kek_version: number;
  aad_context: string;
  aad_version: Generated<number>;
  attachment_count: Generated<number>;
  title_masked: ColumnType<string | null, string | null | undefined, string | null>;
  assigned_to: ColumnType<string | null, string | null | undefined, string | null>;
  closed_at: NullableTimestamp;
  retention_expires_at: Timestamp;
  row_version: Generated<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AduanCryptoLayersTable {
  id: Generated<string>;
  aduan_id: string;
  layer_index: number;
  algorithm: CryptoAlgorithm;
  ciphertext: Blob;
  iv: Blob;
  auth_tag: Blob;
  wrapped_dek: Blob;
  wrapped_dek_iv: Blob;
  wrapped_dek_tag: Blob;
  kek_version: number;
  aad_context: string;
  created_at: Timestamp;
}

export interface AduanAttachmentsTable {
  id: Generated<string>;
  aduan_id: string;
  sequence: Generated<number>;
  original_filename: Blob;
  filename_iv: Blob;
  filename_tag: Blob;
  filename_wrapped_dek: Blob;
  filename_dek_iv: Blob;
  filename_dek_tag: Blob;
  mime_type: ColumnType<string | null, string | null | undefined, never>;
  size_bytes: number;
  object_key: string;
  object_etag: ColumnType<string | null, string | null | undefined, never>;
  wrapped_dek: Blob;
  wrapped_dek_iv: Blob;
  wrapped_dek_tag: Blob;
  kek_version: number;
  crypto_algorithm: CryptoAlgorithm;
  ciphertext_sha256: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  scan_status: Generated<AttachmentScanStatus>;
  scanned_at: NullableTimestamp;
  scan_engine: ColumnType<string | null, string | null | undefined, never>;
  scan_signature: ColumnType<string | null, string | null | undefined, never>;
  uploaded_network_zone: ColumnType<string | null, string | null | undefined, never>;
  upload_risk_score: Generated<number>;
  uploaded_at: Timestamp;
  deleted_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  row_version: Generated<number>;
}

export interface AduanStatusHistoryTable {
  id: Generated<string>;
  aduan_id: string;
  from_status: ColumnType<AduanStatus | null, AduanStatus | null | undefined, never>;
  to_status: AduanStatus;
  reason_code: string;
  note: ColumnType<string | null, string | null | undefined, never>;
  changed_by: ColumnType<string | null, string | null | undefined, never>;
  changed_by_role: ColumnType<AppRole | null, AppRole | null | undefined, never>;
  changed_by_pseudonym_id: ColumnType<string | null, string | null | undefined, never>;
  /** Soft reference ke ztna_audit_logs (tabel dipartisi). */
  ztna_audit_id: string;
  trace_id: string;
  changed_at: Timestamp;
}

export interface ZtnaAuditLogsTable {
  id: Generated<string>;
  occurred_at: Timestamp;
  sequence_no: Generated<string>;
  actor_user_id: ColumnType<string | null, string | null | undefined, never>;
  actor_role: ColumnType<AppRole | null, AppRole | null | undefined, never>;
  actor_pseudonym_id: ColumnType<string | null, string | null | undefined, never>;
  session_id: ColumnType<string | null, string | null | undefined, never>;
  source_ip: ColumnType<string | null, string | null | undefined, never>;
  source_ip_truncated: ColumnType<string | null, string | null | undefined, never>;
  source_port: ColumnType<number | null, number | null | undefined, never>;
  network_zone: ColumnType<string | null, string | null | undefined, never>;
  asn: ColumnType<number | null, number | null | undefined, never>;
  country_code: ColumnType<string | null, string | null | undefined, never>;
  user_agent: ColumnType<string | null, string | null | undefined, never>;
  user_agent_hash: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  device_fingerprint_hash: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  device_trust_score: ColumnType<number | null, number | null | undefined, never>;
  client_cert_serial: ColumnType<string | null, string | null | undefined, never>;
  tls_version: ColumnType<string | null, string | null | undefined, never>;
  tls_cipher: ColumnType<string | null, string | null | undefined, never>;
  ztna_risk_score: Generated<number>;
  ztna_risk_factors: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, never>;
  ztna_session_score: ColumnType<number | null, number | null | undefined, never>;
  policy_id: Generated<string>;
  decision: AuditDecision;
  action: AuditAction;
  reason_code: ColumnType<string | null, string | null | undefined, never>;
  auth_method: ColumnType<AuthMethod | null, AuthMethod | null | undefined, never>;
  mfa_verified: Generated<boolean>;
  token_jti: ColumnType<string | null, string | null | undefined, never>;
  resource_type: ColumnType<string | null, string | null | undefined, never>;
  resource_id: ColumnType<string | null, string | null | undefined, never>;
  ticket_code: ColumnType<string | null, string | null | undefined, never>;
  chain_scope: Generated<string>;
  prev_entry_hash: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  entry_hash: Buffer;
  trace_id: string;
  metadata: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, never>;
}

export interface ZtnaSessionsTable {
  id: Generated<string>;
  user_id: string;
  device_fingerprint_hash: Buffer;
  device_trust_score: Generated<number>;
  network_zone: Generated<string>;
  asn: ColumnType<number | null, number | null | undefined, never>;
  user_agent_hash: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  ztna_risk_score: Generated<number>;
  ztna_risk_factors: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, never>;
  policy_id: Generated<string>;
  decision: Generated<AuditDecision>;
  mfa_verified: Generated<boolean>;
  mfa_verified_at: NullableTimestamp;
  step_up_required: Generated<boolean>;
  revoked_at: NullableTimestamp;
  revoked_reason: ColumnType<string | null, string | null | undefined, never>;
  source_ip: ColumnType<string | null, string | null | undefined, never>;
  source_ip_truncated: ColumnType<string | null, string | null | undefined, never>;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  session_id: ColumnType<string | null, string | null | undefined, never>;
  /** SHA-256 dari token. Token mentah hanya ada di sisi klien. */
  token_hash: Buffer;
  family_id: Generated<string>;
  generation: Generated<number>;
  replaced_by_id: ColumnType<string | null, string | null | undefined, never>;
  scopes: Generated<string[]>;
  issued_at: Timestamp;
  expires_at: Timestamp;
  used_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  revoked_reason: ColumnType<string | null, string | null | undefined, never>;
  bound_ip_truncated: ColumnType<string | null, string | null | undefined, never>;
  bound_device_hash: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  user_agent_hash: ColumnType<Buffer | null, Buffer | null | undefined, never>;
}

export interface MfaChallengesTable {
  id: Generated<string>;
  user_id: string;
  session_id: ColumnType<string | null, string | null | undefined, never>;
  challenge_hash: Buffer;
  ztna_risk_score: Generated<number>;
  risk_factors: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, never>;
  source_ip: ColumnType<string | null, string | null | undefined, never>;
  source_ip_truncated: ColumnType<string | null, string | null | undefined, never>;
  device_fingerprint_hash: ColumnType<Buffer | null, Buffer | null | undefined, never>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  consumed_at: NullableTimestamp;
  invalidated_at: NullableTimestamp;
  invalidated_reason: ColumnType<string | null, string | null | undefined, never>;
  created_at: Timestamp;
  expires_at: Timestamp;
}

export interface AduanRateLimitsTable {
  id: Generated<string>;
  subject_hash: Buffer;
  window_start: Timestamp;
  window_end: Timestamp;
  request_count: Generated<number>;
  blocked_until: NullableTimestamp;
}

/**
 * Peta skema lengkap. Nama tabel adalah kunci; nilainya adalah interface baris.
 */
export interface Database {
  notification_reads: { user_id: string; notification_key: string; read_at: Timestamp };
  aduan_replies: {
    id: string;
    aduan_id: string;
    author_role: AppRole;
    author_pseudonym_id: string | null;
    payload: Record<string, unknown>;
    kek_version: number;
    ztna_audit_id: string;
    created_at: Timestamp;
  };
  schema_migrations: SchemaMigrationsTable;
  kek_versions: KekVersionsTable;
  users: UsersTable;
  satgas_profiles: SatgasProfilesTable;
  aduan: AduanTable;
  aduan_crypto_layers: AduanCryptoLayersTable;
  aduan_attachments: AduanAttachmentsTable;
  aduan_status_history: AduanStatusHistoryTable;
  ztna_audit_logs: ZtnaAuditLogsTable;
  ztna_sessions: ZtnaSessionsTable;
  refresh_tokens: RefreshTokensTable;
  mfa_challenges: MfaChallengesTable;
  aduan_rate_limits: AduanRateLimitsTable;
}

/* -------------------------------------------------------------------------- */
/* Helper types                                                                 */
/* -------------------------------------------------------------------------- */

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

export type SatgasProfile = Selectable<SatgasProfilesTable>;
export type NewSatgasProfile = Insertable<SatgasProfilesTable>;

export type Aduan = Selectable<AduanTable>;
export type NewAduan = Insertable<AduanTable>;
export type AduanUpdate = Updateable<AduanTable>;

export type AduanCryptoLayer = Selectable<AduanCryptoLayersTable>;
export type AduanAttachment = Selectable<AduanAttachmentsTable>;

export type ZtnaAuditLog = Selectable<ZtnaAuditLogsTable>;
export type NewZtnaAuditLog = Insertable<ZtnaAuditLogsTable>;

/** Baris yang boleh dimasukkan peran `triase_app` (RLS + GRANT kolom). */
export type NewAduanForApp = Pick<
  NewAduan,
  | "ticket_code"
  | "pseudonym_id"
  | "category"
  | "submission_channel"
  | "submitted_at"
  | "submitted_network_zone"
  | "ztna_risk_score"
  | "crypto_algorithm"
  | "risk_score"
  | "risk_factors"
  | "body_ciphertext"
  | "body_iv"
  | "body_auth_tag"
  | "dek_wrapped"
  | "dek_wrap_iv"
  | "dek_wrap_auth_tag"
  | "kek_version"
  | "aad_context"
  | "aad_version"
  | "attachment_count"
  | "title_masked"
  | "retention_expires_at"
>;
