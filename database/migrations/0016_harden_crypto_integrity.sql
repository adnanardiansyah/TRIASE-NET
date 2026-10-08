-- ===========================================================================
-- TRIASE-Net :: 0016_harden_crypto_integrity.sql
--
-- TEMUAN AUDIT (hasil pemeriksaan langsung terhadap basis data + uji RLS):
--
--  1. HYBRID_DOUBLE mustahil dibuat.
--     `trg_aduan_crypto_layer_guard` berjalan BEFORE INSERT, sehingga tidak
--     pernah melihat baris `aduan_crypto_layers` (baris induk belum ada).
--     Akibatnya nilai v_count selalu 0 dan trigger selalu menolak.
--
--  2. Lapisan kedua mustahil ditulis.
--     Kebijakan `layers_no_direct_write` memakai WITH CHECK (false) untuk
--     INSERT, padahal peran aplikasi justru diberi hak INSERT.
--
--  3. Trigger lapisan rusak.
--     `trg_aduan_crypto_layers_updated_at` memanggil tg_set_updated_at()
--     yang menulis NEW.updated_at dan NEW.row_version, sedangkan tabel
--     `aduan_crypto_layers` tidak memiliki keduanya. Setiap UPDATE akan
--     gagal dengan "record NEW has no field".
--
--  4. Zero-Knowledge dapat dilanggar.
--     `triase_app` memegang hak UPDATE pada 30/30 kolom `aduan`, termasuk
--     body_ciphertext, dek_wrapped, kek_version, dan pseudonym_id.
--     Aplikasi (atau SQL injection di dalamnya) dapat menimpa ciphertext dan
--     memindahkan kepemilikan aduan.
--
--  5. Konsistensi risiko tidak ditegakkan.
--     Tidak ada aturan yang mengikat risk_score dengan crypto_algorithm,
--     padahal risk_band (GENERATED) sudah memetakan ambangnya.
--
--  6. Mahasiswa tidak boleh melampirkan bukti.
--     `attachments_insert_staff` hanya menerima SATGAS/ADMIN, padahal
--    ropolis pengaduan student-facing harus bisa melampirkan bukti.
--
--  7. Sinkronisasi jumlah lampiran patah oleh RLS.
--     `fn_sync_attachment_count` dijalankan sebagai pemanggil (triase_app),
--     sementara kebijakan UPDATE `aduan` hanya mengizinkan SATGAS/ADMIN.
--     Setiap unggahan lampiran oleh mahasiswa akan gagal.
--
--  8. Semua kebijakan RLS ditujukan ke PUBLIC.
--     Perbaiki menjadi eksplisit triase_app (pertahanan berlapis).
--
-- CATATAN MIGRASI: berkas 0014 SUDAH diterapkan, sehingga berkas ini
--).$$ganti hak akses lewat REVOKE/GRANT dan DROP/CREATE yang idempoten.
-- Tidak ada data yang perlu dimigrasikan karena tabel masih kosong.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. KONSISTENSI RISIKO <-> ALGORITMA
--    risk_score  0..29  -> AES_256_GCM           (risk_band LOW)
--    risk_score 30..69  -> CHACHA20_POLY1305     (risk_band MEDIUM)
--    risk_score 70..100 -> HYBRID_DOUBLE         (risk_band HIGH)
--   *) Aturan ini menjadikan pilihan enkripsi adaptif tidak dapat
--    dibohongi oleh kode aplikasi.
-- ---------------------------------------------------------------------------
ALTER TABLE public.aduan
    DROP CONSTRAINT IF EXISTS aduan_risk_algorithm_ck;

ALTER TABLE public.aduan
    ADD CONSTRAINT aduan_risk_algorithm_ck
        CHECK (
            CASE
                WHEN risk_score < 30 THEN crypto_algorithm = 'AES_256_GCM'
                WHEN risk_score < 70 THEN crypto_algorithm = 'CHACHA20_POLY1305'
                ELSE crypto_algorithm = 'HYBRID_DOUBLE'
                END
            );

