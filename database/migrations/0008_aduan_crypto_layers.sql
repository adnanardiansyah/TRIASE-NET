-- ===========================================================================
-- TRIASE-Net :: 0008_aduan_crypto_layers.sql
-- Lapisan enkripsi TAMBAHAN untuk skema Hybrid Double Encryption.
--
-- Seluruh lapisan (layer_index >= 2) mengikuti satu skema:
--   risk_score >= 70 -> crypto_algorithm = 'HYBRID_DOUBLE'
--     Layer 1 (di tabel `aduan`)  : ChaCha20-Poly1305 atas plaintext
--     Layer 2 (tabel ini)         : AES-256-GCM    atas ciphertext Layer 1
--
-- Normalisasi (satu tabel, bukan kolom layer2_*_*) dipilih karena:
--   1. Skema dapat dikembangkan (mis. N lapis) tanpa migrasi skema.
--   2. Setiap lapisan punya DEK sendiri sehingga rotasi kunci bisa per lapisan.
--   3. Konsistensi dijaga trigger fn_guard_crypto_layers.
-- ===========================================================================

CREATE TABLE public.aduan_crypto_layers
(
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aduan_id          uuid        NOT NULL
        REFERENCES public.aduan (id) ON DELETE CASCADE,

    -- >= 2. Indeks 1 dicadangkan untuk badan utama (tabel `aduan`).
    layer_index       smallint    NOT NULL,
    algorithm         public.crypto_algorithm NOT NULL,

    ciphertext        bytea       NOT NULL,
    iv                bytea       NOT NULL,
    auth_tag          bytea       NOT NULL,

    -- Envelope encryption per lapisan: DEK sendiri, dibungkus dengan KEK.
    wrapped_dek       bytea       NOT NULL,
    wrapped_dek_iv    bytea       NOT NULL,
    wrapped_dek_tag   bytea       NOT NULL,
    kek_version       integer     NOT NULL
        REFERENCES public.kek_versions (version),

    -- AAD per lapisan, memuat urutan lapisan agar ciphertext tidak bisa
    -- ditukar antar lapisan (ciphertext-layer-reordering attack).
    aad_context       text        NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT aduan_layers_uk UNIQUE (aduan_id, layer_index),
    CONSTRAINT aduan_layers_index_ck CHECK (layer_index >= 2 AND layer_index <= 8),
    CONSTRAINT aduan_layers_alg_ck CHECK (algorithm IN ('AES_256_GCM', 'CHACHA20_POLY1305')),
    CONSTRAINT aduan_layers_iv_len_ck CHECK (octet_length(iv) = 12),
    CONSTRAINT aduan_layers_tag_len_ck CHECK (octet_length(auth_tag) = 16),
    CONSTRAINT aduan_layers_ciphertext_ck CHECK (octet_length(ciphertext) > 0),
    CONSTRAINT aduan_layers_dek_iv_len_ck CHECK (octet_length(wrapped_dek_iv) = 12),
    CONSTRAINT aduan_layers_dek_tag_len_ck CHECK (octet_length(wrapped_dek_tag) = 16),
    CONSTRAINT aduan_layers_dek_ck CHECK (octet_length(wrapped_dek) >= 32),
    CONSTRAINT aduan_layers_aad_ck CHECK (length(aad_context) > 0)
);

COMMENT ON TABLE public.aduan_crypto_layers IS
    'Lapisan kedua dan seterusnya untuk Hybrid Double Encryption pada aduan berisiko tinggi (risk_score >= 70).';
COMMENT ON COLUMN public.aduan_crypto_layers.aad_context IS
    'AAD memuat (aduan_id|layer_index) sehingga lapisan tidak dapat ditukar posisinya.';

-- Urutan dekripsi (harus dari indeks tertinggi ke 1).
CREATE INDEX idx_aduan_layers_decrypt
    ON public.aduan_crypto_layers (aduan_id, layer_index DESC);

-- Urutan dekripsi harus dari indeks tertinggi ke 1.
CREATE TRIGGER trg_aduan_crypto_layers_updated_at
    BEFORE UPDATE
    ON public.aduan_crypto_layers
    FOR EACH ROW
EXECUTE FUNCTION public.tg_set_updated_at();
