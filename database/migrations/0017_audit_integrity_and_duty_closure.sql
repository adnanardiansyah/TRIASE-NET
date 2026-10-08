-- ===========================================================================
-- TRIASE-Net :: 0017_audit_integrity_and_duty_closure.sql
--
-- TEMUAN AUDIT (hasil pemeriksaan langsung terhadap basis data):
--
--  1. Petugas di luar jadwal tetap bisa melihat aduan berisiko 0.
--     Kebijakan `aduan_select_scoped` mensyaratkan dua syarat:
-- TEMUAN AUDIT (hasil pemeriksaan langsung terhadap basis data):
--         AND risk_score <= fn_ztna_max_decrypt_risk_score()
--     Fungsi kedua sudah memeriksa duty_status dan mengembalikan 0 saat
--     OFF_DUTY, sedangkan fungsi pertama TIDAK. Akibatnya categories
--     Akibatnya aduan dengan risk_score = 0 tetap terlihat oleh petugas
--     yang sedang OFF_DUTY. Lubang kebocoran ini nyata.
--
--  2. `fn_verify_audit_chain()` hanya memeriksa KETERHUBUNGAN pointer
--     (prev_entry_hash), bukan isi hash itu sendiri. Somebody yang
--     berhasil mengubah isi baris lalu menghitung ulang rantai hanya perlu
--     menyimpan ulang dua pointer; fungsi verifikasi tetap melaporkan
--     "Rantai utuh". Klaim "immutable hash chain" menjadi tidak dapat
--     dibuktikan.
--
--  PEMECAHAN
--    (1) fn_ztna_authorized_categories() ikut=on_duty + masa berlaku.
--    (2) Payload kanonik dipindahkan ke fungsi IMMUTABLE tunggal
--        `fn_audit_canonical_payload()` yang dipakai OLEH trigger penyegel
--        maupun fungsi verifikasi. Menyatu ini menutup kemungkinan keduanya
--        menyimpang, dan memungkinkan verifier menghitung ulang digest.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. TUTUP JENDELA OFF_DUTY
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ztna_authorized_categories()
    RETURNS public.aduan_category[]
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $fn$
    -- Kosong bila aktor bukan satuan tugas, sedang OFF_DUTY, atau
    -- kewenangannya sudah kedaluwarsa. Inilah yang membuat
    -- `risk_score <= 0` tidak lagi membocorkan baris berisiko rendah.
    SELECT COALESCE(
               array_agg(DISTINCT c),
               '{}'::public.aduan_category[]
           )
    FROM public.satgas_profiles sp,
         unnest(sp.authorized_categories) AS c
    WHERE sp.user_id = public.fn_ztna_actor_id()
      AND sp.duty_status = 'ON_DUTY'
      AND (sp.expires_at IS NULL OR sp.expires_at > now());
    $fn$;

COMMENT ON FUNCTION public.fn_ztna_authorized_categories() IS
    'Kategori yang diizinkan aktor aktif. Mengembalikan array kosong bila bukan satuan tugas, OFF_DUTY, atau kedaluwarsa.';

-- ---------------------------------------------------------------------------
-- 2a. PAYLOAD KANONIK (satu-satunya definisi)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_audit_canonical_payload(
    p_prev_hash       bytea,
    p_sequence_no     bigint,
    p_occurred_at     timestamptz,
    p_trace_id        uuid,
    p_actor_user_id   uuid,
    p_actor_role      text,
    p_pseudonym_id    text,
    p_action          text,
    p_decision        text,
    p_ztna_risk_score smallint,
    p_resource_type   text,
    p_resource_id     text,
    p_ticket_code     text,
    p_reason_code     text
)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    SET search_path TO 'public', 'pg_catalog'
    AS $fn$
    -- Pemisah ASCII Unit Separator (U+001F) dipilih karena mustahil muncul
    -- pada nilai kolom mana pun sehingga tidak ada ambiguitas pemotongan.
    SELECT concat_ws(
        chr(31),
        COALESCE(encode(p_prev_hash, 'hex'), 'GENESIS'),
        p_sequence_no::text,
        to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF'),
        COALESCE(p_trace_id::text, ''),
        COALESCE(p_actor_user_id::text, ''),
        COALESCE(p_actor_role, ''),
        COALESCE(p_pseudonym_id, ''),
        COALESCE(p_action, ''),
        COALESCE(p_decision, ''),
        p_ztna_risk_score::text,
        COALESCE(p_resource_type, ''),
        COALESCE(p_resource_id, ''),
        COALESCE(p_ticket_code, ''),
        COALESCE(p_reason_code, '')
    );
    $fn$;