COMMENT ON CONSTRAINT aduan_risk_algorithm_ck ON public.aduan IS
    'Menjamin crypto_algorithm selalu sesuai risk_band dari penilaian risiko adaptif. Mencegah kebocoran data meski ciphertext berhasil ditiru.';

-- ---------------------------------------------------------------------------
-- 2. PERBATASI UPDATE: kolom yang boleh diubah setelah enkripsi
--    Ciphertext, IV, tag, DEK ter-wrap, kek_version, pseudonym_id, dan
--    risk_score menjadi BACA SAJA bagi aplikasi.
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.aduan FROM triase_app;

GRANT UPDATE (
    status,
    closed_at,
    assigned_to,
    ztna_risk_score,
    title_masked,
    updated_at,
    row_version
) ON public.aduan TO triase_app;

-- ---------------------------------------------------------------------------
-- 3. HYBRID_DOUBLE: ubah penjaga menjadi constraint trigger yang DEFERRED
--   _row-level AFTER_, agar baris induk DAN baris lapisan dapat dibuat dalam
--    satu transaksi, baru diverifikasi saat COMMIT.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_aduan_crypto_layer_guard ON public.aduan;

CREATE CONSTRAINT TRIGGER trg_aduan_crypto_layer_guard
    AFTER INSERT OR UPDATE
    ON public.aduan
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guard_crypto_layers();

-- ---------------------------------------------------------------------------
-- 4. Izinkan penulisan lapisan kedua, tetapi HANYA pada induk yang terlihat
--    oleh aktor saat ini (subquery tunduk pada RLS `aduan`).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS layers_no_direct_write ON public.aduan_crypto_layers;

CREATE POLICY layers_insert_scoped
    ON public.aduan_crypto_layers
    FOR INSERT
    TO triase_app
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.aduan a
            WHERE a.id = aduan_crypto_layers.aduan_id
        )
    );

-- 5. Lapisan hanya boleh dibaca satuan tugas/ADMIN, bukan mahasiswa.
DROP POLICY IF EXISTS layers_select_scoped ON public.aduan_crypto_layers;

CREATE POLICY layers_select_scoped
    ON public.aduan_crypto_layers
    FOR SELECT
    TO triase_app
    USING (
        fn_ztna_actor_role() IN ('SATGAS', 'ADMIN')
            AND EXISTS (
                SELECT 1
                FROM public.aduan a
                WHERE a.id = aduan_crypto_layers.aduan_id
            )
    );

-- ---------------------------------------------------------------------------
-- 6. Buang trigger lapisan yang rusak; lapisan bersifat append-only
--    (peran aplikasi memang tidak memegang UPDATE/DELETE).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_aduan_crypto_layers_updated_at ON public.aduan_crypto_layers;

REVOKE UPDATE, DELETE, TRUNCATE ON public.aduan_crypto_layers FROM triase_app;

-- ---------------------------------------------------------------------------
-- 7. Student-facing: izinkan mahasiswa melampirkan bukti pada aduan miliknya.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS attachments_insert_staff ON public.aduan_attachments;

CREATE POLICY attachments_insert_scoped
    ON public.aduan_attachments
    FOR INSERT
    TO triase_app
    WITH CHECK (
        fn_ztna_actor_role() IN ('SATGAS', 'ADMIN')
            OR (
                fn_ztna_actor_role() = 'MAHASISWA'
                    AND EXISTS (
                        SELECT 1
                        FROM public.aduan a
                        WHERE a.id = aduan_attachments.aduan_id
                            AND a.pseudonym_id = fn_ztna_pseudonym()
                    )
                )
    );

-- ---------------------------------------------------------------------------
-- 8. fn_sync_attachment_count: SECURITY DEFINER + search_path terkunci.
--    Wajib SECURITY DEFINER karena policies UPDATE `aduan` hanya mengizinkan
--    SATGAS/ADMIN, sedangkan trigger ini dapat dipicu oleh unggahan mahasiswa.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_attachment_count()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $fn$
    DECLARE
        v_aduan_id uuid;
        v_count    integer;
    BEGIN
        v_aduan_id := COALESCE(NEW.aduan_id, OLD.aduan_id);

        SELECT count(*)
        INTO v_count
        FROM public.aduan_attachments
        WHERE aduan_id = v_aduan_id;

        UPDATE public.aduan
        SET attachment_count = v_count
        WHERE id = v_aduan_id;

        RETURN NULL;
    END
    $fn$;

