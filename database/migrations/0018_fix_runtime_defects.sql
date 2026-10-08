-- ===========================================================================
-- TRIASE-Net :: 0018_fix_runtime_defects.sql
--
-- Empat cacat yang HANYA muncul saat operasi nyata dijalankan. Semuanya
-- lolos migrasi dan lolos pemeriksaan katalog, tetapi gagal di produksi:
--
--  1. Penjaga lapisan hibrida buta terhadap RLS.
--     `fn_guard_crypto_layers` menghitung baris lapisan dengan
--     `SELECT count(*) FROM public.aduan_crypto_layers`. Fungsi itu
--     SECURITY INVOKER, sehingga saat dipicu oleh mahasiswa yang sedang
--     membuat aduan, kebijakan `layers_select_scoped` menyembunyikan
--     lapisan milik mahasiswa itu sendiri (kebijakan itu hanya mengizinkan
--     SATGAS/ADMIN). Akibatnya hitungan selalu 0 dan pembuatan
--     HYBRID_DOUBLE selalu ditolak. Terlihat pada probe fungsional:
--       "Aduan ... ditandai HYBRID_DOUBLE namun belum memiliki lapisan
--        enkripsi kedua."
--
--  2. Regex lampiran tidak valid di PostgreSQL.
--     `attachments_object_key_ck` memakai pengulangan `{1,512}`. Batas
--     jumlah pengulangan pada PostgreSQL ARE adalah 255, sehingga setiap
--     INSERT ke `aduan_attachments` gagal dengan:
--       "invalid regular expression: invalid repetition count(s)"
--     Artinya TIDAK ADA lampiran yang pernah bisa diunggah. Aturan panjang
--  4. Peran aplikasi tidak lagi memerlukan hak baca lapisan, sebab
--
--  3. Penyegel audit kehilangan hak eksekusi.
--     `fn_seal_audit_entry` berjalan sebagai pemanggil (SECURITY INVOKER),
--     sementara `fn_audit_canonical_payload` dicabut hak eksekusinya dari
--     triase_app pada migrasi 0017. Akibatnya SETIAP entri audit gagal:
--       "permission denied for function fn_audit_canonical_payload"
--     Fungsi payload bersifat murni (hanya menerima dan mengembalikan
--     data, tidak menyentuh tabel), sehingga tidak ada risiko bila
--     dipanggil aplikasi.
--
--  4. Penjaga lapisan harus tetap dapat membaca baris induk yang sedang
--     ditulis. Diperbaiki dengan SECURITY DEFINER pada poin 1, sehingga
--     peran aplikasi tidak lagi memerlukan hak baca lapisan.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1 + 4. Penjaga lapisan hibrida harus SECURITY DEFINER
--   Roller ke pemilik tabel (postgres) yang_review RLS, sehingga dapat
--     menghitung lapisan secara akurat untuk semua aktor.
--   Dicatat: trigger tetap hanya dapat dipasang oleh pemilik tabel.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_guard_crypto_layers()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $fn$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*)
    INTO v_count
    FROM public.aduan_crypto_layers
    WHERE aduan_id = NEW.id;

    IF NEW.crypto_algorithm = 'HYBRID_DOUBLE' AND v_count < 1 THEN
        RAISE EXCEPTION
            'Aduan % ditandai HYBRID_DOUBLE namun belum memiliki lapisan enkripsi kedua.',
            NEW.id
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.crypto_algorithm <> 'HYBRID_DOUBLE' AND v_count > 0 THEN
        RAISE EXCEPTION
            'Aduan % hanya boleh memiliki satu lapisan enkripsi (algoritma = %).',
            NEW.id, NEW.crypto_algorithm
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Perbaiki CHECK object_key
-- ---------------------------------------------------------------------------
ALTER TABLE public.aduan_attachments
    DROP CONSTRAINT IF EXISTS attachments_object_key_ck;

ALTER TABLE public.aduan_attachments
    ADD CONSTRAINT attachments_object_key_charset_ck
        CHECK (object_key ~ '^[A-Za-z0-9/_.\-]+$');

ALTER TABLE public.aduan_attachments
    ADD CONSTRAINT attachments_object_key_len_ck
        CHECK (char_length(object_key) BETWEEN 1 AND 512);

COMMENT ON CONSTRAINT attachments_object_key_charset_ck ON public.aduan_attachments IS
    'Hanya karakter aman untuk kunci objek. Panjang diperiksa terpisah karena batas pengulangan regex PostgreSQL adalah 255.';

-- ---------------------------------------------------------------------------
-- 3. Kembalikan hak eksekusi payload kanonik ke peran aplikasi
--   Aman: fungsi murni, tidak membaca tabel, tidak menulis apa pun.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.fn_audit_canonical_payload(
    bytea, bigint, timestamptz, uuid, uuid, text, text, text, text,
    smallint, text, text, text, text
) TO triase_app;

-- ---------------------------------------------------------------------------
-- 4. UJI FUNGSIONAL. Bila salah satu cacat di atas masih ada, migrasi ini
--    dibatalkan dan basis data tetap konsisten.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad text;
BEGIN
    -- (a) Penjaga lapisan harus SECURITY DEFINER.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'fn_guard_crypto_layers'
          AND p.prosecdef
    ) THEN
        RAISE EXCEPTION
            'fn_guard_crypto_layers() harus SECURITY DEFINER, jika tidak penjaga tidak dapat melihat lapisan milik mahasiswa.'
            USING ERRCODE = 'internal_error';
    END IF;

    -- (b) Tidak boleh ada CHECK yang memakai pengulangan regex di atas 255.
    SELECT string_agg(conname, ', ')
    INTO v_bad
    FROM pg_constraint
    WHERE conrelid = 'public.aduan_attachments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '\{\d{3},';

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'CHECK dengan pengulangan regex ilegal masih ada: %', v_bad
            USING ERRCODE = 'internal_error';
    END IF;

    -- (c) Aplikasi harus dapat menjalankan payload kanonik.
    IF NOT has_function_privilege(
        'triase_app',
        'public.fn_audit_canonical_payload(bytea,bigint,timestamptz,uuid,uuid,text,text,text,text,smallint,text,text,text,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'triase_app tidak boleh menjalankan fn_audit_canonical_payload; penyegel audit akan gagal.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;
