-- ===========================================================================
-- TRIASE-Net :: 0032_fixture_kek_lifecycle_columns.sql
--
-- MASALAH
--     Migrasi 0031 memberi `triase_fixture` hak INSERT pada
--     `kek_versions` hanya untuk kolom:
--
--         version, label, key_reference, status
--
--     Itu cukup pada database yang `kek_versions`-nya kosong. Begitu
--     `npm run db:seed:sql` dijalankan, KEK pengembangan versi 1 ada
--     dan berstatus ACTIVE.
--
--     Fixture probe tidak bisa lagi membuat KEK Active karena index unik
--     `uk_kek_versions_single_active` hanya mengizinkan SATU KEK ACTIVE:
--
--         duplicate key value violates unique constraint
--         "uk_kek_versions_single_active"
--
--     Fixture probe mengubah KEK-nya menjadi RETIRED. Itu benar dan
--     sesuai invariant skema. Tapi constraint `kek_status_dates_ck`
--     kemudian menolak:
--
--         new row for relation "kek_versions" violates check constraint
--         "kek_status_dates_ck"
--
--     Constraint itu mewajibkan setiap KEK non-ACTIVE punya `retired_at`
--     yang tidak NULL. Fixture tidak boleh mengisi kolom itu karena tidak
--     memegang hak INSERT padanya:
--
--         permission denied for table kek_versions
--
--     Hasilnya `npm run db:verify` gagal total (1 dari 21 pengujian),
--     padahal tidak ada satu pun masalah keamanan. Yang rusak adalah
--     permukaan hak yang diberikan 0031, bukan logika keamanannya.
--
-- KEPUTUSAN DESIGN
--     Tambahkan hak INSERT pada tiga kolom siklus hidup KEK:
--
--         activated_at, retired_at, retired_reason
--
--     Ketiganya adalah kolom waktu dan teks bebas. Tidak ada satu pun
--     yang memengaruhi kunci enkripsi, dan `key_material` tetap TIDAK
--     diberi hak apa pun.
--
--     Fixture butuh `retired_at` karena constraint skema mewajibkannya.
--     `activated_at` punya nilai bawaan `now()`, jadi fixture boleh
--     memakainya tanpa hak eksplisit, dan `retired_reason` menjaga agar
--     fixture dapat menandai alasan dengan nilai yang terbaca pada
--     laporan probe.
--
--     Yang TIDAK berubah:
--       - Tidak ada DELETE.
--       - Tidak ada UPDATE.
--       - Tidak ada SELECT pada `key_material`.
--       - Tidak ada hak apa pun pada tabel data aduan.
--       - Tidak ada perubahan keanggotaan peran.
--       - Tidak ada perubahan pada role aplikasi atau migrasi.
--
--     Kolom `key_material`, `key_checksum`, `row_version`, `created_at`,
--     dan `updated_at` tetap tidak diberi hak INSERT.
-- ===========================================================================

GRANT INSERT (activated_at, retired_at, retired_reason)
    ON public.kek_versions TO triase_fixture;

