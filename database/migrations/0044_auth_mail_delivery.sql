CREATE FUNCTION public.fn_auth_mail(action_name text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF action_name='recipient' THEN
  SELECT jsonb_build_object('email',u.email_normalized) INTO result FROM public.users u WHERE u.id=(p->>'user_id')::uuid AND u.role='SATGAS' AND u.status='PENDING';
  RETURN result;
 ELSIF action_name='claim' THEN
  WITH jobs AS (SELECT id FROM public.auth_mail_outbox WHERE delivered_at IS NULL AND attempts<5 AND expires_at>now() AND available_at<=now() AND (leased_until IS NULL OR leased_until<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 2),
  claimed AS (UPDATE public.auth_mail_outbox o SET attempts=attempts+1,lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes' FROM jobs WHERE o.id=jobs.id RETURNING o.id,o.sealed_payload,o.lease_id)
  SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO result FROM claimed;
  RETURN result;
 ELSIF action_name IN ('complete','fail') THEN
  UPDATE public.auth_mail_outbox SET delivered_at=CASE WHEN action_name='complete' THEN now() ELSE NULL END,
   available_at=now()+least(600,power(2,attempts)::integer*15)*interval '1 second',leased_until=NULL,lease_id=NULL
   WHERE id=(p->>'id')::uuid AND lease_id=(p->>'lease_id')::uuid AND leased_until>now();
  RETURN to_jsonb(FOUND);
 ELSIF action_name='cleanup' THEN
  DELETE FROM public.auth_rate_limits WHERE key_hash IN (SELECT key_hash FROM public.auth_rate_limits WHERE reset_at<now()-interval '1 day' LIMIT 1000 FOR UPDATE SKIP LOCKED);
  DELETE FROM public.account_password_tokens WHERE token_hash IN (SELECT token_hash FROM public.account_password_tokens WHERE expires_at<now()-interval '1 day' LIMIT 1000 FOR UPDATE SKIP LOCKED);
  DELETE FROM public.account_email_tokens WHERE token_hash IN (SELECT token_hash FROM public.account_email_tokens WHERE expires_at<now()-interval '1 day' LIMIT 1000 FOR UPDATE SKIP LOCKED);
  DELETE FROM public.account_login_challenges WHERE id IN (SELECT id FROM public.account_login_challenges WHERE expires_at<now() LIMIT 1000 FOR UPDATE SKIP LOCKED);
  DELETE FROM public.auth_mail_outbox WHERE id IN (SELECT id FROM public.auth_mail_outbox WHERE expires_at<now()-interval '1 day' OR delivered_at<now()-interval '1 day' LIMIT 1000 FOR UPDATE SKIP LOCKED);
  RETURN 'true'::jsonb;
 END IF;
 RAISE EXCEPTION 'Invalid mail operation';
END; $$;
REVOKE ALL ON FUNCTION public.fn_auth_mail(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_auth_mail(text,jsonb) TO triase_app;
CREATE FUNCTION public.fn_auth_security_history(uid uuid,ver integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users u JOIN public.account_credentials c ON c.user_id=u.id WHERE u.id=uid AND u.status='ACTIVE' AND c.version=ver AND c.email_verified_at IS NOT NULL) THEN RETURN NULL; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (SELECT action,created_at FROM public.auth_security_events WHERE user_id=uid ORDER BY created_at DESC,id LIMIT 30) x;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.fn_auth_security_history(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_auth_security_history(uuid,integer) TO triase_app;
