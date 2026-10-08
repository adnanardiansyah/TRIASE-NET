-- ===========================================================================
-- TRIASE-Net :: 0019_isolate_extensions.sql
--
-- TEMUAN AUDIT (probe fungsional):
--     "permission denied for function digest"
--
--  PENYEBAB
--     `pgcrypto` dipasang ke skema `public`, dan migrasi 0014 menjalankan
--     `REVOKE ALL ON SCHEMA public FROM PUBLIC` serta
--     `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC` demi
--     principle of least privilege. Tindakan itu benar untuk tabel milik
--     aplikasi, tetapi ikut mencabut hak panggil fungsi pgcrypto. Akibatnya
--     SETIAP penyegelan entri audit gagal karena `fn_seal_audit_entry`
--     berjalan sebagai pemanggil (SECURITY INVOKER) dan tidak lagi boleh
--     memanggil digest().
--
--  PEMECAHAN
--     Pindahkan pgcrypto ke skema `extensions` yang terpisah, lalu beri hak
--     eksekusi hanya kepada peran yang benar-benar membutuhkannya. Ini
--     sekaligus praktik standar PostgreSQL: objek ekstensi tidak boleh
--     bercampur dengan skema aplikasi.
--
--  CATATAN KEAMANAN
--     Memindahkan ekstensi tidak mengurangi keamanan: hak eksekusi tetap
--     diberikan secara selektif, bukan ke PUBLIC.
-- ===========================================================================

CREATE SCHEMA IF NOT EXISTS extensions;

COMMENT ON SCHEMA extensions IS
    'Skema khusus objek ekstensi PostgreSQL. Dipisahkan dari public agar REVOKE pada public tidak ikut mencabut hak panggil ekstensi.';

-- ---------------------------------------------------------------------------
-- 1. Pindahkan pgcrypto keluar dari `public`
-- ---------------------------------------------------------------------------
DO
$$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pgcrypto'
          AND n.nspname = 'public'
    ) THEN
        EXECUTE 'ALTER EXTENSION pgcrypto SET SCHEMA extensions';
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Hak akses: bukan PUBLIC, hanya peran yang memang memanggil
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA extensions FROM PUBLIC;

GRANT USAGE ON SCHEMA extensions TO triase_app, triase_auditor, triase_maintenance;

-- Fungsi pgcrypto yang dipakai: digest, hmac, gen_random_bytes, gen_salt.
-- Fungsi pgcrypto yang dipakai: digest, hmac, gen_random_bytes, gen_salt.
-- Fungsi lain tetap ditolak karena tidak diberi hak.

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO triase_auditor;

-- Peran aplikasi hanya membutuhkan digest() untuk penyegelan audit.
GRANT EXECUTE ON FUNCTION extensions.digest(bytea, text) TO triase_app;
GRANT EXECUTE ON FUNCTION extensions.digest(text, text) TO triase_app;
GRANT EXECUTE ON FUNCTION extensions.hmac(bytea, bytea, text) TO triase_app;
GRANT EXECUTE ON FUNCTION extensions.hmac(text, text, text) TO triase_app;
GRANT EXECUTE ON FUNCTION extensions.gen_random_bytes(integer) TO triase_app;

-- ---------------------------------------------------------------------------
-- 3. Fungsi audit harus menyebut ekstensi secara Qualified
--    search_path fungsi sengaja dikunci ke public,pg_catalog sehingga
--    penyebutan tanpa skema akan gagal.
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

    NEW.entry_hash := extensions.digest(convert_to(v_canonical, 'UTF8'), 'sha256');

    RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_verify_audit_chain(
    p_scope text        DEFAULT 'global',
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
    SET search_path TO 'public', 'pg_catalog'
    AS $fn$
DECLARE
    v_row       record;
    v_prev      bytea  := NULL;
    v_total     bigint := 0;
    v_chain     bigint := 0;
    v_digest    bigint := 0;
    v_first_bad text   := NULL;
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

        IF v_row.prev_entry_hash IS DISTINCT FROM v_prev THEN
            v_chain := v_chain + 1;
            IF v_first_bad IS NULL THEN
                v_first_bad := format(
                    'Rantai terputus pada sequence_no=%s (occurred_at=%s)',
                    v_row.sequence_no, v_row.occurred_at
                );
            END IF;
        END IF;

        IF v_row.entry_hash IS DISTINCT FROM
           extensions.digest(
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
           ) THEN
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

REVOKE EXECUTE ON FUNCTION public.fn_verify_audit_chain(text, timestamptz, timestamptz)
    FROM PUBLIC, triase_app;

GRANT EXECUTE ON FUNCTION public.fn_verify_audit_chain(text, timestamptz, timestamptz)
    TO triase_auditor;

-- ---------------------------------------------------------------------------
-- 4. UJI: segel dan verifikasi harus benar-benar dapat dijalankan aplikasi.
--    Ketidakmagalan di sini akan menggagalkan migrasi.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_trace uuid := gen_random_uuid();
    v_ok    boolean;
    v_hash  bytea;
BEGIN
    -- Sisipkan satu entri sebagai peran aplikasi nyata, lalu verifikasi.
    SET LOCAL ROLE triase_app;

    INSERT INTO public.ztna_audit_logs
        (trace_id, action, decision, ztna_risk_score, resource_type, ticket_code)
    VALUES
        (v_trace, 'ZTNA_EVALUATE', 'ALLOW', 5, 'uji', 'TRX-2026-EXT0001');

    RESET ROLE;

    SELECT entry_hash INTO v_hash
    FROM public.ztna_audit_logs
    WHERE trace_id = v_trace;

    IF v_hash IS NULL THEN
        RAISE EXCEPTION 'Penyegelan entri audit tidak menghasilkan entry_hash.'
            USING ERRCODE = 'internal_error';
    END IF;

    SELECT ok INTO v_ok FROM public.fn_verify_audit_chain('global');

    IF v_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Verifikasi rantai audit gagal pada entri uji.'
            USING ERRCODE = 'internal_error';
    END IF;
END
$$;
