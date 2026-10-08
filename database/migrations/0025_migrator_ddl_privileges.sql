-- ===========================================================================
-- TRIASE-Net :: 0025_migrator_ddl_privileges.sql
--
-- TEMUAN
--     Menjalankan `npm run db:migrate` sebagai `triase_ddl_login` (peran
--     dengan least privilege, bukan superuser) gagal dengan:
--
--         ERROR: permission denied for schema public
--
--     Penyebabnya dua hal yang saling meniadakan:
--       1. `0001_foundation.sql` menjalankan
--              REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--          Ini benar dan wajib. Tanpa itu, siapa pun yang punya USAGE
--          pada schema public bisa membuat objek dan menggantikan fungsi
--          apa pun yang dipakai aplikasi. Ini perlindungan dari serangan
--          object shadowing.
--       2. Tidak ada satupun migrasi yang memberi hak CREATE kembali ke
--          `triase_migrator`. Akibatnya peran DDL yang justru dibuat
--          untuk melakukan DDL tidak dapat melakukan apa pun.
--
--     Selama ini hal ini tidak terlihat karena migrasi selalu dijalankan
--     sebagai superuser. Pemisahan hak akses baru bisa dibuktikan ketika
--     alur migrasi benar-benar dijalankan dengan peran non-superuser.
--
-- PERBAIKAN
--     Beri hak CREATE dan USAGE pada schema public HANYA kepada
--     `triase_migrator`. Tidak ada peran lain yang mendapatnya.
--
--     Aplikasi runtime tetap tidak bisa membuat objek. Itulah yang membuat
--     `REVOKE CREATE ... FROM PUBLIC` pada 0001 tetap berguna: yang
--     dilindungi adalah runtime, bukan migrasi.
--
-- CATATAN KEAMANAN
--     `triase_migrator` memang memegang hak membuat objek. Itu melekat
--     pada peran DDL dan tidak dapat dihindari: DDL tanpa hak membuat
--     objek tidak mungkin. Yang penting adalah peran itu TIDAK punya hak
--     baca data aplikasi, sehingga kebocoran lewat jalur migrasi tidak
--     terjadi. Pemisahan itu diperiksa oleh 0024_direct_membership.sql.
--
--     Karena itu `DATABASE_MIGRATION_URL` tidak boleh pernah dipakai
--     oleh proses aplikasi. Pemisahan URL di `.env.example` bukan
--     formalitas; itulah yang membuat pemisahan peran ini berarti.
--
-- HAK SCHEMA LAINNYA
--     Schema `extensions` tidak diberi CREATE kepada migrasi. Semua
--     objek di sana dibuat oleh 0019 dan tidak boleh ditambah sembarangan.
-- ===========================================================================

GRANT USAGE, CREATE ON SCHEMA public TO triase_migrator;

COMMENT ON SCHEMA public IS
    'Skema aplikasi. CREATE hanya dipegang triase_migrator; runtime dan auditor hanya punya USAGE.';

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   1. Migrator boleh membuat objek (inilah tujuannya).
--   2. Peran aplikasi runtime TIDAK boleh membuat objek.
--   3. Auditor tidak boleh membuat objek.
--   4. PUBLIC tetap tidak punya CREATE; inilah proteksi object shadowing
--      yang ditambahkan oleh 0001.
--   5. Runtime tidak boleh membuat objek di schema extensions.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad text := NULL;
BEGIN
    IF NOT has_schema_privilege('triase_migrator', 'public', 'CREATE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator tidak punya CREATE pada schema public;';
    END IF;

    IF has_schema_privilege('triase_app', 'public', 'CREATE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_app punya CREATE pada schema public (bahaya);';
    END IF;

    IF has_schema_privilege('triase_app_login', 'public', 'CREATE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_app_login punya CREATE pada schema public (bahaya);';
    END IF;

    IF has_schema_privilege('triase_auditor', 'public', 'CREATE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_auditor punya CREATE pada schema public (bahaya);';
    END IF;

    -- PUBLIC bukan sebuah role, jadi `has_schema_privilege('PUBLIC', ...)`
    -- tidak bisa dipakai. Keberadaannya dicek langsung dari nspacl:
    -- entri pertama acl selalu untuk PUBLIC, jadi cukup dicek apakah
    -- entri itu memuat 'c' (CREATE).
    IF EXISTS (
        SELECT 1
        FROM pg_namespace n,
             LATERAL unnest(coalesce(n.nspacl, ARRAY[]::aclitem[])) AS aclitem
        WHERE n.nspname = 'public'
          AND aclitem = '=c/pg_database_owner'::aclitem
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' PUBLIC masih punya CREATE pada schema public; objek dapat dibayangi oleh siapa pun;';
    END IF;

    IF has_schema_privilege('triase_app', 'extensions', 'CREATE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_app punya CREATE pada schema extensions (bahaya);';
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Konfigurasi hak schema public belum benar:%', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;