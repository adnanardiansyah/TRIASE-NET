-- ===========================================================================
-- TRIASE-Net :: 0005_users.sql
-- Tabel aktor: MAHASISWA, SATGAS, ADMIN.
--
-- Prinsip "Zero-Knowledge" ditegakkan di level basis data:
--   * MAHASISWA  -> TIDAK BOLEH punya password_hash (harus OIDC/SIB)
--   * MAHASISWA  -> TIDAK BOLEH punya display_name (identitas asli tidak
--                   disimpan; Aduan hanya menyimpan Pseudonym ID)
--   * SATGAS/ADMIN -> WAJIB punya password_hash (Argon2id) dan display_name
-- ===========================================================================

CREATE TABLE public.users
(
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    role               public.app_role     NOT NULL,
    status             public.user_status  NOT NULL DEFAULT 'PENDING',
    identity_provider  public.identity_provider NOT NULL DEFAULT 'LOCAL',

    -- Subjek OIDC/SIB (opaque `sub`). BUKAN NIM/NIK.
    subject_ref        text,

    institutional_email text               NOT NULL,

    -- Normalisasi otomatis untuk enforceable unique case-insensitive.
    email_normalized   text GENERATED ALWAYS AS (lower(btrim(institutional_email))) STORED,

    -- Hanya untuk tenaga. Untuk MAHASISWA harus NULL (lihat CHECK di bawah).
    display_name       text,

    -- Hash kata sandi. NULL khusus akun OIDC.
    -- Prefix: $argon2id$ (produksi) atau $scrypt$ (khusus dev).
    password_hash      text,

    -- Status MFA
    mfa_enrolled       boolean            NOT NULL DEFAULT false,
    mfa_enrolled_at    timestamptz,
    mfa_last_verified  timestamptz,

    -- Brute-force protection
    failed_login_count smallint           NOT NULL DEFAULT 0,
    last_failed_login  timestamptz,
    locked_until       timestamptz,

    -- Jejak autentikasi terakhir (bukan identitas pelapor)
    last_login_at      timestamptz,
    last_login_ip      inet,
    last_login_network_zone text,

    password_changed_at timestamptz,
    row_version        integer             NOT NULL DEFAULT 0,
    created_at         timestamptz         NOT NULL DEFAULT now(),
    updated_at         timestamptz         NOT NULL DEFAULT now(),

    -- ---------------------------------------------------------------------
    -- Constraint integritas &amp; privasi identitas
    -- ---------------------------------------------------------------------
    CONSTRAINT users_email_format_ck
        CHECK (institutional_email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),

    CONSTRAINT users_email_unique_uk
        UNIQUE (email_normalized),

    CONSTRAINT users_subject_uk
        UNIQUE (identity_provider, subject_ref),

    -- Mahasiswa: TIDAK BOLEH menyimpan kredensial lokal.
    CONSTRAINT users_mahasiswa_no_password_ck
        CHECK (role <> 'MAHASISWA' OR password_hash IS NULL),

    -- Mahasiswa: TIDAK BOLEH menyimpan nama tampilan (identitas asli).
    CONSTRAINT users_mahasiswa_no_display_name_ck
        CHECK (role <> 'MAHASISWA' OR display_name IS NULL),

    -- OIDC: subjek WAJIB ada. Local: subjek harus NULL.
    CONSTRAINT users_oidc_subject_ck
        CHECK (
            (identity_provider IN ('OIDC', 'SIB') AND subject_ref IS NOT NULL)
                OR (identity_provider = 'LOCAL' AND subject_ref IS NULL)
            ),

    -- Tenaga: WAJIB punya hash kata sandi dan nama tampilan.
    -- Prefix hash menyatakan algoritmanya (PHC-style):
    --   $argon2id$ = produksi (lihat src/lib/auth/password.ts, Tahap 3)
    --   $scrypt$   = khusus pengembangan lokal (scripts/seed.ts) agar skrip
    --                tidak memerlukan dependensi native.
    -- Pada lingkungan produksi, persempit regex ini menjadi hanya argon2id.
    CONSTRAINT users_staff_credentials_ck
        CHECK (
            role = 'MAHASISWA'
                OR (
                    password_hash ~ '^\$(argon2id|scrypt)\$'
                        AND display_name IS NOT NULL
                    )
            ),

    CONSTRAINT users_login_count_ck
        CHECK (failed_login_count >= 0 AND failed_login_count <= 100),

    CONSTRAINT users_mfa_timestamp_ck
        CHECK (mfa_enrolled = false OR mfa_enrolled_at IS NOT NULL),

    CONSTRAINT users_locked_until_ck
        CHECK (locked_until IS NULL OR locked_until > last_failed_login)
);

COMMENT ON TABLE public.users IS
    'Aktor sistem (MAHASISWA/SATGAS/ADMIN). TIDAK memuat NIM, NIK, atau nama asli mahasiswa.';
COMMENT ON COLUMN public.users.subject_ref IS
    'Opaque OIDC `sub`. Identitas asli mahasiswa TIDAK pernah masuk ke basis data ini.';
COMMENT ON COLUMN public.users.password_hash IS
    'Hash kata sandi berprefiks algoritma: $argon2id$ (produksi) atau $scrypt$ (dev). Dibatasi hanya untuk peran SATGAS dan ADMIN.';
COMMENT ON COLUMN public.users.institutional_email IS
    'Email institusi. Untuk mahasiswa, nilai ini TIDAK pernah disalin ke tabel aduan; yang dipakai hanyalah Pseudonym ID hasil HMAC.';

-- ---------------------------------------------------------------------------
-- Indeks
-- ---------------------------------------------------------------------------
CREATE INDEX idx_users_role_status ON public.users (role, status);
CREATE INDEX idx_users_active_staff ON public.users (role, display_name) WHERE role IN ('SATGAS', 'ADMIN') AND status = 'ACTIVE';
CREATE INDEX idx_users_locked ON public.users (locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX idx_users_failed_login ON public.users (failed_login_count) WHERE failed_login_count >= 3;
CREATE UNIQUE INDEX uk_users_oidc_subject ON public.users (identity_provider, subject_ref) WHERE subject_ref IS NOT NULL;
CREATE UNIQUE INDEX uk_users_email_normalized ON public.users (email_normalized);

-- updated_at
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE
    ON public.users
    FOR EACH ROW
EXECUTE FUNCTION public.tg_set_updated_at();