COMMENT ON ROLE triase_fixture IS
    'Peran khusus fixture verifikasi. Hanya INSERT pada tabel identitas, tanpa DELETE, tanpa UPDATE, tanpa BYPASSRLS, tanpa hak CREATE. Digunakan oleh scripts/verify-db.ts di dalam transaksi yang di-rollback. Kolom siklus hidup KEK (activated_at, retired_at, retired_reason) dapat diisi karena constraint kek_status_dates_ck mewajibkan retired_at pada KEK non-ACTIVE.';

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   Menegakkan ulang seluruh batasan peran 0031 dan menambahkan
--   pemeriksaan bahwa hak INSERT lifecycle benar-benar ada.
--
--   Batasan yang diperiksa ulang sengaja lengkap, bukan hanya yang
--   baru. Memperluas hak INSERT pada satu tabel dapat dengan mudah
--   menjadi celah yang tidak disadari, sehingga migrasi ini memverifikasi
--   ulang semua jaminan lama dan menambah dua pemeriksaan baru: bahwa
--   hak lifecycle benar-benar ada, dan bahwa kolom tertutup tetap tertutup.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad text := NULL;
BEGIN
    -- (1) Atribut peran.
    IF NOT EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'triase_fixture'
          AND NOT rolcanlogin
          AND NOT rolsuper
          AND NOT rolcreatedb
          AND NOT rolcreaterole
          AND NOT rolreplication
          AND NOT rolbypassrls
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' atribut peran triase_fixture tidak aman;';
    END IF;

    -- (2) Tidak ada hak hapus di tabel mana pun.
    IF has_table_privilege('triase_fixture', 'public.users', 'DELETE')
       OR has_table_privilege('triase_fixture', 'public.satgas_profiles', 'DELETE')
       OR has_table_privilege('triase_fixture', 'public.kek_versions', 'DELETE')
       OR has_table_privilege('triase_fixture', 'public.aduan', 'DELETE')
    THEN
        v_bad := coalesce(v_bad, '') || ' triase_fixture punya hak DELETE;';
    END IF;

    -- (3) Tidak ada hak ubah di tabel mana pun.
    IF has_table_privilege('triase_fixture', 'public.users', 'UPDATE')
       OR has_table_privilege('triase_fixture', 'public.satgas_profiles', 'UPDATE')
       OR has_table_privilege('triase_fixture', 'public.kek_versions', 'UPDATE')
    THEN
        v_bad := coalesce(v_bad, '') || ' triase_fixture punya hak UPDATE;';
    END IF;

    -- (4) Kunci enkripsi tetap tidak boleh terbaca.
    IF has_column_privilege('triase_fixture', 'public.kek_versions', 'key_material', 'SELECT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_fixture bisa membaca key_material;';
    END IF;

    -- (5) Perimeter data aduan tetap tidak boleh tersentuh.
    IF has_table_privilege('triase_fixture', 'public.aduan', 'SELECT')
       OR has_table_privilege('triase_fixture', 'public.aduan', 'INSERT')
       OR has_table_privilege('triase_fixture', 'public.aduan', 'UPDATE')
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_fixture punya hak pada tabel aduan; seharusnya tidak;';
    END IF;

    -- (6) Fixture tidak boleh bisa membuat objek.
    IF has_schema_privilege('triase_fixture', 'public', 'CREATE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_fixture punya CREATE pada schema public;';
    END IF;

    -- (7) Hanya akun verifikasi yang boleh menjadi anggota.
    IF NOT pg_has_role('triase_verify_login', 'triase_fixture', 'MEMBER') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_verify_login tidak menjadi anggota triase_fixture;';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_auth_members m
        JOIN pg_roles r ON r.oid = m.member
        WHERE m.roleid = 'triase_fixture'::regrole
          AND r.rolname <> 'triase_verify_login'
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' ada anggota lain dari triase_fixture selain triase_verify_login;';
    END IF;

    -- (8) BARU: hak INSERT lifecycle KEK harus benar-benar ada,
    --     kalau tidak probe akan gagal dengan "permission denied" yang
    --     menyesatkan.
    IF NOT has_column_privilege('triase_fixture', 'public.kek_versions', 'retired_at', 'INSERT')
       OR NOT has_column_privilege('triase_fixture', 'public.kek_versions', 'activated_at', 'INSERT')
       OR NOT has_column_privilege('triase_fixture', 'public.kek_versions', 'retired_reason', 'INSERT')
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_fixture tidak bisa mengisi kolom siklus hidup KEK;';
    END IF;

    -- (9) BARU: kolom yang TIDAK boleh ditulis fixture harus tetap
    --     tertutup, termasuk `key_material`. Ini penjaga utama bahwa
    --     penambahan hak di migrasi ini tidak melebar tanpa sengaja.
    IF has_column_privilege('triase_fixture', 'public.kek_versions', 'key_material', 'INSERT')
       OR has_column_privilege('triase_fixture', 'public.kek_versions', 'key_checksum', 'INSERT')
       OR has_column_privilege('triase_fixture', 'public.kek_versions', 'row_version', 'INSERT')
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_fixture punya INSERT pada kolom KEK yang seharusnya tertutup;';
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Konfigurasi peran fixture belum benar:%', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;
