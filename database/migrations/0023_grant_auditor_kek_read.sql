-- ===========================================================================
-- TRIASE-Net :: 0023_grant_auditor_kek_read.sql
--
-- TUJUAN
--     `0022_runtime_roles_and_kek_lockdown.sql` mencabut seluruh hak
--     `triase_app` pada `kek_versions`, lalu mengembalikan SELECT hanya
--     untuk sebelas kolom metadata. Itu bagian yang benar.
--
--     Namun ada efek samping yang belum diperiksa: sebelum migrasi itu,
--     `triase_auditor` TIDAK PUNYA hak apa pun pada `kek_versions`.
--     Komentar di 0022 menyatakan auditor "tetap dapat membaca penuh",
--     dan pernyataan itu salah - tidak ada yang pernahUoiverifikasi.
--
--     Pemeriksaan katalog menunjukkan keadaannya:
--         grantee = triase_auditor, privilege_type = (kosong)
--
--     Setelah pencabutan, `triase_runtime` (yang mewarisi `triase_app`)
--     ikut kehilangan akses metadata KEK. Itu tidakMASALAH untuk
--     integritas, tapi membuat envelope encryption tidak bisa memilih
--     versi KEK aktif. verifiedztna-server harus dapat membaca metadata
--     tanpa dapat membaca kuncinya.
--
-- KEBIJAKAN HAK
--     Auditor adalah pihak yang paling berwenang membuktikan bahwa kunci
--     yang dipakai benar-benar kunci yang tercatat. Menolak akses
--     `key_material` kepada auditor membuat audit KEK mustahil dilakukan,
--     dan audit yang mustahil dilakukan adalah audit yang tidak berjalan.
--
--     Karena itu auditor diberi SELECT penuh pada tabel ini - satu-satunya
--     peran non-superuser yang boleh. `triase_app` tetap tidak dapat
--     membaca materi kunci.
--
-- CATATAN OPERASIONAL
--     Akses ini adalah akses dari server ke kunci. Auditor adalah purely
--     pihak internal dan akunnya harus dikelola terpisah dari akun
--     petugas harian. Untuk deployment dengan pemisahan kuat,
--     pertimbangkan agar `key_material` dienkripsi dengan kunci yang
--     hanya dimuat oleh proses audit terpisah (Tahap 3).
-- ===========================================================================

GRANT SELECT ON public.kek_versions TO triase_auditor;

COMMENT ON ROLE triase_auditor IS
    'Peran audit. Satu-satunya peran non-superuser yang boleh membaca key_material untuk membuktikan konsistensi KEK; tidak dapat menulisnya.';

-- ---------------------------------------------------------------------------
-- PENEGAKAN: memastikan tiga hal sekaligus.
--   1. Auditor bisa membaca tabel (termasuk kunci).
--   2. Aplikasi tetap TIDAK bisa membaca kunci.
--   3. Hanya postgres dan auditor yang punya SELECT pada kolom kunci.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_readers text;
BEGIN
    IF NOT has_table_privilege('triase_auditor', 'public.kek_versions', 'SELECT') THEN
        RAISE EXCEPTION 'triase_auditor harus dapat membaca public.kek_versions untuk audit KEK.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF has_column_privilege('triase_app', 'public.kek_versions', 'key_material', 'SELECT') THEN
        RAISE EXCEPTION 'triase_app tidak boleh membaca key_material.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT string_agg(DISTINCT grantee, ', ')
    INTO v_readers
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'kek_versions'
      AND column_name = 'key_material'
      AND privilege_type = 'SELECT';

    -- postgres (pemilik) dan triase_auditor adalah pembaca yang diizinkan.
    IF v_readers IS NULL
       OR array_to_string(
              ARRAY(
                  SELECT DISTINCT grantee
                  FROM information_schema.column_privileges
                  WHERE table_schema = 'public'
                    AND table_name = 'kek_versions'
                    AND column_name = 'key_material'
                    AND privilege_type = 'SELECT'
              ),
              ','
          ) <> 'postgres,triase_auditor' THEN
        RAISE EXCEPTION
            'Pembaca key_material tidak sesuai harapan. DITEMUKAN: [%]. Hanya postgres dan triase_auditor yang diizinkan.',
            COALESCE(v_readers, '(tidak ada)')
            USING ERRCODE = 'insufficient_privilege';
    END IF;
END
$$;