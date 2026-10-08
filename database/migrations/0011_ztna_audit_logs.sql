-- ===========================================================================
-- TRIASE-Net :: 0011_ztna_audit_logs.sql
-- Log audit ZTNA: CATATAN KONTEKS AKSES YANG TIDAK DAPAT DIUBAH.
--
-- Empat lapis perlindungan (defense in depth):
--   1. Partisi per bulan  -> retensi & performa.
--   2. Trigger mutasi     -> UPDATE/DELETE/TRUNCATE ditolak.
--   3. GRANT             -> peran runtime tidak memegang hak UPDATE/DELETE.
--   4. Rantai hash        -> entry_hash = SHA256(prev_hash || payload).
--      MenyACD-one entri yang dihapus/diubah akan terlihat pada verifikasi.
--
-- TIDAK ADA kolom plaintext PII di sini. Identitas pelapor direduksi menjadi
-- Pseudonym ID; alamat IP disimpan dalam bentuk penuh maupun terpotong (/24).
-- ===========================================================================

CREATE SEQUENCE public.ztna_audit_logs_id_seq AS bigint;

CREATE TABLE public.ztna_audit_logs
(
    id                 uuid        NOT NULL DEFAULT gen_random_uuid(),

    -- Partisi per bulan (RANGE).
    occurred_at        timestamptz NOT NULL DEFAULT now(),

    -- Urutan global (untuk pengurutan & rantai hash).
    sequence_no        bigint      NOT NULL DEFAULT nextval('public.ztna_audit_logs_id_seq'),

    -- ------------------------------------------------------------------
    -- Konteks Aktor
    -- ------------------------------------------------------------------
    actor_user_id      uuid,
    actor_role         public.app_role,
    actor_pseudonym_id text,
    session_id         uuid,

    -- ------------------------------------------------------------------
    -- Konteks ZTNA (yang dievaluasi oleh PEP di middleware)
    -- ------------------------------------------------------------------
    source_ip          inet,
    source_ip_truncated inet,     -- /24 untuk IPv4, /48 untuk IPv6
    source_port        integer,
    network_zone       text,       -- CAMPUS / LAB / VPN / PUBLIC / DATACENTER
    asn                integer,
    country_code       char(2),

    user_agent         text,
    user_agent_hash    bytea,      -- SHA-256(User-Agent) untuk korelasi
    device_fingerprint_hash bytea, -- SHA-256(device fingerprint)
    device_trust_score smallint,
    client_cert_serial text,       -- bila mTLS diaktifkan

    tls_version        text,
    tls_cipher         text,

    -- ------------------------------------------------------------------
    -- Keputusan Kebijakan
    -- ------------------------------------------------------------------
    ztna_risk_score    smallint    NOT NULL DEFAULT 0,
    ztna_risk_factors  jsonb       NOT NULL DEFAULT '{}'::jsonb,
    ztna_session_score smallint,
    policy_id          text        NOT NULL DEFAULT 'ZTNA-POL-001',
    decision           public.audit_decision NOT NULL,
    action             public.audit_action   NOT NULL,
    reason_code        text,

    auth_method        public.auth_method,
    mfa_verified       boolean     NOT NULL DEFAULT false,
    token_jti          text,       -- korelasi JWT, BUKAN token itu sendiri

    -- ------------------------------------------------------------------
    -- Objek yang diakses
    -- ------------------------------------------------------------------
    resource_type      text,
    resource_id        text,
    ticket_code        text,       -- kode tiket aduan (bukan isi aduan)

    -- ------------------------------------------------------------------
    -- Rantai hash anti-penyuntingan
    -- ------------------------------------------------------------------
    chain_scope        text        NOT NULL DEFAULT 'global',
    prev_entry_hash    bytea,
    entry_hash         bytea        NOT NULL,

    trace_id           uuid        NOT NULL,
    metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,

    -- ---------------------------------------------------------------------
    -- Constraint
    -- ---------------------------------------------------------------------
    PRIMARY KEY (id, occurred_at),

    CONSTRAINT ztna_audit_risk_ck CHECK (ztna_risk_score BETWEEN 0 AND 100),
    CONSTRAINT ztna_audit_session_score_ck CHECK (ztna_session_score IS NULL OR ztna_session_score BETWEEN 0 AND 100),
    CONSTRAINT ztna_audit_device_trust_ck CHECK (device_trust_score IS NULL OR device_trust_score BETWEEN 0 AND 100),
    CONSTRAINT ztna_audit_port_ck CHECK (source_port IS NULL OR (source_port BETWEEN 0 AND 65535)),
    CONSTRAINT ztna_audit_ua_hash_ck CHECK (user_agent_hash IS NULL OR octet_length(user_agent_hash) = 32),
    CONSTRAINT ztna_audit_device_hash_ck CHECK (device_fingerprint_hash IS NULL OR octet_length(device_fingerprint_hash) = 32),
    CONSTRAINT ztna_audit_entry_hash_ck CHECK (octet_length(entry_hash) = 32),
    CONSTRAINT ztna_audit_prev_hash_ck CHECK (prev_entry_hash IS NULL OR octet_length(prev_entry_hash) = 32),
    CONSTRAINT ztna_audit_chain_scope_ck CHECK (chain_scope ~ '^[A-Za-z0-9_.-]{1,64}$'),
    CONSTRAINT ztna_audit_mfa_ck CHECK (mfa_verified = false OR auth_method IS NOT NULL)
) PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE public.ztna_audit_logs IS
    'Jejak audit ZTNA append-only dengan rantai hash. Sumber kebenaran untuk investigasi insiden dan audit internal.';
