-- ===========================================================================
-- TRIASE-Net :: 0031_fixture_role_for_verification.sql
--
-- MASALAH
--     `scripts/verify-db.ts` butuh dua jenis hak sekaligus, dalam SATU
--     transaksi yang sama:
--
--       - menyisipkan baris identitas (`users`, `satgas_profiles`,
--         `kek_versions`) yang TIDAK boleh disisipkan aplikasi, dan
--       - menyisipkan serta membaca baris `aduan` sebagai `triase_app`
--         untuk menguji RLS seperti proses sungguhan.
--
--     Dua kebutuhan itu tidak bisa dipenuhi satu peran login yang sudah
--     ada, dan tidak seharusnya:
--
--       - `triase_verify_login` adalah anggota `triase_app` dan
--         `triase_auditor`. Ia tidak boleh menjadi anggota
--         `triase_migrator`, sebab Akun yang memeriksa keamanan tidak
--         perlu memegang hak CREATE pada skema.
--       - `triase_ddl_login` adalah anggota `triase_migrator`. Ia tidak
--         boleh menjadi anggota `triase_app`, sebab jalur migrasi tidak
--         perlu membaca atau menulis data aduan.
--
--     Mencoba memakai `triase_ddl_login` untuk seluruh probe berakhir
--     pada `permission denied for table aduan`, karena peran migrasi
--     memang tidak memegang hak data runtime. Itu gagal yang BENAR.
--
-- KEPUTUSAN DESAIN
--     Buat peran khusus fixture: NOLOGIN, hanya bisa INSERT pada tiga
--     tabel identitas, tidak punya DELETE, tidak punya UPDATE, tidak
--     punya SELECT di luar kolom yang dibutuhkan, dan tidak punya hak
--     apa pun pada tabel data.
--
--         triase_verify_login
--             -> triase_app          (menguji RLS sebagai aplikasi)
--             -> triase_auditor      (memeriksa rantai audit)
--             -> triase_fixture      (menyiapkan data fixture)
--
--     Verifikasi menjalankan `SET LOCAL ROLE` ke masing-masing peran
--     dalam satu transaksi, lalu me-ROLLBACK semuanya. Tidak ada hak
--     hapus yang dibutuhkan karena tidak ada baris fixture yang pernah
--     di-commit.
--
--     Peran ini hanya untuk skrip verifikasi lokal dan CI. Ia tidak
--     pernah dipakai oleh aplikasi.
--
-- PEMBATASAN YANG DISENGJA
--   - Tidak ada DELETE. Fixture tidak pernah perlu dihapus karena
--     rollback. Memberi peran migrasi hak hapus adalah kesalahan
--     konseptual yang sudah dibetulkan di 0028.
--   - Tidak ada UPDATE. Akun yang sudah ada tidak dapat diubah.
--   - Tidak ada SELECT pada `kek_versions.key_material`.
--   - Tidak ada hak apa pun pada `aduan` dan friends. Peran ini tidak
--     boleh bisa membaca atau menulis data aduan; seluruh probe dilakukan
--     lewat `triase_app` dengan policy RLS.
--   - Peran ini tidak punya atribut BYPASSRLS dan tidak memegang hak
--     CREATE pada skema.
-- ===========================================================================

CREATE ROLE triase_fixture NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOINHERIT NOREPLICATION NOBYPASSRLS;

COMMENT ON ROLE triase_fixture IS
    'Peran khusus fixture verifikasi. Hanya INSERT pada tabel identitas, tanpa DELETE, tanpa UPDATE, tanpa BYPASSRLS, tanpa hak CREATE. Digunakan oleh scripts/verify-db.ts di dalam transaksi yang di-rollback.';

GRANT USAGE ON SCHEMA public TO triase_fixture;

-- `kek_versions`: hanya kolom non-rahasia. `key_material` TIDAK termasuk.
GRANT INSERT (version, label, key_reference, status) ON public.kek_versions TO triase_fixture;

-- `users`: hanya kolom yang diisi fixture. `password_hash` perlu karena
-- constraint 0021 mewajibkan hash Argon2id untuk peran tenaga.
GRANT INSERT (
    id, role, status, identity_provider,
    institutional_email, subject_ref, display_name, password_hash
) ON public.users TO triase_fixture;

-- `satgas_profiles`: hanya kolom yang diisi fixture.
GRANT INSERT (
    user_id, employee_id, unit_name, authorized_categories,
    max_decrypt_risk_score, clearance_level, duty_status,
    requires_step_up, kek_access_version
) ON public.satgas_profiles TO triase_fixture;

