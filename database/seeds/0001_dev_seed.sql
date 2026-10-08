-- ===========================================================================
-- TRIASE-Net :: seeds/0001_dev_seed.sql
-- Data pengembangan. JANGAN pernah dijalankan pada produksi.
--
-- Seluruh nilai di bawah adalah data fiktif. Kredensial TIDAK ditampilkan
-- di sini; gunakan `npm run db:seed` (scripts/seed.ts) yang membuat hash
-- Argon2id secara acak dan mencetak kredensial sekali ke terminal.
--
-- Menjalankan berkas ini berarti material KEK boleh tertanam di basis data.
-- Set GUC `triase.allow_embedded_kek = 'on'` lebih dahulu bila memakai
-- key_material lokal.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. KEK pengembangan. Pada produksi, key_material harus NULL dan
--    key_reference diisi pointer KMS/HSM.
-- ---------------------------------------------------------------------------
SET triase.allow_embedded_kek = 'on';

INSERT INTO public.kek_versions (version, label, wrap_algorithm, key_material, key_reference, key_checksum)
VALUES (
    1,
    'kek-dev-v1',
    'AES_256_GCM_WRAP',
    decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
    'local://dev/keystore/kek-v1 (DATA UJI - GANTI DI PRODUKSI)',
    NULL
)
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Akun satuan tugas. password_hash sengaja dikosongkan di sini; isi lewat
--    scripts/seed.ts agar hash-nya benar-benar Argon2id.
--    Kolom yang boleh diisi: role, status, identity_provider, institutional_email,
--    display_name, password_hash, mfa_enrolled, mfa_enrolled_at.
-- ---------------------------------------------------------------------------
INSERT INTO public.users (role, status, identity_provider, institutional_email, display_name, password_hash, mfa_enrolled, mfa_enrolled_at)
VALUES
    ('SATGAS', 'ACTIVE', 'LOCAL', 'satgas.fasilitas@poltek.test', 'Petugas Fasilitas (Uji)', NULL, true, now()),
    ('SATGAS', 'ACTIVE', 'LOCAL', 'satgas.keamanan@poltek.test', 'Petugas Keamanan Informasi (Uji)', NULL, true, now()),
    ('ADMIN',  'ACTIVE', 'LOCAL', 'admin@poltek.test', 'Administrator Sistem (Uji)', NULL, true, now())
ON CONFLICT (email_normalized) DO NOTHING;

-- Profil satuan tugas. authorized_categories menentukan cakupan RLS.
INSERT INTO public.satgas_profiles (
    user_id, employee_id, unit_name, position_title,
    authorized_categories, max_decrypt_risk_score, clearance_level,
    duty_status, requires_step_up, kek_access_version
)
SELECT
    u.id,
    'EMP-' || substr(md5(u.institutional_email), 1, 8),
    'Satgas Fasilitas & Teknologi (Uji)',
    'Petugas',
    ARRAY['FASILITAS', 'TEKNOLOGI', 'LAINNYA']::public.aduan_category[],
    69,  -- hanya boleh membuka aduan berisiko MEDIUM
    2,
    'OFF_DUTY',  -- sengaja OFF_DUTY; ubah ke ON_DUTY untuk menguji dekripsi
    true,
    1
FROM public.users u
WHERE u.institutional_email = 'satgas.fasilitas@poltek.test'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.satgas_profiles (
    user_id, employee_id, unit_name, position_title,
    authorized_categories, max_decrypt_risk_score, clearance_level,
    duty_status, requires_step_up, kek_access_version
)
SELECT
    u.id,
    'EMP-' || substr(md5(u.institutional_email), 1, 8),
    'Satgas Keamanan Informasi (Uji)',
    'Analis Keamanan',
    ARRAY['KEAMANAS_INFORMASI', 'TEKNOLOGI', 'KEBERSAMAAN']::public.aduan_category[],
    100,  -- clearance tinggi: boleh menangani aduan berisiko HIGH
    4,
    'OFF_DUTY',
    true,
    1
FROM public.users u
WHERE u.institutional_email = 'satgas.keamanan@poltek.test'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.satgas_profiles (
    user_id, employee_id, unit_name, position_title,
    authorized_categories, max_decrypt_risk_score, clearance_level,
    duty_status, requires_step_up, kek_access_version
)
SELECT
    u.id,
    'EMP-' || substr(md5(u.institutional_email), 1, 8),
    'Unit Administrasi Keamanan Informasi',
    'Administrator',
    ARRAY['AKADEMIK', 'KEUANGAN', 'FASILITAS', 'KEAMANAS_INFORMASI',
          'KESEHATAN', 'KEBERSAMAAN', 'TEKNOLOGI', 'LAINNYA']::public.aduan_category[],
    100,
    5,
    'OFF_DUTY',
    false,
    1
FROM public.users u
WHERE u.institutional_email = 'admin@poltek.test'
ON CONFLICT (user_id) DO NOTHING;

-- Akun mahasiswa uji. Perhatikan: TIDAK ADA password_hash dan TIDAK ADA
-- display_name. Inilah yang ditegakkan CHECK users_mahasiswa_no_*_ck.
INSERT INTO public.users (role, status, identity_provider, institutional_email, subject_ref)
VALUES
    ('MAHASISWA', 'ACTIVE', 'OIDC', '231040001@student.poltek.test', 'oidc|mahasiswa|231040001'),
    ('MAHASISWA', 'ACTIVE', 'OIDC', '231040002@student.poltek.test', 'oidc|mahasiswa|231040002')
ON CONFLICT (email_normalized) DO NOTHING;
