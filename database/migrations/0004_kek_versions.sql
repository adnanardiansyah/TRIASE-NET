-- ===========================================================================
-- TRIASE-Net :: 0004_kek_versions.sql
-- Registri Key Encryption Key (KEK) untuk Envelope Encryption.
--
-- Setiap ciphertext pada tabel `aduan` menyimpan referensi `kek_version`,
-- sehingga rotasi kunci dapat dilakukan tanpa mendekripsi seluruh basis data.
-- ===========================================================================

CREATE TABLE public.kek_versions
(
    version            integer PRIMARY KEY,
    label              text        NOT NULL,
    wrap_algorithm     public.key_wrap_algorithm NOT NULL DEFAULT 'AES_256_GCM_WRAP',

    -- Material kunci. WAJIB NULL pada produksi (lihat fn_guard_kek_material).
    key_material       bytea,
    key_reference      text, -- Pointer ke KMS/HSM, mis. "vault://triase/kek/v3"
    key_checksum       bytea, -- HMAC-SHA256(material) untuk deteksi manipulasi

    status             public.kek_status NOT NULL DEFAULT 'ACTIVE',
    activated_at       timestamptz  NOT NULL DEFAULT now(),
    retired_at         timestamptz,
    retired_reason     text,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    row_version        integer      NOT NULL DEFAULT 0,

    CONSTRAINT kek_versions_uk UNIQUE (label),
    CONSTRAINT kek_material_ck CHECK (key_material IS NULL OR octet_length(key_material) = 32),
    CONSTRAINT kek_reference_ck CHECK (key_material IS NULL OR key_reference IS NOT NULL),
    CONSTRAINT kek_status_dates_ck CHECK (
        (status = 'ACTIVE' AND retired_at IS NULL)
            OR (status <> 'ACTIVE' AND retired_at IS NOT NULL)
        )
);

COMMENT ON TABLE public.kek_versions IS
    'Registri versi Master Key (KEK). Satu KEK aktif pada satu waktu; tabel ini tidak pernah menyimpan kunci pelapor.';
COMMENT ON COLUMN public.kek_versions.key_material IS
    'HANYA untuk pengembangan lokal. Pada produksi biarkan NULL dan isi key_reference dengan pointer KMS/HSM.';
COMMENT ON COLUMN public.kek_versions.key_checksum IS
    'HMAC-SHA256 atas material kunci. Menyediakan deteksi integritas tanpa menyimpan kunci itu sendiri.';

CREATE TRIGGER trg_kek_versions_updated_at
    BEFORE UPDATE
    ON public.kek_versions
    FOR EACH ROW
EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER trg_kek_versions_material_guard
    BEFORE INSERT OR UPDATE
    ON public.kek_versions
    FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_kek_material();

-- Hanya satu KEK berstatus ACTIVE pada satu waktu.
CREATE UNIQUE INDEX uk_kek_versions_single_active
    ON public.kek_versions ((status))
    WHERE status = 'ACTIVE';

CREATE INDEX idx_kek_versions_status ON public.kek_versions (status, version DESC);
