-- ===========================================================================
-- TRIASE-Net :: 0021_argon2id_only.sql
--
-- TUJUAN
--     Menutup celah yang sengaja dibuka di migrasi 0005 demi kenyamanan
--     pengembangan: CHECK `users_staff_credentials_ck` sempat menerima dua
--     prefix hash, yaitu `$argon2id$` (produksi) dan `$scrypt$` (dev).
--
--     Pelonggaran itu BERMASYALAH dan sekarang dihapus:
--       1. Skema tidak lagi menyatakan satu niat algoritma yang tunggal.
--          Integrasi LDAP/OIDC apa pun yang menulis ke `users` bisa
--          memasukkan hash lemah tanpa satu pun penolakan.
--       2. Bila login kata sandi diaktifkan, verifikasi (`verifyPassword`)
--          harus mendukung kedua format. Kegagalan diam-diam pada jalur
--          login adalah kelas kerentanan tersendiri.
--       3. Catatan "persempit regex ini di produksi" tidak pernah
--          dieksekusi. Tidak ada langkah rilis yang mengingatkannya.
--
--     Argumen "hanya Argon2id di produksi" adalah argumen yang salah.
--     Skema harus tegas di semua lingkungan; yang berbeda per lingkungan
--     adalah PARAMETER Argon2id-nya, bukan ALGORITMA yang diizinkan.
--
-- CATATAN KEAMANAN
--     Password hash adalah data publik (CWE-759), tidak seperti kunci
--     enkripsi. Prebuilt binary `@node-rs/argon2` memaketkan implementasi
--     Argon2id terverifikasi (RFC 9106), sehingga tidak ada alasan untuk
--     melemahkan skema hanya karena skrip seed menghindari compiler.
--     `scripts/seed.ts` kini memakai Argon2id juga.
--
--     String PHC Argon2id memuat parameter secara self-describing
--     ($argon2id$v=19$m=...,t=...,p=...), sehingga parameter dapat
--     dinaikkan pada masa depan tanpa mengubah skema.
--
-- KEBIJAKAN PARAMETER (lihat src/lib/auth/password.ts)
--     m = 19456 (19 MiB), t = 2, p = 1
--         Sesuai spesifikasi minimum RFC 9106 dan rekomendasi OWASP untuk
--         hashing kata sandi.
-- ===========================================================================

ALTER TABLE public.users
    DROP CONSTRAINT users_staff_credentials_ck;

ALTER TABLE public.users
    ADD CONSTRAINT users_staff_credentials_ck
    CHECK (
        role = 'MAHASISWA'
            OR (
                -- PHC Argon2id: $argon2id$v=19$m=<mem>,t=<time>,p=<par>$<salt>$<hash>
                password_hash ~ '^\$argon2id\$v=19\$m=\d{1,7},t=\d{1,3},p=\d{1,3}\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{20,}$'
                    AND display_name IS NOT NULL
                )
        );

COMMENT ON CONSTRAINT users_staff_credentials_ck ON public.users IS
    'Tenaga WAJIB memakai hash Argon2id (PHC, RFC 9106) dan nama tampilan. Tidak ada algoritma lain yang diterima, di lingkungan mana pun.';

-- ---------------------------------------------------------------------------
-- PENEGAKAN: tolak basis data yang masih menyimpan hash non-Argon2id.
-- Migrasi ini akan GAGAL dan seluruhnya di-rollback bila masih ada baris
-- yang melanggar aturan baru. Itu disengaja: lebih baik berhenti di sini
-- daripada diam-diam membawa hash lemah ke produksi.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_offenders text;
BEGIN
    SELECT string_agg(email_normalized, ', ')
    INTO v_offenders
    FROM public.users
    WHERE role <> 'MAHASISWA'
      AND password_hash NOT LIKE '$argon2id$%';

    IF v_offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'Pengguna berikut punya hash non-Argon2id dan harus dihapus atau di-reset sebelum migrasi: %',
            v_offenders
            USING ERRCODE = 'check_violation';
    END IF;
END
$$;