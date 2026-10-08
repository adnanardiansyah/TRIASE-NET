-- ===========================================================================
-- TRIASE-Net :: 0030_guard_satgas_role_security_definer.sql
--
-- TEMUAN
--     Fixture verifikasi gagal menyisipkan profil petugas:
--
--         ERROR: Pengguna 11111111-1111-4111-8111-111111111111 tidak ditemukan.
--
--     Penyebabnya ada di `public.fn_guard_satgas_role`, trigger
--     `trg_satgas_profiles_role_guard` pada `satgas_profiles`.
--
--     Fungsi tersebut membaca `public.users` untuk memvalidasi bahwa
--     pemilik profil benar-benar berperan SATGAS atau ADMIN. Fungsi itu
--     TIDAK ditandai SECURITY DEFINER, jadi `SELECT` dijalankan dengan
--     hak PEMANGGIL, yaitu `triase_migrator` saat fixture disisipkan.
--
--     `users` mengaktifkan RLS dengan satu policy SELECT yang hanya
--     berlaku untuk `triase_app`. Peran `triase_migrator` tidak disebut
--     di policy mana pun, dan RLS tanpa policy yang cocok bersifat
--     RESTRICTIVE. Akibatnya trigger melihat TIDAK ADA BARIS pengguna,
--     lalu melempar "tidak ditemukan" padahal barisnya baru saja
--     disisipkan pada transaksi yang sama.
--
-- KONSEKUENSI DI LUAR FIXTURE
--     Ini bukan sekadar masalah fixture. Border ini akan menolak profil
--     petugas baru dari jalur mana pun yang bukan `triase_app`,
--     termasuk proses onboarding administratif dan jalur pemulihan
--     akun. Pesan galatnya "tidak ditemukan" juga menyesatkan: galat
--     sebenarnya adalah RLS, bukan foreign key yang menggantung.
--
-- PERBAIKAN
--     Fungsi ditandai `SECURITY DEFINER` dengan `search_path` dikunci.
--     Postgres adalah pemilik tabel `users` dan `FORCE ROW LEVEL
--     SECURITY` tidak aktif pada tabel itu, sehingga saat fungsi
--     berjalan sebagai `postgres` RLS dilewati dan baris pengguna
--     terlihat untuk validasi.
--
--     Ini konsisten dengan fungsi trigger lain yang sudah berjalan
--     benar di skema ini:
--
--       - `fn_seal_audit_entry`        SECURITY DEFINER
--       - `fn_guard_crypto_layers`      SECURITY DEFINER
--       - `fn_sync_attachment_count`    SECURITY DEFINER
--
--     Yang TIDAK diubah adalah isi validasi: aturan SATGAS/ADMIN tetap
--     ditegakkan, hanya cara fungsi membaca data yang diperbaiki.
--
-- CATATAN KEAMANAN
--     SECURITY DEFINER pada fungsi yang membaca data berarti pemanggil
--     bisa membuat fungsi tersebut membaca data di luar haknya sendiri.
--     Fungsi ini hanya membaca kolom `role` dari satu baris `users` dan
--     tidak mengembalikan apa pun ke pemanggil; hasilnya hanya berupa
--     penolakan atau izin. `search_path` dikunci ke `public, pg_catalog`
--     supaya tidak ada objek bayangan yang bisa menyamar menjadi fungsi
--     lain di dalam jalur pencarian.
--
--     Hak EXECUTE tetap dibatasi pada `postgres`, seperti sebelumnya.
--     Trigger tidak memerlukan hak EXECUTE pemanggil untuk berjalan, dan
--     pemanggil tidak perlu memanggil fungsi ini secara langsung.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_satgas_role()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
    v_role public.app_role;
BEGIN
    -- SECURITY DEFINER: dijalankan sebagai pemilik fungsi (postgres),
    -- sehingga RLS pada `users` tidak menyembunyikan baris yang divalidasi.
    SELECT role
    INTO v_role
    FROM public.users
    WHERE id = NEW.user_id;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Pengguna % tidak ditemukan.', NEW.user_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_role NOT IN ('SATGAS', 'ADMIN') THEN
        RAISE EXCEPTION
            'Peran % tidak diizinkan memiliki satgas_profiles (hanya SATGAS/ADMIN).', v_role
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_guard_satgas_role() IS
    'Menegakkan aturan SATGAS/ADMIN pada satgas_profiles. SECURITY DEFINER diperlukan agar validasi dapat membaca public.users tanpa terkena RLS pemanggil.';

-- Hak EXECUTE dibatasi pada postgres, sama seperti sebelum migrasi ini.
-- Fungsi dipanggil lewat trigger, bukan lewat pemanggilan langsung.
REVOKE ALL ON FUNCTION public.fn_guard_satgas_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_guard_satgas_role() TO postgres;

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   1. Fungsi adalah SECURITY DEFINER.
--   2. `search_path` fungsi dikunci (tidak kosong, tidak memakai `pg_catalog`
--      saja yang bisa mengaburkan objek `public`).
--   3. Aturan SATGAS/ADMIN masih ada di body fungsi.
--   4. `pg_trigger.tgenabled` trigger masih aktif (bukan 'D').
--   5. Tidak ada fungsi trigger lain di tabel ber-RLS yang tetap
--      membaca tabel lain tanpa SECURITY DEFINER.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad text := NULL;
    v_def boolean;
    v_proconfig text[];
BEGIN
    -- (1) dan (2)
    SELECT prosecdef, proconfig
    INTO v_def, v_proconfig
    FROM pg_proc
    WHERE oid = 'public.fn_guard_satgas_role()'::regprocedure;

    IF v_def IS NOT TRUE THEN
        v_bad := coalesce(v_bad, '') ||
            ' fn_guard_satgas_role belum SECURITY DEFINER; validasi akan terkena RLS;';
    END IF;

    IF v_proconfig IS NULL THEN
        v_bad := coalesce(v_bad, '') ||
            ' fn_guard_satgas_role tidak mengunci search_path;';
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM unnest(v_proconfig) AS cfg
            WHERE cfg LIKE 'search\_path=%'
        ) THEN
            v_bad := coalesce(v_bad, '') ||
                ' fn_guard_satgas_role tidak mengunci search_path;';
        END IF;
    END IF;

    -- (3) Aturan peran harus masih tertulis di body fungsi.
    IF (SELECT prosrc FROM pg_proc
         WHERE oid = 'public.fn_guard_satgas_role()'::regprocedure)
       !~ 'SATGAS.*ADMIN'
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' aturan peran SATGAS/ADMIN hilang dari fn_guard_satgas_role;';
    END IF;

    -- (4) Trigger harus tetap aktif.
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.satgas_profiles'::regclass
          AND tgname = 'trg_satgas_profiles_role_guard'
          AND tgenabled <> 'D'
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' trigger trg_satgas_profiles_role_guard tidak aktif;';
    END IF;

    -- (5) Fungsi trigger lain yang membaca tabel lain di atas RLS harus
    --     sudah SECURITY DEFINER. `tg_set_updated_at` hanya menulis
    --     `now()` sehingga tidak membaca tabel lain dan tidak termasuk.
    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_trigger t ON t.tgfoid = p.oid
        WHERE NOT t.tgisinternal
          AND NOT p.prosecdef
          AND p.proname NOT IN ('tg_set_updated_at', 'fn_reject_mutation')
          AND p.proname NOT LIKE 'fn_guard_kek_material%'
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' ada fungsi trigger lain yang membaca data tanpa SECURITY DEFINER;';
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Konfigurasi trigger belum benar:%', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;