COMMENT ON FUNCTION public.fn_audit_canonical_payload(
    bytea, bigint, timestamptz, uuid, uuid, text, text, text, text,
    smallint, text, text, text, text) IS
    'Serialisasi deterministik entri audit. Dipakai bersama oleh fn_seal_audit_entry (penulis) dan fn_verify_audit_chain (verifikator) agar keduanya tidak mungkin menyimpang.';

-- ---------------------------------------------------------------------------
-- 2b. PENYEGEL memakai payload bersama
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_seal_audit_entry()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog'
    AS $fn$
DECLARE
    v_prev      bytea;
    v_canonical text;
BEGIN
    -- Advisory lock per lingkup rantai: mencegah dua INSERT paralel
    -- menghasilkan fork yang membuat rantai tidak valid.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.chain_scope, 0));

    SELECT entry_hash
    INTO v_prev
    FROM public.ztna_audit_logs
    WHERE chain_scope = NEW.chain_scope
    ORDER BY sequence_no DESC
    LIMIT 1;

    NEW.prev_entry_hash := v_prev;

    v_canonical := public.fn_audit_canonical_payload(
        v_prev,
        NEW.sequence_no,
        NEW.occurred_at,
        NEW.trace_id,
        NEW.actor_user_id,
        NEW.actor_role::text,
        NEW.actor_pseudonym_id,
        NEW.action::text,
        NEW.decision::text,
        NEW.ztna_risk_score,
        NEW.resource_type,
        NEW.resource_id,
        NEW.ticket_code,
        NEW.reason_code
    );

    NEW.entry_hash := digest(convert_to(v_canonical, 'UTF8'), 'sha256');

    RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2c. VERIFIKATOR menghitung ULANG digest, bukan hanya pointer
--     Dua jenis pelanggaran dilacak terpisah agar pesan diagnostik jelas:
--       chain  = prev_entry_hash tidak cocok dengan entri sebelumnya
--       digest = isi entri diubah tanpa memperbarui entry_hash
--
--     Fungsi lama harus DILETAKKAN lebih dulu: PostgreSQL tidak mengizinkan
--     CREATE OR REPLACE mengubah tipe kembalian (RETURNS TABLE menambah
--     dua kolom). dependent izin dipegang GRANT di bagian 2d di bawah.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_verify_audit_chain(text, timestamptz, timestamptz);

CREATE FUNCTION public.fn_verify_audit_chain(
    p_scope text   DEFAULT 'global',
    p_from   timestamptz DEFAULT NULL,
    p_to     timestamptz DEFAULT NULL
)
    RETURNS TABLE (
        ok             boolean,
        checked_count  bigint,
        broken_count   bigint,
        chain_breaks   bigint,
        digest_mismatch bigint,
        detail         text
    )
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog'
    AS $fn$
DECLARE
    v_row          record;
    v_prev         bytea  := NULL;
    v_total        bigint := 0;
    v_chain        bigint := 0;
    v_digest       bigint := 0;
    v_first_bad    text   := NULL;
    v_recomputed   text;
