-- ===========================================================================
-- TRIASE-Net :: 0015_revoke_delete_and_maintenance_role.sql
--
-- TEMUAN AUDIT (hasil `npm run db:verify`):
--   Peran `triase_app` memegang hak DELETE pada empat tabel operasional:
--     ztna_sessions, refresh_tokens, mfa_challenges, aduan_rate_limits
--
-- DASAR KEPUTUSAN:
--   Tidak ada tabel pun yang membutuhkan peran aplikasi untuk menghapus baris.
--   Setiap kebutuhan tersebut punya padanan yang lebih aman:
--     ztna_sessions      -> UPDATE revoked_at / revoked_reason (mencatat alasan)
--     refresh_tokens     -> UPDATE used_at / revoked_at (+ deteksi reuse)
--     mfa_challenges     -> UPDATE consumed_at / invalidated_at
--     aduan_rate_limits  -> UPDATE request_count / blocked_until
--
--   Penghapusan fisik (retensi/bersihkan jendela geser) adalah operasi
--   terjadwal, bukan operasi request. Operation tersebut dipindah ke peran
--   `triase_maintenance` yang tidak dipakai aplikasi web.
--
--   Hak DELETE pada tabel bukti (aduan, lampiran, audit, riwayat status)
--   tetap DITOLAK untuk semua peran non-migrator. Penghapusan bukti hanya
--   dapat dilakukan lewat prosedur kripto-shredding.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Peran pemeliharaan terjadwal (NOLOGIN)
-- ---------------------------------------------------------------------------
DO
$$
    DECLARE
        v_role text;
    BEGIN
        FOREACH v_role IN ARRAY ARRAY ['triase_maintenance']
            LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', v_role);
                END IF;
            END LOOP;
    END
$$;

GRANT USAGE ON SCHEMA public TO triase_maintenance;

-- ---------------------------------------------------------------------------
-- 2. Cabut DELETE dari peran aplikasi
-- ---------------------------------------------------------------------------
REVOKE DELETE, TRUNCATE ON
    public.ztna_sessions,
    public.refresh_tokens,
    public.mfa_challenges,
    public.aduan_rate_limits
FROM triase_app;

-- ---------------------------------------------------------------------------
-- 3. Batasi peran pemeliharaan pada empat tabel operasional saja
--    Sengaja TIDAK diberi akses ke: aduan, aduan_attachments,
--    aduan_crypto_layers, ztna_audit_logs, aduan_status_history.
-- ---------------------------------------------------------------------------
GRANT SELECT, DELETE ON
    public.ztna_sessions,
    public.refresh_tokens,
    public.mfa_challenges,
    public.aduan_rate_limits
TO triase_maintenance;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO triase_maintenance;

-- ---------------------------------------------------------------------------
-- 4. Penegakan fungsi untuk job terjadwal
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.fn_guard_kek_material() FROM triase_maintenance;
REVOKE EXECUTE ON FUNCTION public.fn_ensure_audit_partition(date) FROM triase_app, triase_auditor, triase_maintenance;

-- ---------------------------------------------------------------------------
-- 5. Penegakan: tidak ada tabel yang boleh dihapus oleh triase_app
--    Bila migrasi berikutnya keliru memberi DELETE lagi, migrasi ini gagal
--    dan meninggalkan basis data dalam keadaan aman.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_offenders text;
BEGIN
    SELECT string_agg(DISTINCT table_name, ', ')
    INTO v_offenders
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'triase_app'
      AND privilege_type IN ('DELETE', 'TRUNCATE');

    IF v_offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'Peran triase_app masih memegang hak hapus pada: %',
            v_offenders
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;

COMMENT ON ROLE triase_maintenance IS
    'Peran NOLOGIN untuk job terjadwal (retensi token, pembersihan jendela rate limit). Tidak dipakai aplikasi web, dan tidak diberi akses ke tabel bukti.';
