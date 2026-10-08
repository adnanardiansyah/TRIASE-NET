-- ===========================================================================
-- TRIASE-Net :: 0003_functions_and_triggers.sql
-- Fungsi & trigger generik lintas tabel.
--
-- Prinsip: trigger hanya dipakai untuk hal yang TIDAK dapat dijamin oleh
-- CHECK / FOREIGN KEY (mis. integritas urutan waktu dan penyegelan audit).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Pemeliharaan `updated_at` + penghitung versi (optimistic locking)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    NEW.row_version := OLD.row_version + 1;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Penjaga Ketidakubahian (Immutability Guard)
--    Menolak UPDATE / DELETE / TRUNCATE pada tabel yang bersifat append-only.
--    Pondasi "append-only" untuk ztna_audit_logs dan aduan_status_history.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reject_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Tabel %.% bersifat append-only. Operasi % ditolak oleh penjaga integritas.',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation',
              HINT = 'Koreksi atau pembaruan harus dibuat sebagai entri baru.';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Sinkronisasi jumlah lampiran pada tabel `aduan`
--    Digunakan dashboard antrean untuk menampilkan ikon lampiran tanpa JOIN.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_sync_attachment_count()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
DECLARE
    v_aduan_id uuid;
BEGIN
    v_aduan_id := COALESCE(NEW.aduan_id, OLD.aduan_id);

    UPDATE public.aduan
    SET attachment_count = (SELECT count(*) FROM public.aduan_attachments WHERE aduan_id = v_aduan_id)
    WHERE id = v_aduan_id;

    RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Penjaga konsistensi lapisan enkripsi adaptif (Hybrid Double Encryption)
--    - crypto_algorithm = 'HYBRID_DOUBLE' wajib punya >= 1 baris di
--      aduan_crypto_layers (lapisan kedua).
--    - Selain itu, tabel aduan_crypto_layers harus kosong.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_guard_crypto_layers()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
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
$$;

-- ---------------------------------------------------------------------------
-- 5. Penjaga peran untuk `satgas_profiles`
--    Hanya akun SATGAS / ADMIN yang boleh memiliki profil satuan tugas.
--    (CHECK lintas tabel tidak mungkin, jadi dipakai trigger.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_guard_satgas_role()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
DECLARE
    v_role public.app_role;
BEGIN
    SELECT role
    INTO v_role
    FROM public.users
    WHERE id = NEW.user_id;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Pengguna % tidak ditemukan.', NEW.user_id USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_role NOT IN ('SATGAS', 'ADMIN') THEN
        RAISE EXCEPTION
            'Peran % tidak diizinkan memiliki satgas_profiles (hanya SATGAS/ADMIN).', v_role
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Penjaga material kunci enkripsi (Key Material Guard)
--    Menolak penyimpanan KEK di dalam basis data kecuali GUC
--    `triase.allow_embedded_kek` diaktifkan (khusus pengembangan lokal).
--    Produksi WAJIB memakai KMS/HSM atau environment secret.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_guard_kek_material()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.key_material IS NOT NULL
        AND COALESCE(current_setting('triase.allow_embedded_kek', true), 'off') <> 'on' THEN
        RAISE EXCEPTION
            'Penyimpanan material KEK di dalam basis data dinonaktifkan. Gunakan KMS/HSM atau set triase.allow_embedded_kek=on (khusus dev).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$;
