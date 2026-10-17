-- Authentication material is isolated from reporter metadata. No legacy account is enrolled.
CREATE TABLE public.account_credentials (
 user_id uuid PRIMARY KEY REFERENCES public.users(id), password_hash text NOT NULL CHECK(password_hash LIKE '$argon2id$%'),
 email_verified_at timestamptz, totp_sealed text, last_totp_counter bigint NOT NULL DEFAULT -1,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.account_email_tokens (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64), user_id uuid NOT NULL REFERENCES public.users(id),
 purpose text NOT NULL CHECK(purpose IN ('verify','invite')), expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE public.account_login_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
 ip_hash text NOT NULL, device_hash text NOT NULL, version integer NOT NULL,
 pending_totp text, attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
REVOKE ALL ON public.account_credentials,public.account_email_tokens,public.account_login_challenges FROM PUBLIC,triase_app;
ALTER TABLE public.account_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_email_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_login_challenges ENABLE ROW LEVEL SECURITY;

-- Only the trusted application backend can call this narrow pre-session interface.
CREATE FUNCTION public.fn_account_auth(p_action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u public.users; c public.account_credentials; ch public.account_login_challenges; t public.account_email_tokens; uid uuid; counter_value bigint;
BEGIN
 IF p_action IN ('register','resend') THEN
  IF p_action='register' THEN
   IF length(p->>'email')>254 OR p->>'email' !~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' OR p->>'hash' NOT LIKE '$argon2id$%' THEN RAISE EXCEPTION 'Invalid registration'; END IF;
   INSERT INTO public.users(role,status,identity_provider,institutional_email) VALUES('MAHASISWA','PENDING','LOCAL',lower(p->>'email')) ON CONFLICT(email_normalized) DO NOTHING RETURNING id INTO uid;
   IF uid IS NULL THEN RETURN 'false'::jsonb; END IF;
   INSERT INTO public.account_credentials(user_id,password_hash) VALUES(uid,p->>'hash');
  ELSE
   SELECT a.* INTO u FROM public.users a JOIN public.account_credentials b ON b.user_id=a.id WHERE a.email_normalized=lower(p->>'email') AND a.role='MAHASISWA' AND a.status='PENDING' AND b.email_verified_at IS NULL FOR UPDATE OF a;
   IF NOT FOUND THEN RETURN 'false'::jsonb; END IF; uid:=u.id;
  END IF;
  UPDATE public.account_email_tokens SET used_at=now() WHERE user_id=uid AND used_at IS NULL;
  INSERT INTO public.account_email_tokens(token_hash,user_id,purpose,expires_at) VALUES(p->>'token_hash',uid,'verify',now()+interval '30 minutes');
  RETURN 'true'::jsonb;
 ELSIF p_action='verify' THEN
  SELECT * INTO t FROM public.account_email_tokens WHERE token_hash=p->>'token_hash' AND used_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  SELECT * INTO u FROM public.users WHERE id=t.user_id AND status='PENDING' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  IF t.purpose='invite' AND (p->>'hash' IS NULL OR p->>'hash' NOT LIKE '$argon2id$%') THEN RETURN 'false'::jsonb; END IF;
  UPDATE public.account_credentials SET email_verified_at=now(),password_hash=CASE WHEN t.purpose='invite' THEN p->>'hash' ELSE password_hash END,version=version+1 WHERE user_id=u.id;
  UPDATE public.users SET status='ACTIVE' WHERE id=u.id;
  UPDATE public.account_email_tokens SET used_at=now() WHERE user_id=u.id AND used_at IS NULL;
  RETURN 'true'::jsonb;
 ELSIF p_action IN ('lookup','validate') THEN
  SELECT * INTO u FROM public.users WHERE email_normalized=lower(p->>'email') AND status='ACTIVE' AND (locked_until IS NULL OR locked_until<=now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=u.id AND email_verified_at IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_action='validate' THEN
   IF c.version<>(p->>'version')::integer OR u.role::text<>p->>'role' THEN RETURN NULL; END IF;
   RETURN to_jsonb(u.id);
  END IF;
  RETURN jsonb_build_object('id',u.id,'email',u.email_normalized,'role',u.role,'name',u.display_name,'hash',c.password_hash,'sealed',c.totp_sealed,'version',c.version,'counter',c.last_totp_counter);
 ELSIF p_action='student_login' THEN
  SELECT * INTO u FROM public.users WHERE id=(p->>'id')::uuid AND role='MAHASISWA' AND status='ACTIVE' FOR UPDATE;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=u.id AND version=(p->>'version')::integer AND email_verified_at IS NOT NULL;
  IF c.user_id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',u.id,'email',u.email_normalized,'role',u.role,'name',u.display_name,'version',c.version);
 ELSIF p_action='challenge' THEN
  DELETE FROM public.account_login_challenges WHERE expires_at<now();
  SELECT * INTO c FROM public.account_credentials WHERE user_id=(p->>'id')::uuid AND version=(p->>'version')::integer AND email_verified_at IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.account_login_challenges(user_id,ip_hash,device_hash,version,pending_totp) VALUES(c.user_id,p->>'ip_hash',p->>'device_hash',c.version,CASE WHEN c.totp_sealed IS NULL THEN p->>'pending' ELSE NULL END) RETURNING id INTO uid;
  RETURN to_jsonb(uid);
 ELSIF p_action='challenge_read' THEN
  SELECT * INTO ch FROM public.account_login_challenges WHERE id=(p->>'id')::uuid AND expires_at>now() AND attempts<5 AND ip_hash=p->>'ip_hash' AND device_hash=p->>'device_hash' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.account_login_challenges SET attempts=attempts+1 WHERE id=ch.id;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=ch.user_id AND version=ch.version;
  SELECT * INTO u FROM public.users WHERE id=ch.user_id AND status='ACTIVE';
  IF c.user_id IS NULL OR u.id IS NULL OR u.role='MAHASISWA' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',u.id,'email',u.email_normalized,'role',u.role,'name',u.display_name,'sealed',COALESCE(c.totp_sealed,ch.pending_totp),'version',c.version,'counter',c.last_totp_counter);
 ELSIF p_action='mfa_finish' THEN
  SELECT * INTO ch FROM public.account_login_challenges WHERE id=(p->>'id')::uuid AND expires_at>now() AND attempts<=5 AND ip_hash=p->>'ip_hash' AND device_hash=p->>'device_hash' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=ch.user_id AND version=ch.version FOR UPDATE;
  SELECT * INTO u FROM public.users WHERE id=ch.user_id AND status='ACTIVE';
  counter_value:=(p->>'counter')::bigint;
  IF c.user_id IS NULL OR u.id IS NULL OR u.role='MAHASISWA' OR counter_value<=c.last_totp_counter OR abs(counter_value-floor(extract(epoch FROM now())/30))>1 THEN RETURN NULL; END IF;
  UPDATE public.account_credentials SET totp_sealed=COALESCE(totp_sealed,ch.pending_totp),last_totp_counter=counter_value WHERE user_id=c.user_id;
  UPDATE public.users SET mfa_enrolled=true,mfa_enrolled_at=COALESCE(mfa_enrolled_at,now()),mfa_last_verified=now() WHERE id=u.id;
  DELETE FROM public.account_login_challenges WHERE id=ch.id;
  RETURN jsonb_build_object('id',u.id,'email',u.email_normalized,'role',u.role,'name',u.display_name,'version',c.version);
 ELSIF p_action='step_up' THEN
  SELECT * INTO c FROM public.account_credentials WHERE user_id=(p->>'id')::uuid AND version=(p->>'version')::integer FOR UPDATE;
  counter_value:=(p->>'counter')::bigint;
  IF NOT FOUND OR c.totp_sealed IS NULL OR counter_value<=c.last_totp_counter OR abs(counter_value-floor(extract(epoch FROM now())/30))>1 THEN RETURN 'false'::jsonb; END IF;
  UPDATE public.account_credentials SET last_totp_counter=counter_value WHERE user_id=c.user_id;
  RETURN 'true'::jsonb;
 END IF;
 RAISE EXCEPTION 'Unknown authentication operation';
END; $$;
REVOKE ALL ON FUNCTION public.fn_account_auth(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_account_auth(text,jsonb) TO triase_app;
