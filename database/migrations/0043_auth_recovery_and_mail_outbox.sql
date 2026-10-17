-- Additive migration. Existing encryption keys and credential rows are preserved.
CREATE TABLE public.account_password_tokens (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'), user_id uuid NOT NULL REFERENCES public.users(id),
 version integer NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE INDEX account_password_tokens_expiry_idx ON public.account_password_tokens(expires_at);
CREATE TABLE public.account_recovery_codes (
 user_id uuid NOT NULL REFERENCES public.users(id), code_hash text NOT NULL CHECK(code_hash ~ '^[0-9a-f]{64}$'),
 used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,code_hash)
);
ALTER TABLE public.account_login_challenges ADD COLUMN recovery_enrollment boolean NOT NULL DEFAULT false;
CREATE INDEX account_login_challenges_expiry_idx ON public.account_login_challenges(expires_at);
CREATE INDEX account_login_challenges_user_idx ON public.account_login_challenges(user_id);
CREATE TABLE public.auth_security_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
 action text NOT NULL CHECK(action IN ('PASSWORD_RESET','MFA_ENROLLED','MFA_REENROLLED','MFA_RECOVERY_USED','MFA_RECOVERY_ROTATED','LOGOUT_ALL')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_security_events_user_time_idx ON public.auth_security_events(user_id,created_at DESC);
CREATE TRIGGER auth_security_events_immutable BEFORE UPDATE OR DELETE ON public.auth_security_events FOR EACH ROW EXECUTE FUNCTION public.fn_account_events_immutable();
CREATE TABLE public.auth_mail_outbox (
 id uuid PRIMARY KEY, sealed_payload text NOT NULL, expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid, leased_until timestamptz, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_mail_outbox_pending_idx ON public.auth_mail_outbox(available_at) WHERE delivered_at IS NULL;
ALTER TABLE public.account_password_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_mail_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_password_tokens,public.account_recovery_codes,public.auth_security_events,public.auth_mail_outbox FROM PUBLIC,triase_app;
CREATE FUNCTION public.fn_auth_replace_recovery(uid uuid,hashes jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF jsonb_typeof(hashes) IS DISTINCT FROM 'array' OR jsonb_array_length(hashes)<>10 THEN RAISE EXCEPTION 'Invalid recovery material'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(hashes) x WHERE x !~ '^[0-9a-f]{64}$') OR (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(hashes) x)<>10 THEN RAISE EXCEPTION 'Invalid recovery material'; END IF;
 DELETE FROM public.account_recovery_codes WHERE user_id=uid;
 INSERT INTO public.account_recovery_codes(user_id,code_hash) SELECT uid,x FROM jsonb_array_elements_text(hashes) x;
END; $$;
REVOKE ALL ON FUNCTION public.fn_auth_replace_recovery(uuid,jsonb) FROM PUBLIC,triase_app;
CREATE OR REPLACE FUNCTION public.fn_account_auth(p_action text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u public.users; c public.account_credentials; ch public.account_login_challenges; t public.account_email_tokens; uid uuid; counter_value bigint; result jsonb; rh text; replacing boolean;
BEGIN
 IF p_action='session_revoke' THEN
  SELECT * INTO u FROM public.users WHERE id=(p->>'id')::uuid AND role::text=p->>'role' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  UPDATE public.account_credentials SET version=version+1 WHERE user_id=u.id AND version=(p->>'version')::integer;
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  DELETE FROM public.account_login_challenges WHERE user_id=u.id;
  INSERT INTO public.auth_security_events(user_id,action) VALUES(u.id,'LOGOUT_ALL');
  RETURN 'true'::jsonb;
 ELSIF p_action='reset_request' THEN
  SELECT a.* INTO u FROM public.users a JOIN public.account_credentials b ON b.user_id=a.id WHERE a.email_normalized=lower(p->>'email') AND a.status='ACTIVE' AND b.email_verified_at IS NOT NULL FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=u.id FOR UPDATE;
  UPDATE public.account_password_tokens SET used_at=now() WHERE user_id=u.id AND used_at IS NULL;
  INSERT INTO public.account_password_tokens(token_hash,user_id,version,expires_at) VALUES(p->>'token_hash',u.id,c.version,now()+interval '30 minutes');
  INSERT INTO public.auth_mail_outbox(id,sealed_payload,expires_at) VALUES((p->>'mail_id')::uuid,p->>'mail_sealed',now()+interval '30 minutes');
  RETURN 'true'::jsonb;
 ELSIF p_action='reset_finish' THEN
  SELECT user_id INTO uid FROM public.account_password_tokens WHERE token_hash=p->>'token_hash';
  IF uid IS NULL THEN RETURN 'false'::jsonb; END IF;
  SELECT * INTO u FROM public.users WHERE id=uid AND status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=uid AND email_verified_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR p->>'hash' IS NULL OR p->>'hash' NOT LIKE '$argon2id$%' THEN RETURN 'false'::jsonb; END IF;
  UPDATE public.account_password_tokens SET used_at=now() WHERE token_hash=p->>'token_hash' AND user_id=uid AND version=c.version AND used_at IS NULL AND expires_at>now();
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  UPDATE public.account_credentials SET password_hash=p->>'hash',version=version+1 WHERE user_id=uid;
  -- Keep legacy staff credential consistent; student metadata remains password-free.
  UPDATE public.users SET password_hash=CASE WHEN role='MAHASISWA' THEN NULL ELSE p->>'hash' END WHERE id=uid;
  UPDATE public.account_password_tokens SET used_at=now() WHERE user_id=uid AND used_at IS NULL;
  DELETE FROM public.account_login_challenges WHERE user_id=uid;
  INSERT INTO public.auth_security_events(user_id,action) VALUES(uid,'PASSWORD_RESET');
  RETURN 'true'::jsonb;
 ELSIF p_action='recovery_begin' THEN
  SELECT user_id INTO uid FROM public.account_login_challenges WHERE id=(p->>'id')::uuid;
  IF uid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO u FROM public.users WHERE id=uid AND status='ACTIVE' AND role IN ('ADMIN','SATGAS') AND (locked_until IS NULL OR locked_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=uid AND email_verified_at IS NOT NULL FOR UPDATE;
  SELECT * INTO ch FROM public.account_login_challenges WHERE id=(p->>'id')::uuid AND expires_at>now() AND attempts BETWEEN 1 AND 5 AND ip_hash=p->>'ip_hash' AND device_hash=p->>'device_hash' AND NOT recovery_enrollment FOR UPDATE;
  IF c.user_id IS NULL OR c.totp_sealed IS NULL OR ch.id IS NULL OR c.version<>ch.version OR p->>'pending' IS NULL THEN RETURN NULL; END IF;
  UPDATE public.account_recovery_codes SET used_at=now() WHERE user_id=uid AND code_hash=p->>'code_hash' AND used_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.account_credentials SET version=version+1 WHERE user_id=uid RETURNING * INTO c;
  DELETE FROM public.account_login_challenges WHERE user_id=uid;
  INSERT INTO public.account_login_challenges(user_id,ip_hash,device_hash,version,pending_totp,recovery_enrollment) VALUES(uid,p->>'ip_hash',p->>'device_hash',c.version,p->>'pending',true) RETURNING id INTO uid;
  INSERT INTO public.auth_security_events(user_id,action) VALUES(u.id,'MFA_RECOVERY_USED');
  RETURN to_jsonb(uid);
 ELSIF p_action='recovery_rotate' THEN
  SELECT * INTO u FROM public.users WHERE id=(p->>'id')::uuid AND status='ACTIVE' AND role IN ('ADMIN','SATGAS') AND (locked_until IS NULL OR locked_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=u.id AND version=(p->>'version')::integer AND email_verified_at IS NOT NULL FOR UPDATE;
  counter_value:=(p->>'counter')::bigint;
  IF c.user_id IS NULL OR c.totp_sealed IS NULL OR counter_value IS NULL OR counter_value<=c.last_totp_counter OR abs(counter_value-floor(extract(epoch FROM clock_timestamp())/30))>1 THEN RETURN 'false'::jsonb; END IF;
  PERFORM public.fn_auth_replace_recovery(u.id,p->'recovery_hashes');
  UPDATE public.account_credentials SET last_totp_counter=counter_value WHERE user_id=u.id;
  INSERT INTO public.auth_security_events(user_id,action) VALUES(u.id,'MFA_RECOVERY_ROTATED');
  RETURN 'true'::jsonb;
 ELSIF p_action IN ('register','resend') THEN
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
  INSERT INTO public.auth_mail_outbox(id,sealed_payload,expires_at) VALUES((p->>'mail_id')::uuid,p->>'mail_sealed',now()+interval '30 minutes');
  RETURN 'true'::jsonb;
 ELSIF p_action='verify' THEN
  SELECT * INTO t FROM public.account_email_tokens WHERE token_hash=p->>'token_hash' AND used_at IS NULL AND expires_at>now();
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  SELECT * INTO u FROM public.users WHERE id=t.user_id AND status='PENDING' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  SELECT * INTO t FROM public.account_email_tokens WHERE token_hash=p->>'token_hash' AND used_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  IF t.purpose='invite' AND (p->>'hash' IS NULL OR p->>'hash' NOT LIKE '$argon2id$%') THEN RETURN 'false'::jsonb; END IF;
  UPDATE public.account_credentials SET email_verified_at=now(),password_hash=CASE WHEN t.purpose='invite' THEN p->>'hash' ELSE password_hash END,version=version+1 WHERE user_id=u.id;
  UPDATE public.users SET status='ACTIVE',password_hash=CASE WHEN t.purpose='invite' THEN p->>'hash' ELSE password_hash END WHERE id=u.id;
  UPDATE public.account_email_tokens SET used_at=now() WHERE user_id=u.id AND used_at IS NULL;
  RETURN 'true'::jsonb;
 ELSIF p_action IN ('lookup','validate') THEN
  SELECT * INTO u FROM public.users WHERE email_normalized=lower(p->>'email') AND status='ACTIVE' AND (locked_until IS NULL OR locked_until<=now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=u.id AND email_verified_at IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_action='validate' THEN
   IF (p->>'version')::integer IS DISTINCT FROM c.version OR p->>'role' IS DISTINCT FROM u.role::text THEN RETURN NULL; END IF;
   RETURN to_jsonb(u.id);
  END IF;
  RETURN jsonb_build_object('id',u.id,'email',u.email_normalized,'role',u.role,'name',u.display_name,'hash',c.password_hash,'sealed',c.totp_sealed,'version',c.version,'counter',c.last_totp_counter);
 ELSIF p_action='student_login' THEN
  SELECT * INTO u FROM public.users WHERE id=(p->>'id')::uuid AND role='MAHASISWA' AND status='ACTIVE' AND (locked_until IS NULL OR locked_until<=now()) FOR UPDATE;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=u.id AND version=(p->>'version')::integer AND email_verified_at IS NOT NULL;
  IF c.user_id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',u.id,'email',u.email_normalized,'role',u.role,'name',u.display_name,'version',c.version);
 ELSIF p_action='challenge' THEN
  SELECT * INTO u FROM public.users WHERE id=(p->>'id')::uuid AND role IN ('ADMIN','SATGAS') AND status='ACTIVE' AND (locked_until IS NULL OR locked_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  DELETE FROM public.account_login_challenges WHERE id IN (SELECT id FROM public.account_login_challenges WHERE expires_at<now() ORDER BY expires_at LIMIT 100);
  SELECT * INTO c FROM public.account_credentials WHERE user_id=(p->>'id')::uuid AND version=(p->>'version')::integer AND email_verified_at IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.account_login_challenges(user_id,ip_hash,device_hash,version,pending_totp) VALUES(c.user_id,p->>'ip_hash',p->>'device_hash',c.version,CASE WHEN c.totp_sealed IS NULL THEN p->>'pending' ELSE NULL END) RETURNING id INTO uid;
  RETURN to_jsonb(uid);
 ELSIF p_action='challenge_read' THEN
  SELECT * INTO ch FROM public.account_login_challenges WHERE id=(p->>'id')::uuid AND expires_at>now() AND attempts<5 AND ip_hash=p->>'ip_hash' AND device_hash=p->>'device_hash' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.account_login_challenges SET attempts=attempts+1 WHERE id=ch.id;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=ch.user_id AND version=ch.version;
  SELECT * INTO u FROM public.users WHERE id=ch.user_id AND status='ACTIVE' AND (locked_until IS NULL OR locked_until<=now());
  IF c.user_id IS NULL OR u.id IS NULL OR u.role='MAHASISWA' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',u.id,'email',u.email_normalized,'role',u.role,'name',u.display_name,'sealed',CASE WHEN ch.recovery_enrollment THEN ch.pending_totp ELSE COALESCE(c.totp_sealed,ch.pending_totp) END,'version',c.version,'counter',c.last_totp_counter);
 ELSIF p_action='mfa_finish' THEN
  SELECT user_id INTO uid FROM public.account_login_challenges WHERE id=(p->>'id')::uuid;
  IF uid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO u FROM public.users WHERE id=uid AND status='ACTIVE' AND role IN ('ADMIN','SATGAS') AND (locked_until IS NULL OR locked_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=uid AND email_verified_at IS NOT NULL FOR UPDATE;
  SELECT * INTO ch FROM public.account_login_challenges WHERE id=(p->>'id')::uuid AND expires_at>now() AND attempts BETWEEN 1 AND 5 AND ip_hash=p->>'ip_hash' AND device_hash=p->>'device_hash' FOR UPDATE;
  counter_value:=(p->>'counter')::bigint;
  IF c.user_id IS NULL OR ch.id IS NULL OR c.version<>ch.version OR counter_value IS NULL OR abs(counter_value-floor(extract(epoch FROM clock_timestamp())/30))>1 THEN RETURN NULL; END IF;
  replacing:=c.totp_sealed IS NULL OR ch.recovery_enrollment;
  IF NOT replacing AND (counter_value<=c.last_totp_counter OR (ch.pending_totp IS NOT NULL AND ch.pending_totp IS DISTINCT FROM c.totp_sealed)) THEN RETURN NULL; END IF;
  IF replacing THEN
   IF ch.pending_totp IS NULL THEN RETURN NULL; END IF;
   PERFORM public.fn_auth_replace_recovery(u.id,p->'recovery_hashes');
   UPDATE public.account_credentials SET totp_sealed=ch.pending_totp,last_totp_counter=counter_value,version=version+1 WHERE user_id=u.id RETURNING * INTO c;
   INSERT INTO public.auth_security_events(user_id,action) VALUES(u.id,CASE WHEN ch.recovery_enrollment THEN 'MFA_REENROLLED' ELSE 'MFA_ENROLLED' END);
   DELETE FROM public.account_login_challenges WHERE user_id=u.id;
  ELSE
   UPDATE public.account_credentials SET last_totp_counter=counter_value WHERE user_id=u.id;
   DELETE FROM public.account_login_challenges WHERE id=ch.id;
  END IF;
  UPDATE public.users SET mfa_enrolled=true,mfa_enrolled_at=COALESCE(mfa_enrolled_at,now()),mfa_last_verified=now() WHERE id=u.id;
  RETURN jsonb_build_object('id',u.id,'email',u.email_normalized,'role',u.role,'name',u.display_name,'version',c.version,'recoveryCreated',replacing);
 ELSIF p_action='step_up' THEN
  SELECT * INTO u FROM public.users WHERE id=(p->>'id')::uuid AND status='ACTIVE' AND role IN ('ADMIN','SATGAS') AND (locked_until IS NULL OR locked_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN RETURN 'false'::jsonb; END IF;
  SELECT * INTO c FROM public.account_credentials WHERE user_id=(p->>'id')::uuid AND version=(p->>'version')::integer FOR UPDATE;
  counter_value:=(p->>'counter')::bigint;
  IF NOT FOUND OR c.totp_sealed IS NULL OR counter_value IS NULL OR counter_value<=c.last_totp_counter OR abs(counter_value-floor(extract(epoch FROM now())/30))>1 THEN RETURN 'false'::jsonb; END IF;
  UPDATE public.account_credentials SET last_totp_counter=counter_value WHERE user_id=c.user_id;
  RETURN 'true'::jsonb;
 END IF;
 RAISE EXCEPTION 'Unknown authentication operation';
END; $$;
REVOKE ALL ON FUNCTION public.fn_account_auth(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_account_auth(text,jsonb) TO triase_app;
