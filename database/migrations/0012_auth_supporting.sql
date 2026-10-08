-- ===========================================================================
-- TRIASE-Net :: 0012_auth_supporting.sql
-- Tabel pendukung autentikasi & ZTNA session.
--
-- Prinsip: TIDAK ADA token yang disimpan dalam bentuk yang dapat dibaca ulang.
-- Hanya hash SHA-256 dari refresh token, dengan rotasi + deteksi reuse.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Sesi ZTNA (konteks perangkat yang diikat ke token akses)
-- ---------------------------------------------------------------------------
CREATE TABLE public.ztna_sessions
(
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,

    -- Konteks perangkat yang dipakai PEP saat evaluasi.
    device_fingerprint_hash bytea     NOT NULL,
    device_trust_score    smallint    NOT NULL DEFAULT 50,
    network_zone          text        NOT NULL DEFAULT 'UNKNOWN',
    asn                   integer,
    user_agent_hash       bytea,

    -- Skor & keputusan yang diberikan middleware.
    ztna_risk_score       smallint    NOT NULL DEFAULT 0,
    ztna_risk_factors     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    policy_id             text        NOT NULL DEFAULT 'ZTNA-POL-001',
    decision              public.audit_decision NOT NULL DEFAULT 'ALLOW',

    mfa_verified          boolean     NOT NULL DEFAULT false,
    mfa_verified_at       timestamptz,
    step_up_required      boolean     NOT NULL DEFAULT false,

    -- Revoked bila mendeteksi anomali pada sesi yang sama.
    revoked_at            timestamptz,
    revoked_reason        text,

    source_ip             inet,
    source_ip_truncated   inet,
    created_at            timestamptz NOT NULL DEFAULT now(),
    last_seen_at          timestamptz NOT NULL DEFAULT now(),
    expires_at            timestamptz NOT NULL,

    CONSTRAINT ztna_sessions_device_ck CHECK (octet_length(device_fingerprint_hash) = 32),
    CONSTRAINT ztna_sessions_trust_ck CHECK (device_trust_score BETWEEN 0 AND 100),
    CONSTRAINT ztna_sessions_risk_ck CHECK (ztna_risk_score BETWEEN 0 AND 100),
    CONSTRAINT ztna_sessions_mfa_ck CHECK (mfa_verified = false OR mfa_verified_at IS NOT NULL),
    CONSTRAINT ztna_sessions_expiry_ck CHECK (expires_at > created_at),
    CONSTRAINT ztna_sessions_revoked_ck CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

COMMENT ON TABLE public.ztna_sessions IS
    'Sesi terautentikasi yang terikat pada konteks perangkat. Dipakai middleware untuk keputusan ZTNA lanjutan.';

CREATE INDEX idx_ztna_sessions_user ON public.ztna_sessions (user_id, created_at DESC);
CREATE INDEX idx_ztna_sessions_device ON public.ztna_sessions (device_fingerprint_hash, created_at DESC);
CREATE INDEX idx_ztna_sessions_active ON public.ztna_sessions (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_ztna_sessions_risk ON public.ztna_sessions (ztna_risk_score DESC);

-- ---------------------------------------------------------------------------
-- 2. Refresh token (rotasi + deteksi reuse)
-- ---------------------------------------------------------------------------
CREATE TABLE public.refresh_tokens
(
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    session_id        uuid        REFERENCES public.ztna_sessions (id) ON DELETE SET NULL,

    -- Hanya hash. Token mentah hanya ada di sisi klien.
    token_hash        bytea       NOT NULL,

    -- Refresh token rotation: seluruh keluarga token berbagi family_id.
    -- Reuse token lama => kompromi, seluruh keluarga dicabut.
    family_id         uuid        NOT NULL DEFAULT gen_random_uuid(),
    generation        integer     NOT NULL DEFAULT 1,
    replaced_by_id    uuid        REFERENCES public.refresh_tokens (id) ON DELETE SET NULL,

    scopes            text[]      NOT NULL DEFAULT ARRAY['aduan:read']::text[],

    issued_at         timestamptz NOT NULL DEFAULT now(),
    expires_at        timestamptz NOT NULL,
    used_at           timestamptz,
    revoked_at        timestamptz,
    revoked_reason    text,

    -- Konteks untuk deteksi anomali (pencurian token).
    bound_ip_truncated inet,
    bound_device_hash  bytea,
    user_agent_hash    bytea,

    CONSTRAINT refresh_tokens_hash_ck CHECK (octet_length(token_hash) = 32),
    CONSTRAINT refresh_tokens_hash_uk UNIQUE (token_hash),
    CONSTRAINT refresh_tokens_generation_ck CHECK (generation >= 1),
    CONSTRAINT refresh_tokens_expiry_ck CHECK (expires_at > issued_at),
    CONSTRAINT refresh_tokens_revoked_ck CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

COMMENT ON TABLE public.refresh_tokens IS
    'Refresh token dengan rotasi. Disimpan hanya SHA-256 hash; token yang sudah dipakai akan dicabut.';

CREATE UNIQUE INDEX uk_refresh_tokens_hash ON public.refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_user ON public.refresh_tokens (user_id, issued_at DESC);
CREATE INDEX idx_refresh_tokens_family ON public.refresh_tokens (family_id, generation DESC);
CREATE INDEX idx_refresh_tokens_active ON public.refresh_tokens (expires_at) WHERE revoked_at IS NULL AND used_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Tantangan MFA TOTP (login tahap kedua)
--    Sensitive: nilai TOTP tidak disimpan, cukup hash untuk lookup terbatas.
-- ---------------------------------------------------------------------------
CREATE TABLE public.mfa_challenges
(
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    session_id        uuid        REFERENCES public.ztna_sessions (id) ON DELETE CASCADE,

    -- Hash dari kode ephemeral yang dikirim ke klien (bukan TOTP seed).
    challenge_hash    bytea       NOT NULL,

    ztna_risk_score   smallint    NOT NULL DEFAULT 0,
    risk_factors      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    source_ip         inet,
    source_ip_truncated inet,
    device_fingerprint_hash bytea,

    attempts          smallint    NOT NULL DEFAULT 0,
    max_attempts      smallint    NOT NULL DEFAULT 5,
    consumed_at       timestamptz,
    invalidated_at    timestamptz,
    invalidated_reason text,

    created_at        timestamptz NOT NULL DEFAULT now(),
    expires_at        timestamptz NOT NULL,

    CONSTRAINT mfa_challenges_hash_ck CHECK (octet_length(challenge_hash) = 32),
    CONSTRAINT mfa_challenges_hash_uk UNIQUE (challenge_hash),
    CONSTRAINT mfa_challenges_attempts_ck CHECK (attempts >= 0 AND attempts <= max_attempts),
    CONSTRAINT mfa_challenges_risk_ck CHECK (ztna_risk_score BETWEEN 0 AND 100),
    CONSTRAINT mfa_challenges_expiry_ck CHECK (expires_at > created_at),
    CONSTRAINT mfa_challenges_consumed_ck CHECK (attempts < max_attempts OR consumed_at IS NOT NULL OR invalidated_at IS NOT NULL)
);

COMMENT ON TABLE public.mfa_challenges IS
    'Tantangan MFA tahap kedua. TTL pendek (default 5 menit) dan dibatasi percobaan untuk menahan brute-force TOTP.';

CREATE UNIQUE INDEX uk_mfa_challenges_hash ON public.mfa_challenges (challenge_hash);
CREATE INDEX idx_mfa_challenges_user ON public.mfa_challenges (user_id, created_at DESC);
CREATE INDEX idx_mfa_challenges_expiry ON public.mfa_challenges (expires_at) WHERE consumed_at IS NULL;
CREATE INDEX idx_mfa_challenges_device ON public.mfa_challenges (device_fingerprint_hash, created_at DESC)
    WHERE device_fingerprint_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Pembatas laju anti-abuse (anti-spam tiket palsu)
--    Dihitung di Edge Middleware, disimpan agar dapat diaudit.
-- ---------------------------------------------------------------------------
CREATE TABLE public.aduan_rate_limits
(
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_hash      bytea       NOT NULL, -- SHA-256(pseudonym_id)
    window_start      timestamptz NOT NULL,
    window_end        timestamptz NOT NULL,
    request_count     integer     NOT NULL DEFAULT 1,
    blocked_until     timestamptz,

    CONSTRAINT rate_limits_subject_ck CHECK (octet_length(subject_hash) = 32),
    CONSTRAINT rate_limits_count_ck CHECK (request_count >= 1),
    CONSTRAINT rate_limits_window_ck CHECK (window_end > window_start)
);

CREATE INDEX idx_rate_limits_subject ON public.aduan_rate_limits (subject_hash, window_start DESC);
CREATE INDEX idx_rate_limits_blocked ON public.aduan_rate_limits (blocked_until) WHERE blocked_until IS NOT NULL;
