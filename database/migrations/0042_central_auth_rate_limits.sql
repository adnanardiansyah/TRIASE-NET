-- Shared fixed-window counters. Runtime has function access only.
CREATE TABLE public.auth_rate_limits (
 key_hash text PRIMARY KEY CHECK(length(key_hash)=64), hits integer NOT NULL,
 reset_at timestamptz NOT NULL
);
CREATE INDEX auth_rate_limits_expiry_idx ON public.auth_rate_limits(reset_at);
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_rate_limits FROM PUBLIC,triase_app;
CREATE FUNCTION public.fn_auth_rate_limit(k text, lim integer, window_ms integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.auth_rate_limits; ts timestamptz:=clock_timestamp();
BEGIN
 IF k !~ '^[0-9a-f]{64}$' OR lim NOT BETWEEN 1 AND 10000 OR window_ms NOT BETWEEN 1000 AND 86400000 THEN RAISE EXCEPTION 'Invalid rate policy'; END IF;
 INSERT INTO public.auth_rate_limits(key_hash,hits,reset_at) VALUES(k,1,ts+window_ms*interval '1 millisecond')
 ON CONFLICT(key_hash) DO UPDATE SET
 hits=CASE WHEN auth_rate_limits.reset_at<=ts THEN 1 ELSE least(auth_rate_limits.hits+1,1000000) END,
 reset_at=CASE WHEN auth_rate_limits.reset_at<=ts THEN EXCLUDED.reset_at ELSE auth_rate_limits.reset_at END
 RETURNING * INTO b;
 -- Bounded opportunistic cleanup; scheduled cleanup also runs in the mail worker.
 DELETE FROM public.auth_rate_limits WHERE key_hash IN (SELECT key_hash FROM public.auth_rate_limits WHERE reset_at<ts-interval '1 day' ORDER BY reset_at LIMIT 100 FOR UPDATE SKIP LOCKED);
 RETURN jsonb_build_object('allowed',b.hits<=lim,'remaining',greatest(0,lim-b.hits),'retryAfterSeconds',greatest(1,ceil(extract(epoch FROM b.reset_at-ts))));
END; $$;
REVOKE ALL ON FUNCTION public.fn_auth_rate_limit(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_auth_rate_limit(text,integer,integer) TO triase_app;