COMMENT ON COLUMN public.ztna_audit_logs.prev_entry_hash IS
    'entry_hash entri sebelumnya pada chain_scope yang sama. NULL hanya untuk entri pertama.';
COMMENT ON COLUMN public.ztna_audit_logs.entry_hash IS
    'SHA-256(prev_entry_hash || payload_kanonik). Verifikasi dijalankan oleh db:verify.';
COMMENT ON COLUMN public.ztna_audit_logs.token_jti IS
    'ID JWT untuk korelasi. Token akses itu sendiri TIDAK PERNAH disimpan.';
COMMENT ON COLUMN public.ztna_audit_logs.source_ip_truncated IS
    'Bentuk /24 atau /48. Disimpan bersama bentuk penuh agar investigasi tetap mungkin tanpa menyimpan data lengkap.';

-- ---------------------------------------------------------------------------
-- Partisi
-- ---------------------------------------------------------------------------
CREATE TABLE public.ztna_audit_logs_2026_09 PARTITION OF public.ztna_audit_logs
    FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
CREATE TABLE public.ztna_audit_logs_2026_10 PARTITION OF public.ztna_audit_logs
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE public.ztna_audit_logs_2026_11 PARTITION OF public.ztna_audit_logs
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
CREATE TABLE public.ztna_audit_logs_2026_12 PARTITION OF public.ztna_audit_logs
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
CREATE TABLE public.ztna_audit_logs_2027_01 PARTITION OF public.ztna_audit_logs
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

-- Partisi jaring pengaman agar INSERT tidak gagal di luar rentang di atas.
CREATE TABLE public.ztna_audit_logs_default PARTITION OF public.ztna_audit_logs DEFAULT;

-- Fungsi pemeliharaan partisi (panggil berkala, mis. cron bulanan).
CREATE OR REPLACE FUNCTION public.fn_ensure_audit_partition(p_month date)
    RETURNS text
    LANGUAGE plpgsql
AS $$
DECLARE
    v_start   date := date_trunc('month', p_month)::date;
    v_end     date := (date_trunc('month', p_month) + interval '1 month')::date;
    v_name    text := 'ztna_audit_logs_' || to_char(v_start, 'YYYY_MM');
    v_exists  boolean;
BEGIN
    SELECT true
    INTO v_exists
    FROM pg_class
    WHERE relname = v_name;

    IF v_exists THEN
        RETURN v_name || ' (sudah ada)';
    END IF;

    -- Partisi DEFAULT yang sudah berisi baris pada rentang tujuan harus
    -- dipindah lebih dulu, jika tidak CREATE TABLE ... PARTITION OF akan gagal.
    EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.ztna_audit_logs FOR VALUES FROM (%L) TO (%L)',
        v_name, v_start, v_end);

    RETURN v_name || ' (dibuat)';
END;
$$;

-- ---------------------------------------------------------------------------
-- Rantai hash: menyegel setiap entri pada saat INSERT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_seal_audit_entry()
    RETURNS trigger
    LANGUAGE plpgsql
AS $$
DECLARE
    v_prev      bytea;
    v_canonical text;
