-- ===========================================================================
-- TRIASE-Net :: 0014_grants_and_privileges.sql
-- Penetapan hak akses (Least Privilege) per peran.
--
-- Prinsip:
--   * Peran runtime `triase_app` TIDAK MELEWATI RLS (bukan pemilik tabel,
--     tidak diberi BYPASSRLS).
--   * Kolom kredensial (password_hash, rahasia TOTP) tidak pernah bisa dibaca
--     atau ditulis langsung oleh peran runtime.
--   * Tidak ada hak DELETE/TRUNCATE pada tabel log dan riwayat.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Cabut semua hak default pada tabel milik skema public
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Peran auditor: hanya baca
-- ---------------------------------------------------------------------------
GRANT SELECT ON
    public.users,
    public.satgas_profiles,
    public.aduan,
    public.aduan_crypto_layers,
    public.aduan_attachments,
    public.aduan_status_history,
    public.ztna_audit_logs
TO triase_auditor;

-- ---------------------------------------------------------------------------
-- 3. Peran aplikasi - GRANT dasar
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON
    public.aduan,
    public.aduan_attachments,
    public.aduan_status_history
TO triase_app;

GRANT SELECT ON
    public.kek_versions,
    public.ztna_audit_logs
TO triase_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.ztna_sessions,
    public.refresh_tokens,
    public.mfa_challenges,
    public.aduan_rate_limits
TO triase_app;

-- Baris ztna_audit_logs boleh disisipkan (audit writer) tetapi tidak
-- pernah diubah atau dihapus.
GRANT INSERT ON public.ztna_audit_logs TO triase_app;

-- Lapisan enkripsi: server boleh menuliskannya, aplikasi tidak.
GRANT INSERT ON public.aduan_crypto_layers TO triase_app;

GRANT USAGE, SELECT ON SEQUENCE public.ztna_audit_logs_id_seq TO triase_app;

-- ---------------------------------------------------------------------------
-- 4. `users` - GRANT tingkat kolom
--    password_hash TIDAK termasuk dalam daftar mana pun.
-- ---------------------------------------------------------------------------
GRANT SELECT (
    id, role, status, identity_provider, subject_ref,
    institutional_email, email_normalized, display_name,
    mfa_enrolled, mfa_enrolled_at, mfa_last_verified,
    failed_login_count, last_failed_login, locked_until,
    last_login_at, last_login_ip, last_login_network_zone,
    password_changed_at, row_version, created_at, updated_at
) ON public.users TO triase_app;

GRANT INSERT (
    id, role, status, identity_provider, subject_ref,
    institutional_email, display_name, password_hash,
    mfa_enrolled, mfa_enrolled_at
) ON public.users TO triase_app;

GRANT UPDATE (
    display_name, password_hash, mfa_enrolled, mfa_enrolled_at,
    mfa_last_verified, failed_login_count, last_failed_login,
    locked_until, last_login_at, last_login_ip, last_login_network_zone,
    password_changed_at
) ON public.users TO triase_app;

-- ---------------------------------------------------------------------------
-- 5. `satgas_profiles` - GRANT tingkat kolom
-- ---------------------------------------------------------------------------
GRANT SELECT (
    user_id, employee_id, unit_name, position_title,
    authorized_categories, max_decrypt_risk_score, clearance_level,
    duty_status, requires_step_up, jwks_kid, public_key_algorithm,
    kek_access_version, mfa_recovery_used_count,
    approved_by, approved_at, expires_at, row_version,
    created_at, updated_at
) ON public.satgas_profiles TO triase_app;

GRANT INSERT (
    user_id, employee_id, unit_name, position_title,
    authorized_categories, max_decrypt_risk_score, clearance_level,
    duty_status, requires_step_up, jwks_kid, public_key_algorithm,
    public_key, kek_access_version,
    mfa_secret_ciphertext, mfa_secret_iv, mfa_secret_auth_tag,
    mfa_secret_wrapped_dek, mfa_secret_wrap_iv, mfa_secret_wrap_auth_tag,
    mfa_secret_kek_version, mfa_recovery_hashes, approved_by, approved_at
) ON public.satgas_profiles TO triase_app;

-- Hanya boleh mengubah status tugas, ambang risiko, dan recovery code.
-- Envelope rahasia TOTP sengaja tidak dapat diubah dari peran runtime.
GRANT UPDATE (
    unit_name, position_title, authorized_categories,
    max_decrypt_risk_score, clearance_level, duty_status,
    requires_step_up, kek_access_version,
    mfa_recovery_hashes, mfa_recovery_used_count, expires_at
) ON public.satgas_profiles TO triase_app;

-- ---------------------------------------------------------------------------
-- 6. `kek_versions` - hanya baca metadata, tidak ada akses tulis
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.kek_versions FROM triase_app;

