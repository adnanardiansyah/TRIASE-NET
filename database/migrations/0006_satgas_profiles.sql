-- ===========================================================================
-- TRIASE-Net :: 0006_satgas_profiles.sql
-- Profil Otorisasi Satuan Tugas (SATGAS).
--
-- Tabel ini adalah "Policy Decision Point" sisi basis data: menentukan
-- (a) kategori aduan yang boleh dibuka, (b) batas risiko maksimum untuk
-- dekripsi, (c) statusduty, dan (d) versi KEK yang boleh dipakai untuk
-- membungkus/membuka kunci.
-- ===========================================================================

CREATE TABLE public.satgas_profiles
(
    user_id                uuid PRIMARY KEY
        REFERENCES public.users (id) ON DELETE CASCADE,

    employee_id            text        NOT NULL,
    unit_name              text        NOT NULL, -- mis. "Satgas FASILITAS & TEKNOLOGI"
    position_title         text,

    -- Otorisasi kategori: daftar kategori aduan yang boleh diakses.
    authorized_categories  public.aduan_category[] NOT NULL DEFAULT '{}',

    -- Batas atas risiko yang boleh didekripsi (0..100).
    -- Perbandingan dilakukan atas risk_score, bukan urutan enum.
    max_decrypt_risk_score smallint     NOT NULL DEFAULT 69,

    -- 1 = Stokes, 5 = Investigator Ahli / Admin.
    clearance_level        smallint     NOT NULL DEFAULT 1,

    -- ZTNA: akses dekripsi hanya sah ketika sedang bertugas.
    duty_status            public.duty_status NOT NULL DEFAULT 'OFF_DUTY',

    -- Wajib MFA tambahan (step-up) untuk Dekripsi berisiko tinggi.
    requires_step_up       boolean      NOT NULL DEFAULT true,

    -- Kunci publik (opsional): untuk pembungkusan KEK per-pengguna atau
    -- verifikasi tanda tangan machine-to-machine antar unit.
    jwks_kid               text,
    public_key_algorithm   text,
    public_key             bytea,

    -- Versi KEK yang boleh diakses. Menjaga pemisahan duties saat rotasi.
    kek_access_version     integer      NOT NULL DEFAULT 1
        REFERENCES public.kek_versions (version),

    -- ------------------------------------------------------------------
    -- Rahasia TOTP TIDAK disimpan dalam bentuk plaintext.
    -- Pada enrollments, rahasia dienkripsi memakai envelope encryption
    -- (DEK acak, lalu DEK dibungkus dengan KEK).
    -- ------------------------------------------------------------------
    mfa_secret_ciphertext      bytea,
    mfa_secret_iv              bytea,
    mfa_secret_auth_tag        bytea,
    mfa_secret_wrapped_dek     bytea,
    mfa_secret_wrap_iv         bytea,
    mfa_secret_wrap_auth_tag   bytea,
    mfa_secret_kek_version     integer
        REFERENCES public.kek_versions (version),

    -- Hash (Argon2id) kode pemulihan. Kode mentah tidak pernah disimpan.
    mfa_recovery_hashes     text[]      NOT NULL DEFAULT '{}',
    mfa_recovery_used_count smallint     NOT NULL DEFAULT 0,

    approved_by            uuid        REFERENCES public.users (id) ON DELETE SET NULL,
    approved_at            timestamptz,
    expires_at             timestamptz, -- Masa berlaku kewenangan (re-certification berkala)

    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    row_version            integer     NOT NULL DEFAULT 0,

    -- ---------------------------------------------------------------------
    -- Constraint
    -- ---------------------------------------------------------------------
    CONSTRAINT satgas_employee_id_uk UNIQUE (employee_id),
    CONSTRAINT satgas_categories_ck CHECK (cardinality(authorized_categories) > 0),
    CONSTRAINT satgas_risk_ck CHECK (max_decrypt_risk_score BETWEEN 0 AND 100),
    CONSTRAINT satgas_clearance_ck CHECK (clearance_level BETWEEN 1 AND 5),

    -- Persetujuan harus lengkap: approved_by dan approved_at terisi bersamaan.
    CONSTRAINT satgas_approval_ck CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
    CONSTRAINT satgas_recovery_ck CHECK (mfa_recovery_used_count >= 0 AND mfa_recovery_used_count <= 10),

    -- Kunci publik harus berpasangan lengkap
    CONSTRAINT satgas_public_key_ck CHECK (
        (public_key IS NULL AND public_key_algorithm IS NULL AND jwks_kid IS NULL)
            OR (public_key IS NOT NULL AND public_key_algorithm IS NOT NULL AND octet_length(public_key) >= 32)
        ),

    -- Envelope lengkap atau sama sekali kosong
    CONSTRAINT satgas_mfa_envelope_ck CHECK (
        (mfa_secret_ciphertext IS NULL AND mfa_secret_wrapped_dek IS NULL AND mfa_secret_kek_version IS NULL)
            OR (mfa_secret_ciphertext IS NOT NULL
                AND mfa_secret_wrapped_dek IS NOT NULL
                AND mfa_secret_kek_version IS NOT NULL
                AND octet_length(mfa_secret_ciphertext) > 0
                AND octet_length(mfa_secret_iv) = 12
                AND octet_length(mfa_secret_auth_tag) = 16
                AND octet_length(mfa_secret_wrap_iv) = 12
                AND octet_length(mfa_secret_wrap_auth_tag) = 16)
        )
);

COMMENT ON TABLE public.satgas_profiles IS
    'Otorisasi satuan tugas: kategori aduan, batas risiko, status duty, dan versi KEK yang boleh diakses.';
COMMENT ON COLUMN public.satgas_profiles.max_decrypt_risk_score IS
    'Ambang atas. Aduan dengan risk_score di atas nilai ini TIDAK dapat didekripsi oleh Satuan Tugas ini (wajib step-up oleh ADMIN).';
COMMENT ON COLUMN public.satgas_profiles.duty_status IS
    'Defense-in-depth ZTNA: akses tetap tersedia, tetapi dekripsi ditolak bila status bukan ON_DUTY.';
COMMENT ON COLUMN public.satgas_profiles.mfa_secret_ciphertext IS
    'Rahasia TOTP hasil enkripsi. Plaintext TIDAK PERNAH ada di basis data (Zero-Knowledge).';

CREATE INDEX idx_satgas_categories ON public.satgas_profiles USING GIN (authorized_categories);
CREATE INDEX idx_satgas_clearance ON public.satgas_profiles (clearance_level DESC, max_decrypt_risk_score DESC);
CREATE INDEX idx_satgas_on_duty ON public.satgas_profiles (user_id) WHERE duty_status = 'ON_DUTY';
CREATE INDEX idx_satgas_kek_access ON public.satgas_profiles (kek_access_version);

CREATE TRIGGER trg_satgas_profiles_updated_at
    BEFORE UPDATE
    ON public.satgas_profiles
    FOR EACH ROW
EXECUTE FUNCTION public.tg_set_updated_at();

-- Hanya SATGAS/ADMIN yang boleh memiliki profil (fn_guard_satgas_role).
CREATE TRIGGER trg_satgas_profiles_role_guard
    BEFORE INSERT OR UPDATE OF user_id
    ON public.satgas_profiles
    FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_satgas_role();
