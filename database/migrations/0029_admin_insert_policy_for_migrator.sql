-- ===========================================================================
-- TRIASE-Net :: 0029_admin_insert_policy_for_migrator.sql
--
-- TEMUAN
--     Fixture verifikasi gagal saat menyisipkan baris pengguna:
--
--         ERROR: new row violates row-level security policy for table "users"
--
--     Penyebabnya bukan role DDL yang salah, melainkan aturan RLS yang
--     sering disalahpahami:
--
--     "Tidak ada policy untuk role saya, berarti tidak ada batasan."
--
--     Yang benar adalah kebalikannya. Tabel dengan RLS aktif dan tanpa
--     policy yang cocok untuk sebuah role akan MENAWARKAN semua operasi
--     untuk role tersebut. Role hanya bisa melakukan operasi bila ada
--     policy yang menyebutnya, atau role itu adalah pemilik tabel.
--
--     Perilaku ini memang benar dan desirable untuk tabel data aduan:
--     role yang tidak disebut otomatis tidak bisa membaca. Kekhawatiran
--     kita seharusnya jatuh pada tabel identitas, bukan tabel aduan.
--
-- KEPUTUSAN DESAIN
--     `users` dan `satgas_profiles` adalah tabel identitas dan
--     administrasi, bukan tabel data aduan. Keduanya tidak memuat isi
--     aduan terenkripsi, hanya metadata aktor dan kewenangan.
--
--     Karena itu `triase_migrator` diberi policy INSERT eksplisit pada
--     kedua tabel. Tiga alternatif ditolak:
--
--       - `ALTER ROLE triase_migrator BYPASSRLS`
--         Too broad. Atribut ini mematikan RLS untuk seluruh tabel,
--         termasuk tabel yang belum dibuat, dan tidak tercatat di
--         `pg_policies` sehingga tidak bisa diaudit per-tabel.
--
--       - `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`
--         Mematikan perlindungan tabel secara permanen. Role lain yang
--         salah diberi akses akan langsung lolos.
--
--       - `ALTER TABLE ... FORCE ROW LEVEL SECURITY` lalu insert biasa
--         Tidak menyelesaikan apa pun; RLS tetap butuh policy INSERT.
--
--     Policy eksplisit hanya berlaku pada dua tabel dan satu operasi,
--     dan tercatat di `pg_policies` sehingga dapat diaudit.
--
--     `WITH CHECK (true)` dipakai karena pembuatan akun adalah operasi
--     administrasi. Yang TIDAK diberikan adalah UPDATE dan DELETE, jadi
--     akun yang sudah ada tidak dapat diubah atau dihapus lewat peran
--     migrasi. Kombinasi ini membuat peran DDL bisa membangun fixture
--     tanpa bisa merusaknya.
--
-- CATATAN KEAMANAN
--     `triase_migrator` adalah kredensial yang dipakai CI dan dapat
--     membuat akun dengan role apa pun. Ini tetap jauh lebih terbatas
--     daripada BYPASSRLS, dan kompromi ini tidak dapat dihindari:
--     fixture dan seed harus dapat membuat akun agar keterbatasan role
--     lain bisa diuji.
--
--     Untuk produksi, peran DDL sebaiknya tidak tersedia pada instance
--     aplikasi sama sekali, melainkan hanya pada instance yang
--     menjalankan migrasi. Dengan begitu kredensial ini tidak pernah
--     ada di mesin yang melayani permintaan pengguna.
-- ===========================================================================

CREATE POLICY admin_insert_users
    ON public.users
    FOR INSERT
    TO triase_migrator
    WITH CHECK (true);

CREATE POLICY admin_insert_satgas_profiles
    ON public.satgas_profiles
    FOR INSERT
    TO triase_migrator
    WITH CHECK (true);

COMMENT ON POLICY admin_insert_users ON public.users IS
    'Peran migrasi boleh membuat akun untuk fixture dan seed. Tidak ada policy UPDATE atau DELETE, sehingga akun yang sudah ada tidak dapat diubah lewat jalur migrasi.';

COMMENT ON POLICY admin_insert_satgas_profiles ON public.satgas_profiles IS
    'Peran migrasi boleh membuat profil petugas untuk fixture dan seed. Tidak ada policy UPDATE atau DELETE.';

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   1. RLS tetap AKTIF di kedua tabel; tidak dimatikan.
--   2. Peran DDL punya policy INSERT pada kedua tabel.
--   3. Peran DDL TIDAK punya policy UPDATE, DELETE, atau ALL.
--   4. Peran DDL TIDAK punya atribut BYPASSRLS.
--   5. Peran DDL TIDAK punya policy apa pun pada tabel data aduan.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad text := NULL;
BEGIN
    -- (1) RLS harus tetap aktif. owners harus tetap dihitung, jadi
    --     RLS tidak boleh dimatikan di sini.
    IF (SELECT count(*) FROM pg_class
         WHERE relname IN ('users', 'satgas_profiles') AND relrowsecurity) <> 2
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' RLS tidak aktif pada salah satu tabel identitas;';
    END IF;

    IF (SELECT count(*) FROM pg_class
         WHERE relname IN ('users', 'satgas_profiles') AND NOT relforcerowsecurity) <> 2
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' FORCE ROW LEVEL SECURITY aktif; jangan andalkan pemilik tabel;';
    END IF;

    -- (2) dan (3) hanya boleh ada policy INSERT.
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('users', 'satgas_profiles')
          AND 'triase_migrator' = ANY (roles)
          AND cmd NOT IN ('INSERT')
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' ada policy selain INSERT untuk triase_migrator pada tabel identitas;';
    END IF;

    IF (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename IN ('users', 'satgas_profiles')
           AND 'triase_migrator' = ANY (roles)
           AND cmd = 'INSERT') <> 2
    THEN
        v_bad := coalesce(v_bad, '') ||
            ' policy INSERT untuk triase_migrator belum lengkap;';
    END IF;

    -- (4) Role atribut, bukan policy.
    IF EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'triase_migrator' AND rolbypassrls
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator punya atribut BYPASSRLS; gunakan policy eksplisit;';
    END IF;

    -- (5) Perimeter data aduan tidak boleh tersentuh.
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('aduan', 'aduan_crypto_layers', 'aduan_attachments',
                            'ztna_audit_logs')
          AND 'triase_migrator' = ANY (roles)
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator punya policy RLS pada tabel data; tidak seharusnya;';
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Konfigurasi policy peran DDL belum benar:%', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;