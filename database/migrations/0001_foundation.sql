-- ===========================================================================
-- TRIASE-Net :: 0001_foundation.sql
-- Judul  : Inisialisasi Fondasi - Ekstensi, Peran (Role), dan Konfigurasi Sesi
-- Tujuan : Membangun "./roles" dan batas hak akses minimal (Least Privilege)
--          sebagai fondasi seluruh skema.
-- Catatan: Dijalankan di dalam SATU transaksi oleh `scripts/migrate.ts`.
--          File ini SENGAJA tidak memuat BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Ekstensi
--    pgcrypto menyediakan: gen_random_uuid(), digest(), hmac(), gen_salt()
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 2. Kunci skema `public`
--    Tanpa ini, peran publik dapat membuat objek baru pada search_path default.
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Pembagian Peran (Role Separation)
--
--    triase_migrator : pemilik skema & objek. Hanya dipakai pada pipeline CI/CD.
--                      SANGAT BERBAHAYA bila bocor - dapat membaca apa pun.
--    triase_app      : peran runtime aplikasi Next.js. MEWAJIBKAN lewat
--                      connection string DATABASE_URL.
--    triase_auditor  : peran read-only untuk auditorsi/pemeriksa eksternal.
--
--    Semua peran dibuat sebagai NOLOGIN (group role). Login dikaitkan kemudian
--    dari sisi infrastruktur, bukan dari dalam basis data.
-- ---------------------------------------------------------------------------
DO
$$
    DECLARE
        v_role text;
    BEGIN
        FOREACH v_role IN ARRAY ARRAY ['triase_migrator', 'triase_app', 'triase_auditor']
            LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', v_role);
                END IF;
            END LOOP;
    END
$$;

-- Peran yang menjalankan migrasi otomatis menjadi anggota triase_migrator.
DO
$$
BEGIN
    IF NOT (pg_has_role(current_user, 'triase_migrator', 'MEMBER')) THEN
        EXECUTE format('GRANT triase_migrator TO %I', current_user);
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO triase_app, triase_auditor;

-- ---------------------------------------------------------------------------
-- 4. Pengetatan Konfigurasi Sesi (session hardening)
--    - search_path eksplisit  : mencegah injeksi objek via search_path
--    - timezone UTC           : konsistensi timestamp audit & partisi
--    - statement_timeout      : mitigasi Denial-of-Service pada kueri
--    - idle timeout           : minimalist collateral damage bila kredensial bocor
-- ---------------------------------------------------------------------------
DO
$$
BEGIN
    EXECUTE 'ALTER ROLE triase_app SET search_path = public, pg_catalog';
    EXECUTE 'ALTER ROLE triase_app SET timezone = ''UTC''';
    EXECUTE 'ALTER ROLE triase_app SET statement_timeout = ''15s''';
    EXECUTE 'ALTER ROLE triase_app SET idle_in_transaction_session_timeout = ''10s''';
    EXECUTE 'ALTER ROLE triase_app SET lock_timeout = ''5s''';
    EXECUTE 'ALTER ROLE triase_app SET default_transaction_read_only = off';

    EXECUTE 'ALTER ROLE triase_auditor SET search_path = public, pg_catalog';
    EXECUTE 'ALTER ROLE triase_auditor SET timezone = ''UTC''';
    EXECUTE 'ALTER ROLE triase_auditor SET default_transaction_read_only = on';
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Catatan versi skema (di-bootstrap runner, didefinisikan di sini agar
--    migrasi berikutnya tidak bergantung pada tabel bootstrap).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schema_migrations
(
    version      text PRIMARY KEY,
    checksum     text        NOT NULL,
    applied_at   timestamptz NOT NULL DEFAULT now(),
    applied_by   text        NOT NULL DEFAULT current_user,
    execution_ms integer     NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.schema_migrations IS
    'Buku besar migrasi. Diperlukan untuk mendeteksi migrasi yang sudah diubah setelah applied (checksum drift).';
