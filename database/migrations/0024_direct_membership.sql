-- ===========================================================================
-- TRIASE-Net :: 0024_direct_membership.sql
--
-- TEMUAN
--     Pengujian nyata dengan `triase_app_login` (bukan superuser)
--     menunjukkan hal ini:
--
--         has_table_privilege('triase_runtime', 'public.aduan', 'SELECT')
--             = true
--         has_table_privilege('triase_app_login', 'public.aduan', 'SELECT')
--             = false
--
--     Satu tingkat keanggotaan mewarisi hak. DUA tingkat tidak.
--
-- PENYEBAB
--     Warisan hak PostgreSQL TIDAK transitif untuk tabel dan kolom.
--     `pg_auth_members` bersifat rekursif untuk `SET ROLE` dan untuk
--     `pg_has_role(..., 'MEMBER')`, tetapi mesin pemeriksaan hak
--     (`has_table_privilege`, `has_column_privilege`) hanya melihat
--     keanggotaan LANGSUNG, satu tingkat.
--
-- RANCANGAN YANG SALAH
--     Migrasi 0022 membuat peran perantara:
--         triase_app_login  ->  triase_runtime  ->  triase_app
--     Susunan itu tidak berfungsi. `triase_runtime` adalah NOLOGIN,
--     sehingga `SET ROLE` dari sesi login tidak pernah bisa melewati
--     lapisan itu, dan hak pun tidak pernah sampai ke sesi.
--
-- PERBAIKAN
--     Peran LOGIN menjadi anggota LANGSUNG dari peran hak. Peran
--     perantara dihapus karena tidak menambah nilai apa pun: nama peran
--     hak sudah jelas menyatakan perannya.
--
--         triase_app_login       ->  triase_app
--         triase_ddl_login       ->  triase_migrator
--         triase_verify_login    ->  triase_auditor, triase_app
--         triase_retention_login ->  triase_maintenance
--
--     `triase_verify_login` tetap memerlukan dua keanggotaan karena
--     verifikasi harus bisa `SET ROLE` ke aplikasi (untuk menguji RLS
--     seperti proses sungguhan) dan ke auditor (untuk rantai audit).
--     Keduanya diwarisi langsung, jadi keduanya berfungsi.
--
-- CATATAN KEAMANAN
--     Pemisahan hak akses tetap terjaga, dan sekarang dapat diuji:
--     `triase_app_login` TIDAK boleh menjadi anggota `triase_migrator`
--     maupun `triase_auditor`, dan `triase_ddl_login` TIDAK boleh menjadi
--     anggota `triase_app`. Pemeriksaan itu ada di blok PENEGAKAN di
--     bawah dan juga di scripts/verify-db.ts.
--
-- CATATAN MIGRASI
--     Peran LOGIN dibuat oleh `scripts/create-login-roles.ts`, bukan oleh
--     migrasi. Bila migrasi ini dijalankan pada database yang belum
--     menjalankan skrip tersebut, blok PENEGAKAN gagal dengan pesan yang
--     jelas. Itu benar: konfigurasi hak akses setengah jadi lebih
--     berbahaya daripada tidak terkonfigurasi sama sekali.
-- ===========================================================================

-- Beri keanggotaan langsung pada peran hak.
GRANT triase_app          TO triase_app_login;
GRANT triase_migrator     TO triase_ddl_login;
GRANT triase_auditor      TO triase_verify_login;
GRANT triase_app          TO triase_verify_login;
GRANT triase_maintenance TO triase_retention_login;

-- Pastikan tidak ada jalur tak terduga dari runtime ke DDL atau audit.
REVOKE triase_migrator   FROM triase_app_login;
REVOKE triase_auditor     FROM triase_app_login;
REVOKE triase_maintenance FROM triase_app_login;
REVOKE triase_app         FROM triase_ddl_login;

