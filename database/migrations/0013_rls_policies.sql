-- ===========================================================================
-- TRIASE-Net :: 0013_rls_policies.sql
-- Row Level Security (RLS) - lapis kedua ZTNA di sisi basis data.
--
-- Aplikasi (PEP di middleware) sudah menolak permintaan berisiko, tetapi RLS
-- menjamin keputusan itu tidak dapat dilewati bila ada bug aplikasi atau kueri
-- yang ditulis tanpa filter.
--
-- Syarat: peran runtime `triase_app` tidak memiliki BYPASSRLS dan bukan
-- pemilik tabel. Setiap transaksi wajib memasang konteks aktor lebih dahulu
-- melalui fn_ztna_set_actor_context().
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Fungsi pembaca konteks ZTNA
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ztna_actor_id()
    RETURNS uuid
    LANGUAGE sql
    STABLE
AS $$
    SELECT NULLIF(current_setting('triase.actor_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.fn_ztna_actor_role()
    RETURNS public.app_role
    LANGUAGE sql
    STABLE
AS $$
    SELECT NULLIF(current_setting('triase.actor_role', true), '')::public.app_role;
$$;

CREATE OR REPLACE FUNCTION public.fn_ztna_pseudonym()
    RETURNS text
    LANGUAGE sql
    STABLE
AS $$
    SELECT NULLIF(current_setting('triase.pseudonym_id', true), '');
$$;

CREATE OR REPLACE FUNCTION public.fn_ztna_session_id()
    RETURNS uuid
    LANGUAGE sql
    STABLE
AS $$
    SELECT NULLIF(current_setting('triase.session_id', true), '')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- 2. Pemasang konteks aktor
--    SECURITY DEFINER + search_path terkunci. is_local = true berarti
--    pengaturan hilang otomatis di akhir transaksi, sehingga tidak bocor ke
--    koneksi berikutnya yang memakai connection pool.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ztna_set_actor_context(
    p_user_id    uuid,
    p_role       public.app_role,
    p_pseudonym  text,
    p_session_id uuid DEFAULT NULL
)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
AS $$
BEGIN
    -- Tolak klaim yang tidak konsisten dengan data pengguna.
    IF p_user_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM public.users WHERE id = p_user_id AND role = p_role
        ) THEN
        RAISE EXCEPTION 'Konteks ZTNA tidak konsisten dengan data pengguna.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    PERFORM set_config('triase.actor_id', COALESCE(p_user_id::text, ''), true);
    PERFORM set_config('triase.actor_role', COALESCE(p_role::text, ''), true);
    PERFORM set_config('triase.pseudonym_id', COALESCE(p_pseudonym, ''), true);
    PERFORM set_config('triase.session_id', COALESCE(p_session_id::text, ''), true);
END;
$$;

COMMENT ON FUNCTION public.fn_ztna_set_actor_context(uuid, public.app_role, text, uuid) IS
    'Dipanggil sekali per transaksi sebelum query. Memasang GUC triase.* yang dibaca seluruh kebijakan RLS.';

-- ---------------------------------------------------------------------------
-- 3. Resolver otorisasi satuan tugas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ztna_authorized_categories()
    RETURNS public.aduan_category[]
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_catalog
AS $$
    SELECT COALESCE(sp.authorized_categories, '{}'::public.aduan_category[])
    FROM public.satgas_profiles sp
    WHERE sp.user_id = public.fn_ztna_actor_id();
$$;

-- Catatan: menghasilkan 0 bila akun tidak bertugas atau mandatnya kedaluwarsa,
-- sehingga kebijakan RLS otomatis menutup akses dekripsi.
CREATE OR REPLACE FUNCTION public.fn_ztna_max_decrypt_risk_score()
    RETURNS smallint
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_catalog
AS $$
    SELECT COALESCE(max(sp.max_decrypt_risk_score), 0)
    FROM public.satgas_profiles sp
    WHERE sp.user_id = public.fn_ztna_actor_id()
      AND sp.duty_status = 'ON_DUTY'
      AND (sp.expires_at IS NULL OR sp.expires_at > now());
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS pada `aduan`
-- ---------------------------------------------------------------------------
ALTER TABLE public.aduan ENABLE ROW LEVEL SECURITY;

-- Mahasiswa: hanya melihat aduan dengan Pseudonym ID-nya sendiri.
-- Satuan tugas: hanya kategori yang diotorisasi, di bawah ambang, dan ON_DUTY.
CREATE POLICY aduan_select_scoped ON public.aduan
    FOR SELECT
    USING (
        (
            public.fn_ztna_actor_role() = 'MAHASISWA'
                AND pseudonym_id = public.fn_ztna_pseudonym()
            )
        OR (
            public.fn_ztna_actor_role() IN ('SATGAS', 'ADMIN')
                AND category = ANY (public.fn_ztna_authorized_categories())
                AND risk_score <= public.fn_ztna_max_decrypt_risk_score()
            )
        );

-- Penulisan: hanya menyisipkan baris dengan Pseudonym ID milik sendiri.
CREATE POLICY aduan_insert_own ON public.aduan
    FOR INSERT
    WITH CHECK (
        (
            public.fn_ztna_actor_role() = 'MAHASISWA'
                AND pseudonym_id = public.fn_ztna_pseudonym()
            )
        OR public.fn_ztna_actor_role() = 'ADMIN'
        );

-- Pembaruan: hanya satuan tugas pada kategori terotorisasi.
-- Kolom ciphertext dilindungi oleh GRANT tingkat kolom pada 0014.
CREATE POLICY aduan_update_staff ON public.aduan
    FOR UPDATE
    USING (
        public.fn_ztna_actor_role() IN ('SATGAS', 'ADMIN')
            AND category = ANY (public.fn_ztna_authorized_categories())
        )
    WITH CHECK (
        public.fn_ztna_actor_role() IN ('SATGAS', 'ADMIN')
            AND category = ANY (public.fn_ztna_authorized_categories())
        );

-- Tidak ada policy DELETE, sehingga DELETE ditolak untuk peran runtime.
-- Penghapusan hanya lewat prosedur kripto-shredding yang dikontrol.

-- ---------------------------------------------------------------------------
-- 5. RLS pada `aduan_crypto_layers` (mewarisi aturan induk lewat EXISTS)
-- ---------------------------------------------------------------------------
ALTER TABLE public.aduan_crypto_layers ENABLE ROW LEVEL SECURITY;

CREATE POLICY layers_select_scoped ON public.aduan_crypto_layers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.aduan a WHERE a.id = aduan_id
        )
        );