-- Verifikasi perlu membaca baris identitas untuk memeriksa konsistensi
-- (misalnya memastikan foreign key benar-benar menunjuk profil yang ada).
--
-- PENTING: `GRANT SELECT ON ...` TANPA daftar kolom akan MEMBERIKAN
-- `key_material` juga. Semua SELECT di migrasi ini karena itu ditulis
-- per kolom dan `key_material` sengaja tidak disebut.
GRANT SELECT (version, label, key_reference, status) ON public.kek_versions TO triase_fixture;
GRANT SELECT (id, role, status, identity_provider) ON public.users TO triase_fixture;
GRANT SELECT (user_id, employee_id, duty_status, authorized_categories,
              max_decrypt_risk_score, clearance_level, kek_access_version)
    ON public.satgas_profiles TO triase_fixture;

-- RLS pada `users` dan `satgas_profiles` tetap berlaku. Tanpa policy
-- INSERT, peran ini akan DITOLAK, persis seperti peran lain.
CREATE POLICY fixture_insert_users
    ON public.users
    FOR INSERT
    TO triase_fixture
    WITH CHECK (true);

CREATE POLICY fixture_insert_satgas_profiles
    ON public.satgas_profiles
    FOR INSERT
    TO triase_fixture
    WITH CHECK (true);

COMMENT ON POLICY fixture_insert_users ON public.users IS
    'Peran fixture boleh membuat akun untuk pengujian, hanya dalam transaksi yang di-rollback. Tidak ada policy UPDATE atau DELETE.';

COMMENT ON POLICY fixture_insert_satgas_profiles ON public.satgas_profiles IS
    'Peran fixture boleh membuat profil petugas untuk pengujian, hanya dalam transaksi yang di-rollback. Tidak ada policy UPDATE atau DELETE.';

-- Verifikasi melakukan `SET ROLE` ke peran ini, jadi keanggotaan
-- diperlukan. Peran login harus bisa berpindah peran.
GRANT triase_fixture TO triase_verify_login;

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   1. Peran fixture adalah NOLOGIN dan tidak punya atribut berbahaya.
--   2. Tidak punya DELETE maupun TRUNCATE di tabel mana pun.
--   3. Tidak punya UPDATE di tabel mana pun.
--   4. Tidak bisa membaca `key_material`.
--   5. Tidak punya hak apa pun pada tabel data aduan.
--   6. Tidak punya hak CREATE pada skema.
--   7. Runtime dan migrasi TIDAK menjadi anggota peran fixture.
--   8. Hanya `triase_verify_login` yang menjadi anggota.
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

    -- (2) dan (3) tidak boleh punya hak hapus atau ubah di tabel mana pun.
    IF has_table_privilege('triase_fixture', 'public.users', 'DELETE')
       OR has_table_privilege('triase_fixture', 'public.satgas_profiles', 'DELETE')
       OR has_table_privilege('triase_fixture', 'public.kek_versions', 'DELETE')
       OR has_table_privilege('triase_fixture', 'public.aduan', 'DELETE')
    THEN
        v_bad := coalesce(v_bad, '') || ' triase_fixture punya hak DELETE;';
    END IF;

    IF has_table_privilege('triase_fixture', 'public.users', 'UPDATE')
       OR has_table_privilege('triase_fixture', 'public.satgas_profiles', 'UPDATE')
       OR has_table_privilege('triase_fixture', 'public.kek_versions', 'UPDATE')
    THEN
        v_bad := coalesce(v_bad, '') || ' triase_fixture punya hak UPDATE;';
    END IF;

    -- (4) Kunci enkripsi tidak boleh terbaca.
    IF has_column_privilege('triase_fixture', 'public.kek_versions', 'key_material', 'SELECT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_fixture bisa membaca key_material;';
    END IF;

    -- (5) Perimeter data aduan tidak boleh tersentuh.
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

    -- (7) Runtime dan migrasi tidak boleh punya akses fixture.
    IF pg_has_role('triase_app_login', 'triase_fixture', 'MEMBER')
       OR pg_has_role('triase_ddl_login', 'triase_fixture', 'MEMBER')
       OR pg_has_role('triase_retention_login', 'triase_fixture', 'MEMBER')
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' login runtime/migrasi/retensi memegang akses fixture;';
    END IF;

    -- (8) Hanya akun verifikasi yang boleh.
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

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Konfigurasi peran fixture belum benar:%', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;