BEGIN
    FOR v_row IN
        SELECT *
        FROM public.ztna_audit_logs
        WHERE chain_scope = p_scope
          AND (p_from IS NULL OR occurred_at >= p_from)
          AND (p_to IS NULL OR occurred_at < p_to)
        ORDER BY sequence_no
    LOOP
        v_total := v_total + 1;

        -- (a) Keterhubungan pointer
        IF v_row.prev_entry_hash IS DISTINCT FROM v_prev THEN
            v_chain := v_chain + 1;
            IF v_first_bad IS NULL THEN
                v_first_bad := format(
                    'Rantai terputus pada sequence_no=%s (occurred_at=%s)',
                    v_row.sequence_no, v_row.occurred_at
                );
            END IF;
        END IF;

        -- (b) Digest dihitung ulang dari isi baris saat ini
        v_recomputed := public.fn_audit_canonical_payload(
            v_row.prev_entry_hash,
            v_row.sequence_no,
            v_row.occurred_at,
            v_row.trace_id,
            v_row.actor_user_id,
            v_row.actor_role::text,
            v_row.actor_pseudonym_id,
            v_row.action::text,
            v_row.decision::text,
            v_row.ztna_risk_score,
            v_row.resource_type,
            v_row.resource_id,
            v_row.ticket_code,
            v_row.reason_code
        );

        IF v_row.entry_hash
           IS DISTINCT FROM digest(convert_to(v_recomputed, 'UTF8'), 'sha256') THEN
            v_digest := v_digest + 1;
            IF v_first_bad IS NULL THEN
                v_first_bad := format(
                    'Isi entri diubah pada sequence_no=%s (occurred_at=%s)',
                    v_row.sequence_no, v_row.occurred_at
                );
            END IF;
        END IF;

        v_prev := v_row.entry_hash;
    END LOOP;

    RETURN QUERY
    SELECT (v_chain + v_digest = 0),
           v_total,
           v_chain + v_digest,
           v_chain,
           v_digest,
           COALESCE(v_first_bad, 'Rantai utuh: pointer dan digest konsisten');
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2d. HAK EKSEKSI untuk peran auditor (peran app tetap tidak boleh)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.fn_audit_canonical_payload(
    bytea, bigint, timestamptz, uuid, uuid, text, text, text, text,
    smallint, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.fn_audit_canonical_payload(
    bytea, bigint, timestamptz, uuid, uuid, text, text, text, text,
    smallint, text, text, text, text
) TO triase_auditor;

GRANT EXECUTE ON FUNCTION public.fn_verify_audit_chain(text, timestamptz, timestamptz)
    TO triase_auditor;

-- Fungsi ini dipanggil sebagai trigger, sehingga hak EXECUTE tidak diperiksa
-- ulang saat runtime. Namun tetap dipersempit agar tidak bisa dipanggil langsung.
REVOKE EXECUTE ON FUNCTION public.fn_audit_canonical_payload(
    bytea, bigint, timestamptz, uuid, uuid, text, text, text, text,
    smallint, text, text, text, text
) FROM triase_app;

-- ---------------------------------------------------------------------------
-- 3. PENEGAKAN (uji fungsional, bukan sekadar pemeriksaan bentuk)
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_offduty uuid  := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    v_kek     integer;
    v_made_kek boolean := false;
    v_closed  boolean;
BEGIN
    -- satgas_profiles.kek_access_version memiliki FK ke kek_versions, yang
    -- mungkin masih kosong pada instalasi baru. Sediakan KEK sementara.
    IF NOT EXISTS (SELECT 1 FROM public.kek_versions) THEN
        INSERT INTO public.kek_versions (version, label, key_reference, status)
        VALUES (1, 'kek-closure-check', 'closure://check', 'ACTIVE')
        ON CONFLICT (version) DO NOTHING;
        v_made_kek := true;
    END IF;

    SELECT version INTO v_kek FROM public.kek_versions ORDER BY version LIMIT 1;

    -- Petugas dengan kewenangan penuh tetapi sedang OFF_DUTY.
    INSERT INTO public.users (id, role, status, identity_provider,
                              institutional_email, display_name, password_hash)
    VALUES (v_offduty, 'SATGAS', 'ACTIVE', 'LOCAL',
            'closure.check.offduty@poltek.test', 'Closure Check', '$argon2id$probe')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.satgas_profiles (user_id, employee_id, unit_name,
                                        authorized_categories, max_decrypt_risk_score,
                                        clearance_level, duty_status, kek_access_version)
    VALUES (v_offduty, 'CLOSURE-1', 'Closure Check',
            ARRAY['FASILITAS', 'KEBERSAMAAN', 'LAINNYA']::public.aduan_category[],
            100, 5, 'OFF_DUTY', v_kek)
    ON CONFLICT (user_id) DO NOTHING;

    -- Simulasikan konteks aktor di luar jadwal (setelan lokal transaksi).
    PERFORM set_config('triase.actor_id', v_offduty::text, true);
    PERFORM set_config('triase.actor_role', 'SATGAS', true);
    PERFORM set_config('triase.pseudonym_id', '', true);

    v_closed := public.fn_ztna_authorized_categories() = '{}'::public.aduan_category[]
                AND public.fn_ztna_max_decrypt_risk_score() = 0;

    DELETE FROM public.satgas_profiles WHERE user_id = v_offduty;
    DELETE FROM public.users WHERE id = v_offduty;

    IF v_made_kek THEN
        DELETE FROM public.kek_versions WHERE version = v_kek;
    END IF;

    IF NOT v_closed THEN
        RAISE EXCEPTION
            'Jendela OFF_DUTY belum tertutup: petugas di luar jadwal masih menerima kategori dan ambang risiko (categories=%s, max_risk=%s).',
            public.fn_ztna_authorized_categories()::text,
            public.fn_ztna_max_decrypt_risk_score()
            USING ERRCODE = 'internal_error';
    END IF;

    -- Verifikator wajib melaporkan kolom digest_mismatch (OUT parameter).
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'fn_verify_audit_chain'
          AND 'digest_mismatch' = ANY (p.proargnames)
    ) THEN
        RAISE EXCEPTION 'fn_verify_audit_chain() belum melaporkan digest_mismatch.'
            USING ERRCODE = 'internal_error';
    END IF;

    -- Fungsi pemverifikasi digest WAJIB IMMUTABLE agar dapat dipakai ulang
    -- sebagai spesifikasi kanonik.
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'fn_audit_canonical_payload'
          AND p.provolatile = 'i'
    ) THEN
        RAISE EXCEPTION 'fn_audit_canonical_payload() harus IMMUTABLE.'
            USING ERRCODE = 'internal_error';
    END IF;
END
$$;
