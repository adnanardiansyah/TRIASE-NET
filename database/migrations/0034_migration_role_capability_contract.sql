-- ===========================================================================
-- TRIASE-Net :: 0034_migration_role_capability_contract.sql
--
-- MASALAH
--     Pemisahan hak akses DDL dan runtime terlihat benar di
--     `scripts/verify-db.ts`, tapi belum pernah diuji pada jalur migrasi
--     yang sesungguhnya.
--
--     Menguji `triase_ddl_login` (anggota `triase_migrator`) menjalankan
--     migrasi pada database baru menunjukkan tiga kegagalan berbeda,
--     dan ketiganya nyata:
--
--     1. `permission denied for schema public`
--        `0001_foundation.sql` menjalankan
--            REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--        lalu `0025` memberi CREATE hanya kepada `triase_migrator`.
--        Jadi pada database baru, migrasi 0024 tidak bisa menjalankan
--        DDL apa pun sampai 0025 selesai, padahal 0025 justru salah
--        satu migrasi yang perlu dijalankan.
--
--     2. `permission denied to grant role "triase_migrator"`
--        `0024_direct_membership.sql` menjalankan
--
--            GRANT triase_migrator TO triase_ddl_login;
--            DROP ROLE IF EXISTS triase_runtime;
--            COMMENT ON ROLE triase_ddl_login IS '...';
--
--        Ketiganya butuh atribut CREATEROLE. `triase_migrator` sengaja
--        dibuat NOCREATEROLE, jadi migrasi yang mengubah keanggotaan
--        peran tidak pernah bisa dijalankan oleh peran migrasi.
--
--     3. `0031` juga menjalankan `CREATE ROLE triase_fixture` dan
--        `GRANT triase_fixture TO triase_verify_login`, dengan kelas
--        hak yang sama: butuh CREATEROLE.
--
--     Kesimpulannya bukan "hak akses salah", melainkan pembagian
--     pekerjaan yang belum pernah ditulis secara eksplisit:
--
--         Operasi admin (CREATEROLE)   -> Peran, keanggotaan, COMMENT,
--                                        CREATE ROLE, dan DROP ROLE.
--         Operasi DDL  (CREATE schema) -> Tabel, indeks, policy, fungsi,
--                                        trigger, Constraint, dan
--                                        penulisan baris ke
--                                        schema_migrations.
--
--     `triase_migrator` adalah peran DDL dan tidak akan pernah diberi
--     CREATEROLE. Memberikannya berarti peran migrasi bisa membuat
--     peran baru dan membaca kredensial orang lain lewat pg_authid.
--     Itu akan membatalkan seluruh tujuan pemisahan ini.
--
-- KEPUTUSAN DESAIN
--     Migrasi ini tidak memberi CREATEROLE, dan tidak memberi hak baru
--     apa pun. Yang dilakukan adalah membuat batas kemampuan peran
--     migrasi menjadi terverifikasi, sehingga klaim least privilege
--     punya bukti dan bukan sekadar niat.
--
--     Batas antara operasi admin dan operasi DDL dipisah agar dapat
--     diuji:
--
--       - `scripts/create-login-roles.ts` memakai `DATABASE_ADMIN_URL`
--         untuk operasi peran, termasuk keanggotaan peran LOGIN.
--       - `0024` dan `0031` adalah migrasi peran. Keduanya memakai
--         kelas hak admin dan karena itu dijalankan sebagai admin.
--         Dokumentasi TAHAP-1 akan menyatakan ini secara terbuka.
--
--     URUTAN BOOTSTRAP YANG DIBUKTIKAN
--
--         npm run db:migrate -- --to 0023   (admin)
--         npm run db:roles                  (admin)
--         npm run db:migrate                (admin, 0024 s.d. 0034)
--
--     Jwtama yang DIUJI lewat migrasi ini adalah:
--
--         npm run db:migrate                (triase_ddl_login, 0034+)
--
--     yaitu setelah seluruh migrasi peran selesai, peran migrasi yang
--     bukan superuser dapat menjalankan migrasi skema biasa yang hanya
--     butuh CREATE pada schema. Inilah jalur yang dipakai untuk
--     migrasi lanjutan di masa depan, dan sekarang ada buktinya.
--
--     Yang TIDAK diklaim: bahwa `triase_ddl_login` dapat menjalankan
--     migrasi yang mengubah peran. Itu memang tidak bisa, dan sekarang
--     alasannya terdokumentasi serta punya regression guard.
-- ===========================================================================

-- CATATAN: migrasi ini sengaja TIDAK berisi COMMENT ON ROLE.
--
--     `COMMENT ON ROLE` secara teknis termasuk kelas hak admin
--     (CREATEROLE), sama seperti GRANT role dan DROP ROLE. Jika
--     `COMMENT ON ROLE triase_migrator` diletakkan di sini, migrasi ini
--     tidak akan pernah bisa dijalankan oleh `triase_ddl_login`, karena
--     peran itu NOCREATEROLE. Itu justamente batasan yang sedang
--     dibuktikan di sini, jadi seharusnya tidak dilanggar oleh migrasi
--     yang memverifikasinya.
--
--     Dokumentasi peran disimpan di `scripts/create-login-roles.ts`,
--     yang memang dijalankan memakai `DATABASE_ADMIN_URL`.