-- ---------------------------------------------------------------------------
-- Lepas peran perantara.
--
-- `DROP ROLE` membuang keanggotaannya di pg_auth_members secara otomatis,
-- jadi tidak perlu REVOKE satu per satu.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_remaining text;
BEGIN
    SELECT string_agg(rolname, ', ')
    INTO v_remaining
    FROM pg_roles
    WHERE rolname IN ('triase_runtime', 'triase_ddl', 'triase_verify', 'triase_retention');

    IF v_remaining IS NOT NULL THEN
        -- Peran perantara tidak boleh memiliki objek milik sendiri.
        IF EXISTS (
            SELECT 1
            FROM pg_shdepend s
            WHERE s.deptype = 'o'
              AND s.classid = 'pg_authid'::regclass
              AND s.objid IN (
                  SELECT oid FROM pg_roles
                  WHERE rolname IN ('triase_runtime', 'triase_ddl',
                                    'triase_verify', 'triase_retention')
              )
        ) THEN
            RAISE EXCEPTION
                'Peran perantara (%) masih memiliki objek. Pindahkan kepemilikan sebelum melanjutkan.',
                v_remaining
                USING ERRCODE = 'dependent_objects_still_exist';
        END IF;
    END IF;
END
$$;

DROP ROLE IF EXISTS triase_runtime;
DROP ROLE IF EXISTS triase_ddl;
DROP ROLE IF EXISTS triase_verify;
DROP ROLE IF EXISTS triase_retention;

COMMENT ON ROLE triase_app_login IS
    'Peran LOGIN untuk proses aplikasi runtime. Anggota langsung triase_app. Dibuat oleh scripts/create-login-roles.ts.';
COMMENT ON ROLE triase_ddl_login IS
    'Peran LOGIN untuk proses migrasi. Anggota langsung triase_migrator. Dibuat oleh scripts/create-login-roles.ts.';
COMMENT ON ROLE triase_verify_login IS
    'Peran LOGIN untuk skrip verifikasi. Anggota langsung triase_auditor dan triase_app.';
COMMENT ON ROLE triase_retention_login IS
    'Peran LOGIN untuk job retensi. Anggota langsung triase_maintenance.';

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   1. Peran LOGIN benar-benar mewarisi hak. Diuji dengan hak nyata,
--      bukan hanya keanggotaan, karena itulah yang tadi gagal.
--   2. Runtime tidak memegang hak DDL maupun hak baca kunci.
--   3. DDL tidak memegang hak data runtime.
--   4. Peran perantara sudah tidak ada.
--   5. Kunci KEK tetap tidak dapat dibaca runtime.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_missing text := NULL;
BEGIN
    IF NOT has_column_privilege('triase_app_login', 'public.kek_versions', 'version', 'SELECT') THEN
        v_missing := coalesce(v_missing, '') ||
            ' triase_app_login tidak mewarisi SELECT metadata KEK;';
    END IF;

    IF NOT has_table_privilege('triase_app_login', 'public.aduan', 'SELECT') THEN
        v_missing := coalesce(v_missing, '') ||
            ' triase_app_login tidak mewarisi SELECT aduan;';
    END IF;

    IF pg_has_role('triase_app_login', 'triase_migrator', 'MEMBER') THEN
        v_missing := coalesce(v_missing, '') ||
            ' triase_app_login memegang hak DDL;';
    END IF;

    IF pg_has_role('triase_app_login', 'triase_auditor', 'MEMBER') THEN
        v_missing := coalesce(v_missing, '') ||
            ' triase_app_login memegang hak baca key_material;';
    END IF;

    IF pg_has_role('triase_ddl_login', 'triase_app', 'MEMBER') THEN
        v_missing := coalesce(v_missing, '') ||
            ' triase_ddl_login memegang hak data runtime;';
    END IF;

    IF has_column_privilege('triase_app_login', 'public.kek_versions', 'key_material', 'SELECT') THEN
        v_missing := coalesce(v_missing, '') ||
            ' triase_app_login bisa membaca key_material;';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname IN ('triase_runtime', 'triase_ddl',
                          'triase_verify', 'triase_retention')
    ) THEN
        v_missing := coalesce(v_missing, '') ||
            ' peran perantara masih ada;';
    END IF;

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'Konfigurasi hak akses belum benar:%', v_missing
            USING ERRCODE = 'insufficient_privilege',
                  HINT = 'Jalankan `npm run db:roles` untuk membuat atau merotasi peran LOGIN, lalu ulangi migrasi ini.';
    END IF;
END
$$;