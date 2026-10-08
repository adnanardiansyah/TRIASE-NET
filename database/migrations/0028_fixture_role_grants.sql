-- ===========================================================================
-- TRIASE-Net :: 0028_fixture_role_grants.sql
--
-- TEMUAN
--     Menjalankan `npm run db:verify` dengan peran least privilege
--     gagal pada fixture:
--
--         ERROR: new row violates row-level security policy for table "users"
--         ERROR: permission denied for table users
--
-- PENYEBAB
--     Fixture membutuhkan baris pengguna, profil petugas, dan KEK.
--     Ketiganya dilindungi RLS terhadap peran aplikasi, dan peran DDL
--     tidak punya hak INSERT sama sekali: migrasi 0014 hanya memberi
--     hak tabel kepada `triase_app` dan `triase_auditor`.
--
--     RLS di sini benar dan tidak boleh dilonggarkan. Yang dibutuhkan
--     adalah hak INSERT dan DELETE PER KOLOM pada peran DDL, dan hanya
--     untuk kolom yang dipakai fixture.
--
--     CATATAN: `triase_app` memang diberi hak INSERT tingkat kolom pada
--     `users` oleh migrasi 0014, untuk kebutuhan fase berikutnya. Yang
--     menentukan apakah itu bisa dipakai adalah KEBIJAKAN RLS, dan
--     tabel `users` tidak punya kebijakan INSERT sama sekali. Tanpa
--     policy, setiap INSERT ditolak untuk peran aplikasi.
--
--     Yang diperiksa di bawah adalah kebenarannya, bukan pemberian
--     haknya: bila suatu saat ada policy INSERT untuk `triase_app`,
--     pemeriksaan ini akan gagal dan memaksa peninjauan ulang.
--
-- CATATAN DESAIN
--     `GRANT INSERT ON public.users` untuk peran DDL akan berarti
--     perimeter ini dapat membuat pengguna dengan kolom apa pun,
--     termasuk menulis `password_hash` milik siapa pun. Karena itu
--     hak diberikan per kolom.
--
--     PostgreSQL tidak mendukung hak DELETE per kolom, dan fixture
--     tidak membutuhkan hapus sama sekali karena seluruhnya di-rollback.
--
--     Peran DDL tetap tidak boleh:
--       - menghapus tabel pengguna secara keseluruhan
--       - membaca `key_material` lewat kueri SQL
--       - menghapus data aduan atau audit
--
-- CATATAN MIGRASI
--     Berkas ini menggantikan usaha awal yang salah penempatan di
--     `0027_verify_role_read_access.sql`, yang sudah sempat diterapkan.
--     Isi 0027 tidak diubah; hak fixture dipindahkan ke sini agar
--     checksum yang sudah tercatat tetap cocok.
-- ===========================================================================

-- Fixture pengguna: perlu INSERT untuk membuat actor uji.
GRANT INSERT (
    id,
    role,
    status,
    identity_provider,
    institutional_email,
    subject_ref,
    display_name,
    password_hash,
    created_at,
    updated_at
) ON public.users TO triase_migrator;

GRANT SELECT (
    id,
    role,
    status,
    identity_provider,
    institutional_email,
    subject_ref,
    display_name,
    password_hash,
    created_at,
    updated_at
) ON public.users TO triase_migrator;

-- CATATAN PENTING SOAL HAPUS
--     PostgreSQL TIDAK mendukung hak DELETE per kolom
--     (`GRANT DELETE (col) ON ...` ditolak: "invalid privilege type
--     DELETE for column"). Satu-satunya pilihan adalah DELETE tingkat
--     tabel.
--
--     Memberi DELETE tingkat tabel pada `users` kepada peran DDL
--     berarti peran itu bisa menghapus pengguna produksi. Itu risiko
--     nyata, meskipun `users` tidak punya trigger append-only.
--
--     Solusi yang dipakai: fixture TIDAK dihapus lewat hak DELETE.
--     `scripts/verify-db.ts` menjalankan seluruh fixture di dalam
--     satu transaksi yang di-rollback, sehingga tidak pernah ada baris
--     fixture yang perlu dihapus sama sekali. Kebersihan tercapai
--     oleh rollback, bukan oleh hak hapus.
--
--     Karena itu peran DDL tidak diberi hak DELETE apa pun pada tabel
--     aplikasi. Kebersihan fixture adalah tanggung jawab skrip, dan
--     rollback adalah mekanisme yang paling gagal-kecilnya: kalau
--     proses mati di tengah jalan, transaksi PostgreSQL sudah
--     membatalkan dirinya sendiri.

-- Fixture profil petugas.
GRANT INSERT (
    user_id,
    employee_id,
    unit_name,
    authorized_categories,
    max_decrypt_risk_score,
    clearance_level,
    duty_status,
    requires_step_up,
    kek_access_version,
    created_at,
    updated_at
) ON public.satgas_profiles TO triase_migrator;

GRANT SELECT ON public.satgas_profiles TO triase_migrator;

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   1. Peran DDL bisa menyisipkan fixture (users, satgas_profiles, kek).
--   2. Peran DDL TIDAK punya DELETE tingkat tabel pada `users`.
--   3. Peran DDL TIDAK bisa membaca `key_material`.
--   4. Peran DDL TIDAK boleh menghapus data aduan atau audit.
--     5. Runtime tidak punya kebijakan INSERT pada tabel pengguna, sehingga
--        tidak dapat membuat akun petugas baru dari aplikasi.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad text := NULL;
BEGIN
    IF NOT has_column_privilege('triase_migrator', 'public.users', 'id', 'INSERT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator tidak bisa menyisipkan fixture pengguna;';
    END IF;

    IF NOT has_column_privilege('triase_migrator', 'public.satgas_profiles', 'employee_id', 'INSERT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator tidak bisa menyisipkan fixture profil petugas;';
    END IF;

    IF NOT has_column_privilege('triase_migrator', 'public.kek_versions', 'version', 'INSERT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator tidak bisa menyisipkan fixture KEK;';
    END IF;

    IF has_table_privilege('triase_migrator', 'public.users', 'DELETE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator punya DELETE pada users; fixture harus dibersihkan lewat rollback, bukan hak hapus;';
    END IF;

    IF has_table_privilege('triase_migrator', 'public.satgas_profiles', 'DELETE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator punya DELETE pada satgas_profiles;';
    END IF;

    IF has_column_privilege('triase_migrator', 'public.kek_versions', 'key_material', 'SELECT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator bisa membaca key_material lewat kueri;';
    END IF;

    IF has_table_privilege('triase_migrator', 'public.aduan', 'DELETE')
       OR has_table_privilege('triase_migrator', 'public.ztna_audit_logs', 'DELETE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator boleh menghapus data aduan atau audit;';
    END IF;

    --     Runtime tidak boleh dapat membuat akun petugas dari aplikasi.
--     `triase_app` memang memegang hak INSERT tingkat kolom pada
--     `users` dari migrasi 0014, tetapi TIDAK ada kebijakan INSERT pada
--     tabel itu, sehingga setiap INSERT tetap ditolak oleh RLS.
--     Yang diperiksa adalah ketiadaan policy tersebut.
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('users', 'satgas_profiles')
          AND cmd = 'INSERT'
          AND 'triase_app' = ANY (roles)
    ) THEN
        v_bad := coalesce(v_bad, '') ||
            ' ada policy INSERT untuk triase_app pada tabel pengguna; perlu ditinjau ulang;';
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Konfigurasi hak fixture belum benar:%', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;