-- ---------------------------------------------------------------------------
-- 9. Persempit target kebijakan RLS dari PUBLIC ke triase_app.
-- ---------------------------------------------------------------------------
ALTER POLICY aduan_insert_own ON public.aduan TO triase_app;
ALTER POLICY aduan_select_scoped ON public.aduan TO triase_app;
ALTER POLICY aduan_update_staff ON public.aduan TO triase_app;

ALTER POLICY attachments_select_scoped ON public.aduan_attachments TO triase_app;

ALTER POLICY status_history_insert_staff ON public.aduan_status_history TO triase_app;
ALTER POLICY status_history_read_staff ON public.aduan_status_history TO triase_app;

ALTER POLICY mfa_challenges_owner ON public.mfa_challenges TO triase_app;
ALTER POLICY refresh_tokens_owner ON public.refresh_tokens TO triase_app;
ALTER POLICY satgas_select_scoped ON public.satgas_profiles TO triase_app;
ALTER POLICY users_select_scoped ON public.users TO triase_app;
ALTER POLICY sessions_select_scoped ON public.ztna_sessions TO triase_app;

-- Kebijakan audit tetap untuk public karena fn_seal_audit_entry dan
-- fn_ztna_* tetap harus dapat dievaluasi oleh peran auditor.
ALTER POLICY audit_insert_system ON public.ztna_audit_logs TO triase_app, triase_auditor;
ALTER POLICY audit_read_auditor ON public.ztna_audit_logs TO triase_auditor;

-- ---------------------------------------------------------------------------
-- 10. PENEGAKAN. Migrasi ini gagal dan meninggalkan basis data utuh
--     bila ada kondisi yang seharusnya mustahil.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad text;
BEGIN
    -- (a) Tidak ada hak UPDATE pada kolom kripto yang ter-seal.
    SELECT string_agg(column_name, ', ')
    INTO v_bad
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'aduan'
      AND grantee = 'triase_app'
      AND privilege_type = 'UPDATE'
      AND column_name IN ('body_ciphertext', 'body_iv', 'body_auth_tag',
                          'dek_wrapped', 'dek_wrap_iv', 'dek_wrap_auth_tag',
                          'kek_version', 'pseudonym_id', 'risk_score',
                          'crypto_algorithm', 'attachment_count');

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'triase_app masih boleh mengubah kolom ter-seal: %', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- (b) Tidak ada hak hapus pada tabel bukti maupun lapisan.
    SELECT string_agg(DISTINCT table_name, ', ')
    INTO v_bad
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'triase_app'
      AND privilege_type IN ('DELETE', 'TRUNCATE')
      AND table_name IN ('aduan', 'aduan_attachments', 'aduan_crypto_layers',
                         'ztna_audit_logs', 'aduan_status_history');

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'triase_app memegang hak hapus pada tabel bukti: %', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- (c) Tidak ada kebijakan RLS yang masih dititagihkan ke PUBLIC.
    SELECT string_agg(tablename || '.' || policyname, ', ')
    INTO v_bad
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles::text = '{public}';

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Kebijakan RLS masih ditujukan ke PUBLIC: %', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- (d) Penjaga lapisan harus berstatus DEFERRABLE.
    SELECT count(*)
    INTO v_bad
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal
      AND c.relname = 'aduan'
      AND t.tgname = 'trg_aduan_crypto_layer_guard'
      AND t.tgdeferrable;

    IF btrim(COALESCE(v_bad, '0')) = '0' THEN
        RAISE EXCEPTION 'Penjaga lapisan enkripsi belum DEFERRABLE.'
            USING ERRCODE = 'internal_error';
    END IF;
END
$$;
