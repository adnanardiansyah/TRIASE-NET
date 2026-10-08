-- ===========================================================================
-- TRIASE-Net :: 0007_aduan.sql
-- Tabel utama aduan. BERISI CIPHERTEXT SAJA (Zero-Knowledge Storage).
--
-- Yang TIDAK ADA di tabel ini (sengaja):
--   * NIM / NIK / nama / email mahasiswa
--   * isi aduan dalam bentuk plaintext
--   * foreign key ke `users` untuk identitas pelapor
-- Yang ADA:
--   * pseudonym_id  : HMAC-SHA256(subjek identitas) - pseudonim, bukan identitas
--   * body_*        : ciphertext, IV, auth tag (lapisan pertama)
--   * dek_wrapped_* : DEK 256-bit yang dibungkus dengan KEK (envelope encryption)
--   * crypto_algorithm : hasil pemilihan enkripsi adaptif berdasarkan risk_score
-- ===========================================================================

CREATE TABLE public.aduan
(
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Kode tiket publik untuk pelacakan tanpa login.
    ticket_code       text        NOT NULL,

    -- Pseudonym ID: HMAC-SHA256(identitas) dalam hex. TIDAK reversible.
    pseudonym_id      text        NOT NULL,

    category          public.aduan_category NOT NULL,
    submission_channel public.submission_channel NOT NULL DEFAULT 'WEB',
    status            public.aduan_status   NOT NULL DEFAULT 'DITERIMA',

    -- ------------------------------------------------------------------
    -- Konteks ZTNA saat pengajuan (dinormalisasi dari middleware)
    -- ------------------------------------------------------------------
    submitted_at        timestamptz NOT NULL DEFAULT now(),
    submitted_network_zone text,
    ztna_risk_score     smallint  NOT NULL DEFAULT 0,

    -- ------------------------------------------------------------------
    -- Skema enkripsi adaptif
    -- ------------------------------------------------------------------
    crypto_algorithm  public.crypto_algorithm NOT NULL,
    risk_score        smallint  NOT NULL DEFAULT 0,
    risk_band         public.risk_band
        GENERATED ALWAYS AS (
            CASE
                WHEN risk_score < 30 THEN 'LOW'::public.risk_band
                WHEN risk_score < 70 THEN 'MEDIUM'::public.risk_band
                ELSE 'HIGH'::public.risk_band
            END
        ) STORED,
    risk_factors      jsonb       NOT NULL DEFAULT '{}'::jsonb,

    -- Lapisan enkripsi PERTAMA (badan aduan)
    body_ciphertext   bytea       NOT NULL,
    body_iv           bytea       NOT NULL,
    body_auth_tag     bytea       NOT NULL,

    -- Envelope: DEK dibungkus dengan KEK aktif.
    dek_wrapped       bytea       NOT NULL,
    dek_wrap_iv       bytea       NOT NULL,
    dek_wrap_auth_tag bytea       NOT NULL,
    kek_version       integer     NOT NULL
        REFERENCES public.kek_versions (version),

    -- Additional Authenticated Data yang diikat ke ciphertext.
    -- Ini mencegah serangan row-swapping (memindahkan isi aduan antar baris).
    aad_context       text        NOT NULL,
    aad_version       smallint    NOT NULL DEFAULT 1,

    -- ------------------------------------------------------------------
    -- Lampiran
    -- ------------------------------------------------------------------
    attachment_count  smallint    NOT NULL DEFAULT 0,

    -- ------------------------------------------------------------------
    -- Metadata operasional (TIDAK memuat isi aduan)
    -- ------------------------------------------------------------------
    title_masked      text,
    assigned_to       uuid REFERENCES public.users (id) ON DELETE SET NULL,
    closed_at         timestamptz,
    retention_expires_at timestamptz NOT NULL,
    row_version       integer     NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    -- ---------------------------------------------------------------------
    -- Constraint
    -- ---------------------------------------------------------------------
    CONSTRAINT aduan_ticket_code_uk UNIQUE (ticket_code),
    CONSTRAINT aduan_ticket_code_ck
        CHECK (ticket_code ~ '^TRX-[0-9]{4}-[A-Z0-9]{8}$'),
    CONSTRAINT aduan_pseudonym_ck
        CHECK (pseudonym_id ~ '^[0-9a-f]{64}$'),

    CONSTRAINT aduan_risk_score_ck CHECK (risk_score BETWEEN 0 AND 100),
    CONSTRAINT aduan_ztna_risk_ck CHECK (ztna_risk_score BETWEEN 0 AND 100),

    -- IV 12 byte (96-bit) untuk GCM dan nonce 12 byte untuk ChaCha20-Poly1305.
    CONSTRAINT aduan_iv_len_ck CHECK (octet_length(body_iv) = 12),

    -- Auth tag AEAD 16 byte.
    CONSTRAINT aduan_tag_len_ck CHECK (octet_length(body_auth_tag) = 16),
    CONSTRAINT aduan_dek_wrap_iv_len_ck CHECK (octet_length(dek_wrap_iv) = 12),
    CONSTRAINT aduan_dek_wrap_tag_len_ck CHECK (octet_length(dek_wrap_auth_tag) = 16),

    CONSTRAINT aduan_ciphertext_nonempty_ck CHECK (octet_length(body_ciphertext) > 0),
    CONSTRAINT aduan_dek_wrapped_nonempty_ck CHECK (octet_length(dek_wrapped) >= 32),

    CONSTRAINT aduan_aad_version_ck CHECK (aad_version BETWEEN 1 AND 9),

    -- Retention: wajib ada jadwal crypto-shredding.
    CONSTRAINT aduan_retention_ck CHECK (retention_expires_at > created_at),
    CONSTRAINT aduan_closure_ck CHECK ((status IN ('SELESAI', 'DITUTUP', 'DITOLAK')) = (closed_at IS NOT NULL)),
    CONSTRAINT aduan_attachment_count_ck CHECK (attachment_count >= 0)
);

