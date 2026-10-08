-- ===========================================================================
-- TRIASE-Net :: 0022_runtime_roles_and_kek_lockdown.sql
--
-- TUJUAN
--     Dua hal yang tidak boleh ditunda:
--
--     (A) PEMISAHAN PERAN LOGIN
--         Semua peran yang dibuat migrasi 0001 adalah NOLOGIN, yaitu grup
--         hak akses. Namun `.env.example` memberi contoh URL dengan
--         `triase_migrator` sebagai pengguna login. URL itu tidak akan
--         pernah berhasil, dan yang lebih buruk, mendorong orang membuat
--         peran login sendiri dengan hak terlalu longgar.
--
--         Migrasi ini menambah peran grup yang JELAS per pemakai, lalu
--         `scripts/create-login-roles.ts` membuat pasangan peran LOGIN
--         dengan kata sandi dari environment. Kredensial tidak pernah
--         ditulis di dalam migrasi.
--
--         Pemisahan ini membuat prinsip least privilege dapat diverifikasi:
--         proses runtime tidak pernah memegang hak DDL, dan proses migrasi
--         tidak pernah memegang hak data.
--
--     (B) KEK TIDAK BOLEH TERBACA OLEH APLIKASI  [TEMUAN KRITIS]
--         Pemeriksaan katalog menemukan:
--             triase_app punya hak SELECT pada 13 dari 13 kolom
--             `kek_versions`, termasuk `key_material` dan `key_checksum`.
--
--         `key_material` adalah kunci pembungkus (KEK) yang melindungi
--         setiap DEK. Aplikasi yang bisa membacanya bisa membuka seluruh
--         isi aduan tanpa pernah menyentuh KEK dari vault, dan tanpa
--         jejak dalam log akses basis data.
--
--         Klaim zero-knowledge pada dokumen TAHAP 1 menyatakan isi
--         aduan tidak dapat dibaca oleh server. Pernyataan itu SALAH
--         selama giveaway ini ada: kunci untuk membukanya ada di
--         database yang sama, di bawah peran yang dipakai server.
--
--         Aplikasi runtime HANYA membutuhkan metadata KEK untuk memilih
--         versi aktif. Kuncinya sendiri milik envelope encryption dan
--         dipegang proses kriptografi, bukan query biasa.
--
-- HAK LANGKA YANG DIPERTAHANKAN
--     `kek_versions` tetap dapat dibaca `triase_auditor` penuh, karena
--     audit perlu membuktikan checksum kunci cocok dengan materi kunci.
--
-- CATATAN
--     `key_material` sengaja TIDAK diberi hak INSERT/UPDATE ke
--     `triase_app`. Penyifan/rotasi KEK adalah operasi administratif,
--     bukan tugas runtime.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (A1) Peran grup untuk pemisahan hak akses
-- ---------------------------------------------------------------------------

-- Peran untuk proses runtime (Next.js). Hanya warisan hak dari
-- triase_app; tidak memiliki hak tambahan apa pun.
CREATE ROLE triase_runtime NOLOGIN;

-- Peran untuk proses migrasi. Hanya warisan hak dari triase_migrator.
CREATE ROLE triase_ddl NOLOGIN;

-- Peran untuk skrip verifikasi. Harus dapat berpindah ke triase_app
-- (SET ROLE) untuk menguji RLS seperti yang dilakukan aplikasi sungguhan,
-- dan ke triase_auditor untuk memeriksa rantai audit.
CREATE ROLE triase_verify NOLOGIN;

-- Peran untuk operasi retensi terjadwal (cron/pg_cron).
CREATE ROLE triase_retention NOLOGIN;

GRANT triase_app       TO triase_runtime;
GRANT triase_migrator  TO triase_ddl;
GRANT triase_auditor   TO triase_verify;
GRANT triase_app       TO triase_verify;
GRANT triase_maintenance TO triase_retention;

-- Peran runtime tidak boleh mewarisi hak DDL, dan sebaliknya.
-- Pemisahan ini diperiksa ulang oleh scripts/verify-db.ts.
REVOKE triase_migrator FROM triase_runtime;
REVOKE triase_app       FROM triase_ddl;

COMMENT ON ROLE triase_runtime IS
    'Peran grup untuk proses aplikasi runtime. NOLOGIN; pasangan LOGIN dibuat oleh scripts/create-login-roles.ts.';
COMMENT ON ROLE triase_ddl IS
    'Peran grup untuk proses migrasi (DDL). NOLOGIN; pasangan LOGIN dibuat oleh scripts/create-login-roles.ts.';
COMMENT ON ROLE triase_verify IS
    'Peran grup untuk skrip verifikasi keamanan. NOLOGIN; pasangan LOGIN dibuat oleh scripts/create-login-roles.ts.';
COMMENT ON ROLE triase_retention IS
    'Peran grup untuk job retensi terjadwal. NOLOGIN; pasangan LOGIN dibuat oleh scripts/create-login-roles.ts.';

-- ---------------------------------------------------------------------------
-- (B1) Cabut akses KEK dari peran runtime
-- --------------------------------------------------------------------------
REVOKE ALL ON public.kek_versions FROM triase_app;

-- Hanya metadata yang dibutuhkan envelope encryption untuk memilih versi
-- aktif. `key_material` dan `key_checksum` TIDAK termasuk.
GRANT SELECT (
    version,
    label,
    wrap_algorithm,
    key_reference,
    status,
    activated_at,
    retired_at,
    retired_reason,
    created_at,
    updated_at,
    row_version
) ON public.kek_versions TO triase_app;

COMMENT ON COLUMN public.kek_versions.key_material IS
    'Materi kunci pembungkus (KEK). Dilarang diakses triase_app; hanya triase_migrator (DDL), triase_auditor (audit), dan proses envelope encryption yang boleh.';
COMMENT ON COLUMN public.kek_versions.key_checksum IS
    'Checksum materi kunci. Dilarang diakses triase_app agar isi kunci tidak dapat dicocokkan dari sisi aplikasi.';

-- ---------------------------------------------------------------------------
-- (B2) Verifikasi dalam transaksi yang sama: aplikasi tidak boleh
--      membaca kunci. Bila regression, migrasi ini berhenti di sini.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_leaked text;
BEGIN
    -- ROLLBACK bila hak baca kolom kunci merembet ke peran lain.
    SELECT string_agg(DISTINCT grantee, ', ')
    INTO v_leaked
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'kek_versions'
      AND privilege_type IN ('SELECT', 'UPDATE', 'INSERT', 'DELETE')
      AND column_name IN ('key_material', 'key_checksum')
      AND grantee IN ('PUBLIC', 'triase_app', 'triase_runtime');

    IF v_leaked IS NOT NULL THEN
        RAISE EXCEPTION
            'Akses ke key_material/key_checksum masih diberikan kepada: %. Tutup celah ini sebelum melanjutkan.',
            v_leaked
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- (A2) Pastikan peran baru benar-benar terpisah.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad text;
BEGIN
    IF pg_has_role('triase_runtime', 'triase_migrator', 'MEMBER') THEN
        RAISE EXCEPTION 'triase_runtime mewarisi hak DDL (triase_migrator).'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF pg_has_role('triase_ddl', 'triase_app', 'MEMBER') THEN
        RAISE EXCEPTION 'triase_ddl mewarisi hak data runtime (triase_app).'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT string_agg(r, ', ')
    INTO v_bad
    FROM unnest(ARRAY['triase_runtime', 'triase_ddl', 'triase_verify', 'triase_retention']) AS r
    WHERE EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = r AND rolcanlogin
    );

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION
            'Peran grup berikut seharusnya NOLOGIN: %', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;