-- Lapisan hanya boleh ditulis lewat proses enkripsi di sisi server.
CREATE POLICY layers_no_direct_write ON public.aduan_crypto_layers
    FOR INSERT
    WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 6. RLS pada `aduan_attachments`
-- ---------------------------------------------------------------------------
ALTER TABLE public.aduan_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY attachments_select_scoped ON public.aduan_attachments
    FOR SELECT
    USING (
        public.fn_ztna_actor_role() IN ('SATGAS', 'ADMIN')
            AND EXISTS (
                SELECT 1 FROM public.aduan a WHERE a.id = aduan_id
            )
        );

CREATE POLICY attachments_insert_staff ON public.aduan_attachments
    FOR INSERT
    WITH CHECK (public.fn_ztna_actor_role() IN ('SATGAS', 'ADMIN'));

-- ---------------------------------------------------------------------------
-- 7. RLS pada `ztna_audit_logs`
-- ---------------------------------------------------------------------------
ALTER TABLE public.ztna_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_read_auditor ON public.ztna_audit_logs
    FOR SELECT
    USING (public.fn_ztna_actor_role() IN ('SATGAS', 'ADMIN'));

CREATE POLICY audit_insert_system ON public.ztna_audit_logs
    FOR INSERT
    WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 8. RLS pada `users`
--    Mahasiswa hanya melihat dirinya sendiri; tenaga melihat profil tim untuk
--    kebutuhan assignment. Kolom kredensial dikunci oleh GRANT tingkat kolom.
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_scoped ON public.users
    FOR SELECT
    USING (
        id = public.fn_ztna_actor_id()
            OR public.fn_ztna_actor_role() IN ('SATGAS', 'ADMIN')
        );

-- ---------------------------------------------------------------------------
-- 9. RLS pada `satgas_profiles`
-- ---------------------------------------------------------------------------
ALTER TABLE public.satgas_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY satgas_select_scoped ON public.satgas_profiles
    FOR SELECT
    USING (
        user_id = public.fn_ztna_actor_id()
            OR public.fn_ztna_actor_role() = 'ADMIN'
        );

-- ---------------------------------------------------------------------------
-- 10. RLS pada `ztna_sessions`
-- ---------------------------------------------------------------------------
ALTER TABLE public.ztna_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_select_scoped ON public.ztna_sessions
    FOR SELECT
    USING (
        user_id = public.fn_ztna_actor_id()
            OR public.fn_ztna_actor_role() = 'ADMIN'
        );

-- ---------------------------------------------------------------------------
-- 11. RLS pada tabel token (ketat: hanya pemilik)
-- ---------------------------------------------------------------------------
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_owner ON public.refresh_tokens
    FOR SELECT
    USING (user_id = public.fn_ztna_actor_id());

ALTER TABLE public.mfa_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY mfa_challenges_owner ON public.mfa_challenges
    FOR SELECT
    USING (user_id = public.fn_ztna_actor_id());

-- ---------------------------------------------------------------------------
-- 12. RLS pada `aduan_status_history`
-- ---------------------------------------------------------------------------
ALTER TABLE public.aduan_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY status_history_read_staff ON public.aduan_status_history
    FOR SELECT
    USING (public.fn_ztna_actor_role() IN ('SATGAS', 'ADMIN'));

CREATE POLICY status_history_insert_staff ON public.aduan_status_history
    FOR INSERT
    WITH CHECK (public.fn_ztna_actor_role() IN ('SATGAS', 'ADMIN'));