COMMENT ON TABLE public.aduan IS
    'Penyimpanan aduan Zero-Knowledge. Seluruh isi terenkripsi; identitas pelapor direduksi menjadi Pseudonym ID.';
COMMENT ON COLUMN public.aduan.pseudonym_id IS
    'HMAC-SHA256 terhadap subjek identitas dengan kunci rahasia terpisah. Pseudoanonim, bukan anonim penuh.';
COMMENT ON COLUMN public.aduan.body_ciphertext IS
    'Ciphertext badan aduan. Menggantikan seluruh plaintext; tidak ada kolom plaintext di tabel ini.';
COMMENT ON COLUMN public.aduan.risk_band IS
    'GENERATED: LOW (<30), MEDIUM (30-69), HIGH (>=70). Kolom ini yang memetakan algoritma enkripsi.';
COMMENT ON COLUMN public.aduan.aad_context IS
    'Additional Authenticated Data (konteks ZTNA + ticket code) yang terikat ke ciphertext untuk mencegah row-swap.';
COMMENT ON COLUMN public.aduan.retention_expires_at IS
    'Batas waktu retensi. Setelah lewat, proses kripto-shredding menghapus kunci sehingga data menjadi tidak terbaca.';

-- ---------------------------------------------------------------------------
-- Indeks
-- ---------------------------------------------------------------------------
-- Antrean kerja dashboard: status + risiko
CREATE INDEX idx_aduan_queue
    ON public.aduan (status, risk_score DESC, submitted_at DESC);

CREATE INDEX idx_aduan_category
    ON public.aduan (category, status, submitted_at DESC);

CREATE INDEX idx_aduan_pseudonym
    ON public.aduan (pseudonym_id);

CREATE INDEX idx_aduan_submitted
    ON public.aduan (submitted_at DESC);

CREATE INDEX idx_aduan_assigned
    ON public.aduan (assigned_to, status)
    WHERE assigned_to IS NOT NULL;

CREATE INDEX idx_aduan_risk_factors
    ON public.aduan USING GIN (risk_factors);

-- Jadwal crypto-shredding
CREATE INDEX idx_aduan_retention
    ON public.aduan (retention_expires_at)
    WHERE status NOT IN ('SELESAI', 'DITUTUP', 'DITOLAK');

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_aduan_updated_at
    BEFORE UPDATE
    ON public.aduan
    FOR EACH ROW
EXECUTE FUNCTION public.tg_set_updated_at();

-- Validasi konsistensi lapisan hybrid (fn_guard_crypto_layers).
CREATE TRIGGER trg_aduan_crypto_layer_guard
    BEFORE INSERT OR UPDATE OF crypto_algorithm
    ON public.aduan
    FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_crypto_layers();
