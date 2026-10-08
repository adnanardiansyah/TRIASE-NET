-- ===========================================================================
-- TRIASE-Net :: 0020_seal_audit_as_definer.sql
--
-- TEMUAN AUDIT (probe fungsional):
--     verifikasi gagal: ok=false checked=3 broken=2 chain=2 digest=0
--
--  DIAGNOSIS
--     Digest setiap entri sudah benar (digest_mismatch = 0). Yang rusak
--     Digest setiap entri sudah benar (digest_mismatch = 0). Yang rusak
--     adalah KETERHUBUNGAN rantai (chain_breaks = 2).
--  PENYEBAB
--     `fn_seal_audit_entry` berjalan sebagai pemanggil (SECURITY INVOKER).
--     Untuk mencari hash entri sebelumnya ia menjalankan:
--         SELECT entry_hash FROM public.ztna_audit_logs
--          WHERE chain_scope = NEW.chain_scope
--          ORDER BY sequence_no DESC LIMIT 1;
--     Query tersebut tunduk pada RLS. Kebijakan baca pada
--     `ztna_audit_logs` hanya diberikan kepada `triase_auditor`, sehingga
--     saat aplikasi menulis entri, kode peran aplikasi tidak melihat
--     SATU PUN baris sebelumnya dan `NEW.prev_entry_hash` selalu bernilai
--     NULL.
--
--     Akibatnya SETIAP entri audit yang ditulis aplikasi terputus dari
--     rantai. Klaim "immutable hash chain" jadi tidak berlaku untuk
--     lintasan penulisan yang paling sering terjadi.
--
--  PEMECAHAN
--     Jadikan `fn_seal_audit_entry` SECURITY DEFINER agar pembacaan entri
--     sebelumnya dilakukan sebagai pemilik tabel, bukan sebagai peran
--     pemanggil. Fungsi ini tidak pernah mengembalikan data apa pun kepada
--     pemanggil selain penulisan baris yang memang diizinkan kebijakan RLS
--     `audit_insert_system`, sehingga tidak ada kebocoran informasi baru.
--
--  PENTING
--     Fungsi tetap TIDAK diberi hak eksekusi untuk peran mana pun pada
--     migrate/verify. Ia hanya dapat dipicu sebagai trigger, dan hak trigger
--     diperiksa hanya saat trigger dibuat. Ini mencegah pemanggilan manual.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.fn_seal_audit_entry()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $fn$
DECLARE
    v_prev      bytea;
    v_canonical text;
BEGIN
    -- Advisory lock per lingkup rantai: mencegah dua INSERT paralel
    -- menghasilkan fork yang membuat rantai tidak valid.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.chain_scope, 0));

    -- Dibaca sebagai pemilik tabel agar tidak terhalang RLS. Inilah
    -- perbaikan inti: sebagai INVOKER, baris sebelumnya tidak terlihat dan
    -- rantai selalu terputus.
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

-- ---------------------------------------------------------------------------
-- PENEGAKAN: fungsi wajib SECURITY DEFINER dan search_path-nya terkunci.
-- ---------------------------------------------------------------------------
DO
$$
DECLARE
    v_prosecdef boolean;
    v_proconfig text[];
BEGIN
    SELECT p.prosecdef, p.proconfig
    INTO v_prosecdef, v_proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_seal_audit_entry';

    IF v_prosecdef IS DISTINCT FROM true THEN
        RAISE EXCEPTION
            'fn_seal_audit_entry() harus SECURITY DEFINER, jika tidak rantai audit terputus pada setiap entri yang ditulis aplikasi.'
            USING ERRCODE = 'internal_error';
    END IF;

    IF NOT ('search_path=public, pg_catalog' = ANY (COALESCE(v_proconfig, ARRAY[]::text[]))) THEN
        RAISE EXCEPTION
            'search_path fn_seal_audit_entry() tidak terkunci pada public, pg_catalog.'
            USING ERRCODE = 'internal_error';
    END IF;
END
$$;