-- ---------------------------------------------------------------------------
-- HAK BOOKKEEPING
--
--     `scripts/migrate.ts` mencatat setiap migrasi ke
--     `public.schema_migrations` memakai peran koneksi, bukan lewat
--     `SET ROLE`. Jadi peran migrasi harus bisa INSERT dan SELECT ke
--     tabel itu secara langsung.
--
--     Kenapa ini perlu diberikan eksplisit: tabel `schema_migrations`
--     dibuat oleh `ensureBookkeeping()` pada koneksi pertama, sehingga
--     kepemilikannya jatuh ke peran yang kebetulan menjalankan migrasi
--     pertama. Bila itu admin, `triase_migrator` tidak mewarisi hak apa
--     pun dan akan gagal dengan:
--
--         permission denied for table schema_migrations
--
--     Hanya SELECT dan INSERT. UPDATE, DELETE, dan TRUNCATE sengaja
--     tidak diberikan: riwayat migrasi bersifat immutable, dan
--     `scripts/migrate.ts` menolak berkas yang sudah pernah diterapkan
--     lalu berubah isinya lewat pemeriksaan checksum.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO triase_migrator;
GRANT SELECT, INSERT ON public.schema_migrations TO triase_migrator;

COMMENT ON TABLE public.schema_migrations IS
    'Riwayat migrasi yang diterapkan. Immutable: berkas yang sudah terpasang tidak boleh diubah, dijaga checksum. Hak SELECT dan INSERT hanya pada triase_migrator untuk mencatat penerapan baru.';

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   Kontrak kemampuan peran migrasi. Ini regression guard: bila suatu
--   migrasi di masa depan keliru memberi CREATEROLE atau hak baca kunci
--   kepada peran migrasi, atau mencabut hak CREATE yang dibutuhkan, maka
--   migrasi ini gagal dan masalahnya muncul lebih awal.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad text := NULL;
BEGIN
    -- (1) Peran migrasi tidak boleh punya hak mengubah peran, masuk ke
    --     mode superuser, atau membuat database.
    IF EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'triase_migrator'
          AND (rolcreaterole OR rolsuper OR rolcreatedb)
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator punya CREATEROLE/SUPERUSER/CREATEDB; least privilege dilanggar;';
    END IF;

    -- (2) Peran migrasi harus bisa melakukan DDL skema. Tanpa CREATE,
    --     peran ini tidak berguna sebagai peran migrasi.
    IF NOT has_schema_privilege('triase_migrator', 'public', 'USAGE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator tidak punya USAGE pada schema public;';
    END IF;

    IF NOT has_schema_privilege('triase_migrator', 'public', 'CREATE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator tidak punya CREATE pada schema public; tidak bisa DDL;';
    END IF;

    -- (3) Bookkeeping harus bisa ditulis, dan riwayat harus immutable.
    IF NOT has_table_privilege('triase_migrator', 'public.schema_migrations', 'SELECT')
       OR NOT has_table_privilege('triase_migrator', 'public.schema_migrations', 'INSERT')
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator tidak bisa menulis schema_migrations;';
    END IF;

    IF has_table_privilege('triase_migrator', 'public.schema_migrations', 'UPDATE')
       OR has_table_privilege('triase_migrator', 'public.schema_migrations', 'DELETE')
       OR has_table_privilege('triase_migrator', 'public.schema_migrations', 'TRUNCATE')
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator bisa mengubah riwayat migrasi; seharusnya tidak;';
    END IF;

    -- (4) Runtime tidak boleh punya kemampuan DDL. Inilah yang membuat
    --     REVOKE CREATE ... FROM PUBLIC pada 0001 tetap berguna.
    IF has_schema_privilege('triase_app', 'public', 'CREATE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_app punya CREATE pada schema public; pemisahan DDL bocor;';
    END IF;

    IF has_table_privilege('triase_app', 'public.schema_migrations', 'SELECT')
       OR has_table_privilege('triase_app', 'public.schema_migrations', 'INSERT')
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_app punya akses ke schema_migrations; seharusnya tidak;';
    END IF;

    -- (5) Peran migrasi tidak boleh bisa membaca atau mengubah kunci.
    IF has_column_privilege('triase_migrator', 'public.kek_versions', 'key_material', 'SELECT')
       OR has_column_privilege('triase_migrator', 'public.kek_versions', 'key_material', 'UPDATE')
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator bisa menyentuh key_material; seharusnya tidak;';
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Kontrak kemampuan peran migrasi dilanggar:%', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;