BEGIN
    --(chain) Serialisasi per lingkup rantai: mencegah dua INSERT paralel
    -- menghasilkan fork sehingga rantai menjadi tidak valid.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.chain_scope, 0));

    SELECT entry_hash
    INTO v_prev
    FROM public.ztna_audit_logs
    WHERE chain_scope = NEW.chain_scope
    ORDER BY sequence_no DESC
    LIMIT 1;

    NEW.prev_entry_hash := v_prev;

    -- Payload kanonik. WAJIB deterministik agar hash dapat direproduksi.
    v_canonical := concat_ws(E'\u001F',
        COALESCE(encode(v_prev, 'hex'), 'GENESIS'),
        NEW.sequence_no::text,
        to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF'),
        COALESCE(NEW.trace_id::text, ''),
        COALESCE(NEW.actor_user_id::text, ''),
        COALESCE(NEW.actor_role::text, ''),
        COALESCE(NEW.actor_pseudonym_id, ''),
        NEW.action::text,
        NEW.decision::text,
        NEW.ztna_risk_score::text,
        COALESCE(NEW.resource_type, ''),
        COALESCE(NEW.resource_id, ''),
        COALESCE(NEW.ticket_code, ''),
        COALESCE(NEW.reason_code, '')
        );

    NEW.entry_hash := digest(convert_to(v_canonical, 'UTF8'), 'sha256');

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_seal_audit_entry() IS
    'Trigger BEFORE INSERT: menghitung prev_entry_hash dan entry_hash dengan advisory lock agar rantai konsisten.';

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_ztna_audit_seal
    BEFORE INSERT
    ON public.ztna_audit_logs
    FOR EACH ROW
EXECUTE FUNCTION public.fn_seal_audit_entry();

-- Immutability: tolak UPDATE / DELETE per baris.
CREATE TRIGGER trg_ztna_audit_no_update
    BEFORE UPDATE OR DELETE
    ON public.ztna_audit_logs
    FOR EACH ROW
EXECUTE FUNCTION public.fn_reject_mutation();

-- Immutability: tolak TRUNCATE per statement.
CREATE TRIGGER trg_ztna_audit_no_truncate
    BEFORE TRUNCATE
    ON public.ztna_audit_logs
FOR EACH STATEMENT
EXECUTE FUNCTION public.fn_reject_mutation();

-- ---------------------------------------------------------------------------
-- Verifikasi rantai (dipakai oleh `npm run db:verify`)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_verify_audit_chain(
    p_scope text DEFAULT 'global',
    p_from   timestamptz DEFAULT NULL,
    p_to     timestamptz DEFAULT NULL
)
    RETURNS TABLE
(
    ok            boolean,
    checked_count bigint,
    broken_count  bigint,
    detail        text
)
    LANGUAGE plpgsql
AS $$
DECLARE
    v_row    record;
    v_prev   bytea := NULL;
    v_broken bigint := 0;
    v_total  bigint := 0;
    v_first_bad text := NULL;
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

            -- Bandingkan prev_entry_hash yang tersimpan dengan hash aktual
            -- entri sebelumnya.
            IF v_row.prev_entry_hash IS DISTINCT FROM v_prev THEN
                v_broken := v_broken + 1;
                IF v_first_bad IS NULL THEN
                    v_first_bad := format('Rantai terputus pada sequence_no=%s (occurred_at=%s)',
                                          v_row.sequence_no, v_row.occurred_at);
                END IF;
            END IF;

            v_prev := v_row.entry_hash;
        END LOOP;

    RETURN QUERY
    SELECT (v_broken = 0), v_total, v_broken, COALESCE(v_first_bad, 'Rantai utuh');
END;
$$;

-- ---------------------------------------------------------------------------
-- Indeks
--   Catatan: trigger no_update membuat UPDATE menjadi sia-sia, tetapi indeks
--   tetap dipertahankan karena batasan UNIQUE/PK internal tetap membutuhkan.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_ztna_audit_occurred
    ON public.ztna_audit_logs (occurred_at DESC);
CREATE INDEX idx_ztna_audit_actor
    ON public.ztna_audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX idx_ztna_audit_trace
    ON public.ztna_audit_logs (trace_id);
CREATE INDEX idx_ztna_audit_decision
    ON public.ztna_audit_logs (decision, occurred_at DESC);
CREATE INDEX idx_ztna_audit_ticket
    ON public.ztna_audit_logs (ticket_code, occurred_at DESC)
    WHERE ticket_code IS NOT NULL;
CREATE INDEX idx_ztna_audit_risk
    ON public.ztna_audit_logs (ztna_risk_score DESC, occurred_at DESC);
CREATE INDEX idx_ztna_audit_device
    ON public.ztna_audit_logs (device_fingerprint_hash, occurred_at DESC)
    WHERE device_fingerprint_hash IS NOT NULL;
CREATE INDEX idx_ztna_audit_chain
    ON public.ztna_audit_logs (chain_scope, sequence_no);
CREATE INDEX idx_ztna_audit_ip
    ON public.ztna_audit_logs (source_ip, occurred_at DESC);
CREATE INDEX idx_ztna_audit_brin ON public.ztna_audit_logs USING BRIN (occurred_at);

-- Log yang menolak akses. Volumen kecil, sangatdik eternallyai.
CREATE INDEX idx_ztna_audit_denied
    ON public.ztna_audit_logs (occurred_at DESC)
    WHERE decision = 'DENY';
