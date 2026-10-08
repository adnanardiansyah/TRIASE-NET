-- ===========================================================================
-- TRIASE-Net :: 0009_aduan_attachments.sql
-- Lampiran bukti. Berkas TIDAK disimpan di PostgreSQL, melainkan pada object
-- storage (S3/MinIO) dalam bentuk sudah terenkripsi. Yang disimpan di sini
-- hanya metadata terenkripsi + lokasi objek.
-- ===========================================================================

CREATE TABLE public.aduan_attachments
(
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aduan_id          uuid        NOT NULL
        REFERENCES public.aduan (id) ON DELETE CASCADE,

    sequence          smallint    NOT NULL DEFAULT 1,

    -- Nama berkas ASLI bisa memuat identitas (mis. "bukti_RAHAYU_23104.pdf"),
    -- sehingga ikut dienkripsi.
    original_filename bytea       NOT NULL,
    filename_iv       bytea       NOT NULL,
    filename_tag      bytea       NOT NULL,
    filename_wrapped_dek    bytea NOT NULL,
    filename_dek_iv         bytea NOT NULL,
    filename_dek_tag        bytea NOT NULL,

    mime_type         text,       -- nilai dari allowlist, bukan data sensitif
    size_bytes        bigint      NOT NULL,

    -- Lokasi objek pada object storage (KUNCI-nya sudah terenkripsi di sisi klien).
    object_key        text        NOT NULL,
    object_etag       text,

    -- Envelope enkripsi untuk isi berkas.
    wrapped_dek       bytea       NOT NULL,
    wrapped_dek_iv    bytea       NOT NULL,
    wrapped_dek_tag   bytea       NOT NULL,
    kek_version       integer     NOT NULL
        REFERENCES public.kek_versions (version),
    crypto_algorithm  public.crypto_algorithm NOT NULL,

    -- SHA-256 atas CIPHERTEXT (bukan plaintext) untuk verifikasi integritas
    -- tanpa perlu dekripsi.
    ciphertext_sha256 bytea,

    scan_status       public.attachment_scan_status NOT NULL DEFAULT 'PENDING',
    scanned_at        timestamptz,
    scan_engine       text,
    scan_signature    text,

    -- Metadata pengunggah (bukan identitas): berasal dari header ZTNA.
    uploaded_network_zone text,
    upload_risk_score smallint   NOT NULL DEFAULT 0,
    uploaded_at       timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz,

    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    row_version       integer     NOT NULL DEFAULT 0,

    CONSTRAINT aduan_attachments_uk UNIQUE (aduan_id, sequence),
    CONSTRAINT attachments_sequence_ck CHECK (sequence BETWEEN 1 AND 10),
    CONSTRAINT attachments_size_ck CHECK (size_bytes BETWEEN 1 AND 26214400), -- 25 MB
    CONSTRAINT attachments_alg_ck CHECK (crypto_algorithm IN ('AES_256_GCM', 'CHACHA20_POLY1305')),
    CONSTRAINT attachments_risk_ck CHECK (upload_risk_score BETWEEN 0 AND 100),

    -- Panjang nonce/tag seragam.
    CONSTRAINT attachments_iv_len_ck CHECK (octet_length(filename_iv) = 12),
    CONSTRAINT attachments_tag_len_ck CHECK (octet_length(filename_tag) = 16),
    CONSTRAINT attachments_dek_iv_len_ck CHECK (octet_length(wrapped_dek_iv) = 12),
    CONSTRAINT attachments_dek_tag_len_ck CHECK (octet_length(wrapped_dek_tag) = 16),
    CONSTRAINT attachments_dek_ck CHECK (octet_length(wrapped_dek) >= 32),
    CONSTRAINT attachments_fname_iv_len_ck CHECK (octet_length(filename_dek_iv) = 12),
    CONSTRAINT attachments_fname_dek_tag_len_ck CHECK (octet_length(filename_dek_tag) = 16),
    CONSTRAINT attachments_filename_ck CHECK (octet_length(original_filename) > 0),
    CONSTRAINT attachments_ciphertext_hash_ck CHECK (ciphertext_sha256 IS NULL OR octet_length(ciphertext_sha256) = 32),
    CONSTRAINT attachments_object_key_ck CHECK (object_key ~ '^[A-Za-z0-9/_.-]{1,512}$'),
    CONSTRAINT attachments_scan_ck CHECK ((scan_status = 'PENDING') = (scanned_at IS NULL))
);

COMMENT ON TABLE public.aduan_attachments IS
    'Lampiran aduan. Nama berkas dan isi sama-sama terenkripsi; path object storage tidak mengandung PII.';
COMMENT ON COLUMN public.aduan_attachments.object_key IS
    'Kunci objek pada object storage, mis. "2026/09/<uuid>.bin". Tidak boleh memuat nama asli berkas.';
COMMENT ON COLUMN public.aduan_attachments.ciphertext_sha256 IS
    'Hash atas ciphertext. Memverifikasi integritas berkas tanpa dekripsi (prinsip ZK tetap terjaga).';
COMMENT ON COLUMN public.aduan_attachments.mime_type IS
    'Hanya nilai dari allowlist (jpg/png/pdf). Diperlukan agar UI dapat merender tanpa dekripsi.';

-- ---------------------------------------------------------------------------
-- Indeks
-- ---------------------------------------------------------------------------
CREATE INDEX idx_attachments_aduan ON public.aduan_attachments (aduan_id, sequence);
CREATE INDEX idx_attachments_scan ON public.aduan_attachments (scan_status, uploaded_at) WHERE scan_status = 'PENDING';
CREATE INDEX idx_attachments_retention ON public.aduan_attachments (aduan_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uk_attachments_object_key ON public.aduan_attachments (object_key);

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_attachments_updated_at
    BEFORE UPDATE
    ON public.aduan_attachments
    FOR EACH ROW
EXECUTE FUNCTION public.tg_set_updated_at();

-- Sinkronkan attachment_count pada tabel induk.
CREATE TRIGGER trg_attachments_sync_count
    AFTER INSERT OR DELETE
    ON public.aduan_attachments
    FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_attachment_count();
