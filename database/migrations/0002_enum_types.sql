-- ===========================================================================
-- TRIASE-Net :: 0002_enum_types.sql
-- Tipe ENUM sebagai "kamus data" yang dijaga basis data.
-- Semua nilai yang dipakai kode aplikasi WAJIB berasal dari file ini
-- (lihat src/lib/domain/enums.ts) sehingga tidak ada magic string.
-- ===========================================================================

-- --- Aktor & Identitas -----------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
        CREATE TYPE public.app_role AS ENUM ('MAHASISWA', 'SATGAS', 'ADMIN');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
        CREATE TYPE public.user_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DEPROVISIONED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'identity_provider') THEN
        CREATE TYPE public.identity_provider AS ENUM ('LOCAL', 'OIDC', 'SIB');
    END IF;
END
$$;

COMMENT ON TYPE public.app_role IS
    'Aktor utama sistem ZTNA. MAHASISWA tidak pernah memegang kredensial lokal; SATGAS/ADMIN wajib MFA TOTP.';

-- --- Klasifikasi Aduan ------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aduan_category') THEN
        CREATE TYPE public.aduan_category AS ENUM (
            'AKADEMIK',        -- perkuliahan, nilai, absensi, dosen
            'KEUANGAN',        --ukt, spp, beasiswa,honorarium
            'FASILITAS',       -- ruang kelas, toilet, wifi, transport
            'KEAMANAS_INFORMASI', -- akun bocor, phishing, malware
            'KESEHATAN',       -- layanan kesehatan kampus
            'KEBERSAMAAN',     -- perundungan, pelecehan, diskriminasi
            'TEKNOLOGI',       -- sistem informasi, jaringan, perangkat
            'LAINNYA'
            );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aduan_status') THEN
        CREATE TYPE public.aduan_status AS ENUM (
            'DITERIMA',            -- tiket terbit, belum ada tindakan
            'DALAM_PENANGANAN',    -- sedang ditelusuri satuan tugas
            'MENUNGGU_TINDAK_LANJUT', -- perlu persetujuan/klarifikasi
            'SELESAI',             -- tindak lanjut tuntas
            'DITUTUP',             -- ditutup oleh mahasiswa/pengaju
            'DITOLAK'              -- di luar kewenangan / tidak valid
            );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_channel') THEN
        CREATE TYPE public.submission_channel AS ENUM ('WEB', 'MOBILE', 'KIOSK', 'API');
    END IF;
END
$$;

-- --- Klasifikasi Risiko (ZTNA) ---------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_band') THEN
        CREATE TYPE public.risk_band AS ENUM ('LOW', 'MEDIUM', 'HIGH');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'duty_status') THEN
        CREATE TYPE public.duty_status AS ENUM ('ON_DUTY', 'OFF_DUTY', 'LEAVE');
    END IF;
END
$$;

COMMENT ON TYPE public.risk_band IS
    'Turunan dari risk_score: <30 LOW, 30..69 MEDIUM, >=70 HIGH. Dipakai memetakan algoritma enkripsi adaptif.';

-- --- Kriptografi -----------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crypto_algorithm') THEN
        CREATE TYPE public.crypto_algorithm AS ENUM (
            'AES_256_GCM',           -- risiko LOW
            'CHACHA20_POLY1305',     -- risiko MEDIUM
            'HYBRID_DOUBLE'          -- risiko HIGH (GCM di dalam Poly1305)
            );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'key_wrap_algorithm') THEN
        CREATE TYPE public.key_wrap_algorithm AS ENUM (
            'AES_256_GCM_WRAP',      -- DEK dibungkus dengan KEK
            'CHACHA20_POLY1305_WRAP',
            'RSA_OAEP_256'           -- untuk bundling KEK ke kunci publikungguin
            );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kek_status') THEN
        CREATE TYPE public.kek_status AS ENUM ('ACTIVE', 'RETIRED', 'REVOKED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attachment_scan_status') THEN
        CREATE TYPE public.attachment_scan_status AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');
    END IF;
END
$$;

-- --- Audit & Autentikasi ---------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_decision') THEN
        CREATE TYPE public.audit_decision AS ENUM ('ALLOW', 'CHALLENGE', 'DENY');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action') THEN
        CREATE TYPE public.audit_action AS ENUM (
            'ZTNA_EVALUATE',            -- PEP mengevaluasi konteks akses
            'ZTNA_BLOCK',               -- konteks ditolak (risk >= threshold)
            'ZTNA_CHALLENGE',           -- konteks mencurigakan, minta step-up
            'SESSION_INIT',
            'LOGIN_ATTEMPT',
            'LOGIN_MFA_VERIFY',
            'LOGIN_MFA_FAIL',
            'LOGIN_BLOCKED',
            'LOGOUT',
            'TOKEN_REFRESH',
            'TOKEN_REUSE_DETECTED',
            'ADUAN_SUBMIT',
            'ADUAN_METADATA_READ',
            'ADUAN_DECRYPT',
            'ADUAN_DECRYPT_DENIED',
            'ADUAN_STATUS_CHANGE',
            'ADUAN_ATTACHMENT_READ',
            'Kek_ROTATE',
            'KEY_REENCRYPT',
            'RETENTION_CRYPTO_SHRED'
            );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auth_method') THEN
        CREATE TYPE public.auth_method AS ENUM ('PASSWORD', 'TOTP', 'OIDC', 'RECOVERY_CODE', 'STEP_UP');
    END IF;
END
$$;
