-- ===========================================================================
-- TRIASE-Net :: 0027_verify_role_read_access.sql
--
-- TEMUAN
--     `npm run db:verify` dijalankan dengan peran least privilege
--     (`triase_verify_login`) alih-alih superuser, gagal pada dua tempat:
--
--       1. "Tabel wajib ada - hilang: schema_migrations"
--       2. "Uji fungsional RLS - fixture gagal:
--          permission denied for table kek_versions"
--
-- PENYEBAB
--     Peran verifier belum diberi hak baca pada dua hal yang memang
--     perlu ia periksa:
--
--       - `schema_migrations` adalah bukti apa yang sudah diterapkan.
--         Verifikasi yang tidak bisa membacanya tidak bisa memastikan
--         skema sesuai dengan yang dimaksud.
--       - `kek_versions` dibutuhkan fixture untuk menyisipkan KEK
--         palsu pada versi 901.
--
--     Peran DDL (`triase_ddl_login`) dapat keduanya, karena migrasi
--     0025 memberinya CREATE pada schema public.
--
-- PERBAIKAN
--     1. Beri `triase_auditor` hak SELECT pada `schema_migrations`.
--        `triase_verify_login` mewarisi hak ini.
--     2. Beri `triase_migrator` hak INSERT dan SELECT pada
--        `kek_versions`, SECARA BERKOLOM dan TANPA `key_material`.
--
--     Catatan: migrasi 0014 tidak pernah memberi hak tabel apa pun
--     kepada `triase_migrator`. Peran DDL bisa membuat skema tetapi
--     tidak bisa membaca isinya.
--
--     Hak diberikan PER KOLOM. Hak tabel berlaku otomatis ke seluruh
--     kolom termasuk `key_material`, dan REVOKE tingkat kolom tidak
--     bisa membatalkan hak tingkat tabel. Karena itu tidak ada
--     `GRANT SELECT ON public.kek_versions` di sini.
--
-- CATATAN KEAMANAN
--     `schema_migrations` hanya berisi nama berkas dan checksum
--     SHA-256. Tidak ada data sensitif di sana, dan membacanya
--     merupakan bagian dari tugas audit.
--
--     Yang TIDAK diberi ke auditor adalah hak INSERT ke `kek_versions`.
--     Membaca kunci untuk audit berbeda dari menulis kunci: menulis KEK
--     adalah operasi administratif yang harus selalu menghasilkan
--     jejak, dan tidak boleh bisa dilakukan oleh akun pemeriksa.
--
-- CATATAN MIGRASI
--     Hak fixture untuk tabel `users` dan `satgas_profiles` awalnya
--     dicoba diletakkan di berkas ini. Itu keliru karena kedua tabel
--     itu juga dilindungi RLS terhadap peran aplikasi, sehingga
--     diperlukan hak INSERT tambahan. Hak tersebut dipindahkan ke
--     `0028_fixture_role_grants.sql` agar pemisahan tanggung jawabnya
--     jelas.
-- ===========================================================================

GRANT SELECT ON public.schema_migrations TO triase_auditor;

GRANT INSERT (
    version,
    label,
    wrap_algorithm,
    key_reference,
    key_checksum,
    status,
    activated_at
) ON public.kek_versions TO triase_migrator;

GRANT SELECT (
    version,
    label,
    wrap_algorithm,
    key_reference,
    key_checksum,
    status,
    activated_at,
    retired_at,
    retired_reason,
    created_at,
    updated_at,
    row_version
) ON public.kek_versions TO triase_migrator;

COMMENT ON TABLE public.schema_migrations IS
    'Catatan migrasi yang sudah diterapkan (nama berkas + checksum SHA-256). Dapat dibaca triase_auditor untuk audit skema.';
COMMENT ON TABLE public.kek_versions IS
    'Metadata dan materi kunci pembungkus (KEK). Runtime hanya boleh 11 kolom metadata; key_material hanya untuk postgres dan triase_auditor.';

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   1. Auditor bisa membaca schema_migrations, tidak boleh menulisnya.
--   2. Migrator boleh menyisipkan fixture KEK, tetapi hanya pada kolom
--      non-rahasia.
--   3. Migrator TIDAK boleh membaca key_material lewat kueri.
--   4. Auditor TIDAK boleh menyisipkan KEK baru.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_bad text := NULL;
BEGIN
    IF NOT has_table_privilege('triase_auditor', 'public.schema_migrations', 'SELECT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_auditor tidak bisa membaca schema_migrations;';
    END IF;

    IF has_table_privilege('triase_auditor', 'public.schema_migrations', 'INSERT')
       OR has_table_privilege('triase_auditor', 'public.schema_migrations', 'UPDATE')
       OR has_table_privilege('triase_auditor', 'public.schema_migrations', 'DELETE') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_auditor boleh menulis schema_migrations;';
    END IF;

    -- Hak INSERT diberikan per kolom, jadi pemeriksaan juga per kolom.
    IF NOT has_column_privilege('triase_migrator', 'public.kek_versions', 'version', 'INSERT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator tidak bisa menyisipkan fixture KEK;';
    END IF;

    IF NOT has_column_privilege('triase_migrator', 'public.kek_versions', 'key_checksum', 'INSERT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator tidak bisa menulis key_checksum fixture;';
    END IF;

    IF has_column_privilege('triase_migrator', 'public.kek_versions', 'key_material', 'SELECT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_migrator bisa membaca key_material lewat kueri;';
    END IF;

    IF has_table_privilege('triase_auditor', 'public.kek_versions', 'INSERT') THEN
        v_bad := coalesce(v_bad, '') ||
            ' triase_auditor boleh menyisipkan KEK;';
    END IF;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Konfigurasi hak akses verifikasi belum benar:%', v_bad
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;