-- ---------------------------------------------------------------------------
-- 7. `aduan` - GRANT tingkat kolom
-- Mahasiswa butuh INSERT pada seluruh ciphertext, tetapi tidak boleh
--    mengubah status, risiko, atau field milik satuan tugas.
-- ---------------------------------------------------------------------------
GRANT SELECT (
    id, ticket_code, pseudonym_id, category, submission_channel, status,
    submitted_at, submitted_network_zone, ztna_risk_score,
    crypto_algorithm, risk_score, risk_band, risk_factors,
    body_ciphertext, body_iv, body_auth_tag,
    dek_wrapped, dek_wrap_iv, dek_wrap_auth_tag, kek_version,
    aad_context, aad_version, attachment_count, title_masked,
    assigned_to, closed_at, retention_expires_at, row_version,
    created_at, updated_at
) ON public.aduan TO triase_app;

-- INSERT: kolom yang diperbolehkan saat pengajuan. status, risk_score,
-- serta id tetap dikunci; nilainya ditentukan modul kriptografi.
GRANT INSERT (
    id, ticket_code, pseudonym_id, category, submission_channel,
    submitted_at, submitted_network_zone, ztna_risk_score,
    crypto_algorithm, risk_score, risk_factors,
    body_ciphertext, body_iv, body_auth_tag,
    dek_wrapped, dek_wrap_iv, dek_wrap_auth_tag, kek_version,
    aad_context, aad_version, attachment_count, title_masked,
    retention_expires_at
) ON public.aduan TO triase_app;

-- UPDATE: hanya kolom status & penugasan oleh satuan tugas.
GRANT UPDATE (
    status, assigned_to, title_masked, closed_at, retention_expires_at
) ON public.aduan TO triase_app;

-- ---------------------------------------------------------------------------
-- 8. `aduan_crypto_layers`
-- ---------------------------------------------------------------------------
GRANT SELECT (
    id, aduan_id, layer_index, algorithm, ciphertext, iv, auth_tag,
    wrapped_dek, wrapped_dek_iv, wrapped_dek_tag, kek_version,
    aad_context, created_at
) ON public.aduan_crypto_layers TO triase_app;

GRANT INSERT (
    aduan_id, layer_index, algorithm, ciphertext, iv, auth_tag,
    wrapped_dek, wrapped_dek_iv, wrapped_dek_tag, kek_version, aad_context
) ON public.aduan_crypto_layers TO triase_app;

-- ---------------------------------------------------------------------------
-- 9. `aduan_attachments`
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.aduan_attachments TO triase_app;

-- ---------------------------------------------------------------------------
-- 10. Fungsi - hanya yang diperlukan aplikasi
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION
    public.fn_ztna_set_actor_context(uuid, public.app_role, text, uuid)
TO triase_app;

GRANT EXECUTE ON FUNCTION
    public.fn_ztna_actor_id(),
    public.fn_ztna_actor_role(),
    public.fn_ztna_pseudonym(),
    public.fn_ztna_session_id(),
    public.fn_ztna_authorized_categories(),
    public.fn_ztna_max_decrypt_risk_score()
TO triase_app;

GRANT EXECUTE ON FUNCTION
    public.tg_set_updated_at(),
    public.fn_sync_attachment_count()
TO triase_app;

-- Fungsi verifikasi rantai hanya untuk auditor, bukan aplikasi.
GRANT EXECUTE ON FUNCTION
    public.fn_verify_audit_chain(text, timestamptz, timestamptz)
TO triase_auditor;

-- ---------------------------------------------------------------------------
-- 11. Penegakan ulang: tolak DELETE/TRUNCATE di mana pun
-- ---------------------------------------------------------------------------
REVOKE DELETE, TRUNCATE ON
    public.ztna_audit_logs,
    public.aduan_status_history,
    public.aduan
FROM triase_app, triase_auditor;

-- ---------------------------------------------------------------------------
-- 12. Anti-BYPASS: pastikan peran aplikasi tidak punya privilege escalation
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM triase_app, triase_auditor;
REVOKE EXECUTE ON FUNCTION public.fn_guard_kek_material() FROM triase_app, triase_auditor;
REVOKE EXECUTE ON FUNCTION public.fn_ensure_audit_partition(date) FROM triase_app, triase_auditor;

DO
$$
DECLARE
    v_bad text;
BEGIN
    -- Pemeriksaan mandiri: peran aplikasi tidak boleh punya rol CREATE, SUPERUSER,
    -- atau BYPASSRLS.
    IF EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = 'triase_app'
          AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'Peran triase_app memiliki privilege yang tidak diizinkan.';
    END IF;
END
$$;
