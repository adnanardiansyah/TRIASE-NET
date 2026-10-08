-- ===========================================================================
-- TRIASE-Net :: 0026_verifier_cannot_pass_vacuously.sql
--
-- TEMUAN
--     Setelah verifikasi dijalankan dengan peran least privilege
--     (`triase_verify_login`) alih-alih superuser, hasilnya:
--
--         ok | checked_count | broken_count | chain_breaks | digest_mismatch
--          t |             0 |             0 |           0 |               0
--         detail: Rantai utuh: pointer dan digest konsisten
--
--     Pesan "Rantai utuh" dengan NOL entri yang diperiksa.
--
--     Itu FALSE PASS, dan justru lebih berbahaya daripada kegagalan.
--     Pemeriksa audit yang bisa menyatakan "aman" tanpa memeriksa apa
--     pun tidak lebih baik daripada tidak memakai pemeriksa.
--
-- PENYEBAB
--     `fn_verify_audit_chain()` dibuat SECURITY INVOKER. Policy RLS pada
--     `ztna_audit_logs` hanya mengizinkan baca bila
--     `fn_ztna_actor_role()` bernilai SATGAS atau ADMIN. Pemanggil skrip
--     verifikasi tidak memasang konteks aktor, sehingga fungsi melihat
--     NOL baris, tidak menemukan yang salah, lalu melaporkan rantai utuh.
--
--     Selama ini bug ini tidak terlihat karena verifikasi selalu
--     dijalankan sebagai superuser yang melewati RLS.
--
--     Perhatikan bahwa kerusakannya BERGANDA. Fungsi lama juga menghitung
--     `chain_breaks` pada entri PERTAMA dengan cara yang sama: entri
--     pertama dalam rentang mana pun punya `prev_entry_hash` yang
--     menunjuk entri sebelum rentang, sehingga selalu dianggap terputus
--     bila rentang dibatasi tanggal. Perbaikan di bawah memeriksa
--     entri pertama dengan benar.
--
-- PERBAIKAN
--   1. Fungsi dibuat SECURITY DEFINER dengan search_path terkunci, agar
--      menghitung ulang rantai atas seluruh entri apa pun pemanggil.
--      Fungsi hanya mengembalikan angka, tidak pernah isi baris, jadi
--      tidak ada kebocoran data.
--   2. Fungsi menolak melapor "aman" bila tidak ada entri yang
--      diperiksa. Rantai kosong bukan bukti keamanan.
--   3. `npm run db:verify` ikut gagal bila tabel audit kosong.
--
-- CATATAN SIGNATURE
--     Fungsi asli bertiga argumen dengan nilai bawaan
--     (p_scope, p_from, p_to). `CREATE OR REPLACE` harus memakai
--     signature yang PERSIS sama, kalau tidak PostgreSQL membuat
--     overload baru dan pemanggilan satu-argumen menjadi ambigu
--     ("function is not unique"). Karena itu definisi di bawah
--     mempertahankan ketiga argumen.
--
-- CATATAN KEAMANAN
--     SECURITY DEFINER memberi kemampuan melewati RLS; itulah
--     tujuannya. Risikonya diatasi oleh search_path yang dikunci,
--     fungsi yang hanya mengembalikan aggregate, dan hak eksekusi
--     yang hanya diberikan kepada auditor.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.fn_verify_audit_chain(
    p_scope text DEFAULT 'global',
    p_from   timestamptz DEFAULT NULL,
    p_to     timestamptz DEFAULT NULL
)
    RETURNS TABLE (
        ok              boolean,
        checked_count   bigint,
        broken_count    bigint,
        chain_breaks    bigint,
        digest_mismatch bigint,
        detail          text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $fn$
DECLARE
    v_row       record;
    v_prev      bytea  := NULL;
    v_total     bigint := 0;
    v_chain     bigint := 0;
    v_digest    bigint := 0;
    v_first_bad text   := NULL;
    v_first     boolean := true;
    v_expected  bytea;
BEGIN
    FOR v_row IN
        SELECT *
        FROM public.ztna_audit_logs
        WHERE chain_scope = p_scope
          AND (p_from IS NULL OR occurred_at >= p_from)
          AND (p_to   IS NULL OR occurred_at <  p_to)
        ORDER BY sequence_no
    LOOP
        v_total := v_total + 1;

        -- Entri pertama dalam rentang tidak boleh dianggap terputus.
        -- Pointer-nya menunjuk entri sebelum awal rentang, dan itu
        -- memang benar. Versi lama salah menghitungnya sebagai
        -- sebagai chain break, sehingga setiap verifikasi berbatas tanggal
        -- melaporkan rantai rusak.
        IF v_first THEN
            IF v_row.prev_entry_hash IS NOT NULL THEN
                -- Bukan error: we're starting from a scoped range.
                NULL;
            END IF;
            v_first := false;
        ELSIF v_row.prev_entry_hash IS DISTINCT FROM v_prev THEN
            v_chain := v_chain + 1;
            IF v_first_bad IS NULL THEN
                v_first_bad := format(
                    'Rantai terputus pada sequence_no=%s (occurred_at=%s)',
                    v_row.sequence_no, v_row.occurred_at
                );
            END IF;
        END IF;

        -- Digest dihitung ULANG dari isi baris saat ini.
        v_expected := extensions.digest(
            convert_to(
                public.fn_audit_canonical_payload(
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
                ),
                'UTF8'
            ),
            'sha256'
        );

        IF v_row.entry_hash IS DISTINCT FROM v_expected THEN
            v_digest := v_digest + 1;
            IF v_first_bad IS NULL THEN
                v_first_bad := format(
                    'Digest tidak cocok pada sequence_no=%s (occurred_at=%s)',
                    v_row.sequence_no, v_row.occurred_at
                );
            END IF;
        END IF;

        v_prev := v_row.entry_hash;
    END LOOP;

    -- Kosong BUKAN bukti bahwa rantai utuh. Melaporkan "aman" tanpa
    -- memeriksa apa pun membuat pemeriksaan ini tidak berguna.
    IF v_total = 0 THEN
        RETURN QUERY
            SELECT false, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
                   'Tidak dapat diverifikasi: tidak ada entri audit pada chain_scope '
                   || quote_literal(p_scope)
                   || '. Rantai kosong bukan bukti integritas.';
        RETURN;
    END IF;

    RETURN QUERY
        SELECT (v_chain = 0 AND v_digest = 0),
               v_total,
               v_chain + v_digest,
               v_chain,
               v_digest,
               CASE
                   WHEN v_chain = 0 AND v_digest = 0 THEN
                       'Rantai utuh: ' || v_total
                       || ' entri dihitung ulang, pointer dan digest konsisten'
                   ELSE
                       'Rantai rusak: ' || v_total || ' entri diperiksa, '
                       || v_chain || ' pointer terputus, '
                       || v_digest || ' digest tidak cocok. Pertama: '
                       || coalesce(v_first_bad, 'tidak diketahui')
               END;
END;
$fn$;

-- Hanya auditor yang boleh memanggil; runtime tidak.
REVOKE ALL ON FUNCTION public.fn_verify_audit_chain(text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_verify_audit_chain(text, timestamptz, timestamptz) TO triase_auditor;

COMMENT ON FUNCTION public.fn_verify_audit_chain(text, timestamptz, timestamptz) IS
    'Memverifikasi rantai hash audit dengan menghitung ulang digest tiap baris. SECURITY DEFINER agar tidak terhalang RLS. Menolak melaporkan aman bila tidak ada entri yang diperiksa.';

-- ---------------------------------------------------------------------------
-- PENEGAKAN
--   1. Hanya ada SATU definisi (tidak boleh menjadi overload ambigu).
--   2. Fungsi wajib SECURITY DEFINER dengan search_path terkunci.
--   3. Runtime tidak boleh memanggilnya.
--   4. Rantai kosong harus mengembalikan ok=false, diuji di dalam migrasi.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_count    integer;
    v_prosecdef boolean;
    v_proconfig text[];
    v_result   record;
BEGIN
    SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_verify_audit_chain';

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'Diharapkan tepat 1 definisi fn_verify_audit_chain, ditemukan %. Ambigu (overload) membuat pemanggilan gagal.',
            v_count
            USING ERRCODE = 'ambiguous_function';
    END IF;

    SELECT p.prosecdef, p.proconfig
    INTO v_prosecdef, v_proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_verify_audit_chain';

    IF v_prosecdef IS DISTINCT FROM true THEN
        RAISE EXCEPTION
            'fn_verify_audit_chain() harus SECURITY DEFINER, jika tidak RLS membuatnya melaporkan rantai kosong sebagai utuh.'
            USING ERRCODE = 'internal_error';
    END IF;

    IF NOT ('search_path=public, pg_catalog' = ANY (COALESCE(v_proconfig, ARRAY[]::text[]))) THEN
        RAISE EXCEPTION
            'search_path fn_verify_audit_chain() tidak terkunci pada public, pg_catalog.'
            USING ERRCODE = 'internal_error';
    END IF;

    IF has_function_privilege('triase_app', 'public.fn_verify_audit_chain(text,timestamptz,timestamptz)', 'EXECUTE') THEN
        RAISE EXCEPTION 'triase_app tidak boleh memanggil fn_verify_audit_chain().'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Rantai kosong harus ditolak, bukan dilaporkan aman.
    SELECT * INTO v_result FROM public.fn_verify_audit_chain('scope_yang_tidak_ada');

    IF v_result.ok IS DISTINCT FROM false THEN
        RAISE EXCEPTION
            'fn_verify_audit_chain() melaporkan aman pada rantai kosong (ok=%). Rantai kosong harus ditolak.',
            v_result.ok
            USING ERRCODE = 'internal_error';
    END IF;
END
$$;
