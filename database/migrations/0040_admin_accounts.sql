CREATE TABLE public.admin_account_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.users(id), target_id uuid NOT NULL REFERENCES public.users(id),
 action text NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500), before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.admin_account_events FROM PUBLIC,triase_app;
ALTER TABLE public.admin_account_events ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.fn_account_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Account audit is append-only'; END; $$;
REVOKE ALL ON FUNCTION public.fn_account_events_immutable() FROM PUBLIC;
CREATE TRIGGER account_events_immutable BEFORE UPDATE OR DELETE ON public.admin_account_events FOR EACH ROW EXECUTE FUNCTION public.fn_account_events_immutable();
CREATE FUNCTION public.fn_admin_accounts(action_name text,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor_id uuid:=public.fn_ztna_actor_id(); actor_profile public.satgas_profiles; target public.users; profile public.satgas_profiles; previous jsonb; result jsonb; uid uuid; total bigint; pg integer:=greatest(1,least(100000,coalesce((p->>'page')::integer,1))); cats public.aduan_category[];
BEGIN
 PERFORM 1 FROM public.users WHERE id=actor_id AND role='ADMIN' AND status='ACTIVE' FOR UPDATE;
 IF NOT FOUND OR public.fn_ztna_actor_role()<>'ADMIN' THEN RAISE insufficient_privilege; END IF;
 SELECT * INTO actor_profile FROM public.satgas_profiles WHERE user_id=actor_id;
 IF NOT FOUND OR actor_profile.duty_status<>'ON_DUTY' OR actor_profile.expires_at<=now() THEN RAISE insufficient_privilege; END IF;
 IF action_name='list' THEN
  SELECT count(*) INTO total FROM public.users u WHERE (coalesce(p->>'q','')='' OR u.email_normalized ILIKE '%'||(p->>'q')||'%' OR u.display_name ILIKE '%'||(p->>'q')||'%') AND (coalesce(p->>'role','')='' OR u.role::text=p->>'role');
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
   SELECT u.id,u.email_normalized AS email,u.display_name AS name,u.role,u.status,u.row_version AS version,c.email_verified_at AS verified_at,c.user_id IS NOT NULL AS has_credentials,
   s.duty_status,s.authorized_categories AS categories,s.max_decrypt_risk_score AS max_risk,s.expires_at,s.row_version AS profile_version,s.unit_name
   FROM public.users u LEFT JOIN public.account_credentials c ON c.user_id=u.id LEFT JOIN public.satgas_profiles s ON s.user_id=u.id
   WHERE (coalesce(p->>'q','')='' OR u.email_normalized ILIKE '%'||(p->>'q')||'%' OR u.display_name ILIKE '%'||(p->>'q')||'%') AND (coalesce(p->>'role','')='' OR u.role::text=p->>'role') ORDER BY u.created_at DESC,u.id LIMIT 20 OFFSET (pg-1)*20
  ) x; RETURN jsonb_build_object('items',result,'total',total,'page',pg);
 ELSIF action_name='events' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (SELECT e.id,e.action,e.reason,e.before_data,e.after_data,e.created_at,u.email_normalized AS target_email,a.email_normalized AS actor_email FROM public.admin_account_events e JOIN public.users u ON u.id=e.target_id JOIN public.users a ON a.id=e.actor_id ORDER BY e.created_at DESC,e.id LIMIT 100) x;
  RETURN result;
 END IF;
 IF length(coalesce(p->>'reason','')) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 IF action_name='invite' THEN
  cats:=ARRAY(SELECT jsonb_array_elements_text(p->'categories'))::public.aduan_category[];
  IF cardinality(cats)<1 OR NOT cats <@ actor_profile.authorized_categories OR (p->>'max_risk')::integer NOT BETWEEN 0 AND actor_profile.max_decrypt_risk_score OR (p->>'expires_at')::timestamptz<=now() OR p->>'expires_at' IS NULL OR (actor_profile.expires_at IS NOT NULL AND (p->>'expires_at')::timestamptz>actor_profile.expires_at) THEN RAISE insufficient_privilege; END IF;
  INSERT INTO public.users(role,status,identity_provider,institutional_email,display_name,password_hash) VALUES('SATGAS','PENDING','LOCAL',p->>'email',p->>'name',p->>'hash') RETURNING id INTO uid;
  INSERT INTO public.account_credentials(user_id,password_hash) VALUES(uid,p->>'hash');
  INSERT INTO public.satgas_profiles(user_id,employee_id,unit_name,authorized_categories,max_decrypt_risk_score,duty_status,requires_step_up,expires_at,approved_by,approved_at) VALUES(uid,'STAFF-'||uid::text,p->>'unit_name',cats,(p->>'max_risk')::integer,'OFF_DUTY',true,(p->>'expires_at')::timestamptz,actor_id,now());
  INSERT INTO public.account_email_tokens(token_hash,user_id,purpose,expires_at) VALUES(p->>'token_hash',uid,'invite',now()+interval '30 minutes');
  INSERT INTO public.admin_account_events(actor_id,target_id,action,reason,after_data) VALUES(actor_id,uid,'INVITE_SATGAS',p->>'reason',jsonb_build_object('status','PENDING','duty_status','OFF_DUTY','categories',cats));
  RETURN to_jsonb(uid);
 END IF;
 SELECT * INTO target FROM public.users WHERE id=(p->>'id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
 IF target.id=actor_id OR target.role='ADMIN' THEN RAISE insufficient_privilege; END IF;
 IF action_name='status' THEN
  IF target.row_version<>(p->>'version')::integer THEN RETURN jsonb_build_object('error','STALE_VERSION'); END IF;
  IF p->>'status' NOT IN ('ACTIVE','SUSPENDED') THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
  IF p->>'status'='ACTIVE' AND NOT EXISTS(SELECT 1 FROM public.account_credentials WHERE user_id=target.id AND email_verified_at IS NOT NULL) THEN RETURN jsonb_build_object('error','VERIFY_REQUIRED'); END IF;
  previous:=jsonb_build_object('status',target.status);
  UPDATE public.users SET status=(p->>'status')::public.user_status WHERE id=target.id;
  UPDATE public.account_credentials SET version=version+1 WHERE user_id=target.id;
  result:=jsonb_build_object('status',p->>'status');
 ELSIF action_name='mandate' THEN
  IF target.role<>'SATGAS' THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO profile FROM public.satgas_profiles WHERE user_id=target.id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF profile.row_version<>(p->>'version')::integer THEN RETURN jsonb_build_object('error','STALE_VERSION'); END IF;
  cats:=ARRAY(SELECT jsonb_array_elements_text(p->'categories'))::public.aduan_category[];
  IF cardinality(cats)<1 OR NOT cats <@ actor_profile.authorized_categories OR (p->>'max_risk')::integer NOT BETWEEN 0 AND actor_profile.max_decrypt_risk_score OR p->>'expires_at' IS NULL OR (p->>'duty_status'='ON_DUTY' AND (p->>'expires_at')::timestamptz<=now()) OR (actor_profile.expires_at IS NOT NULL AND (p->>'expires_at')::timestamptz>actor_profile.expires_at) THEN RAISE insufficient_privilege; END IF;
  previous:=jsonb_build_object('duty_status',profile.duty_status,'categories',profile.authorized_categories,'max_risk',profile.max_decrypt_risk_score,'expires_at',profile.expires_at);
  UPDATE public.satgas_profiles SET duty_status=(p->>'duty_status')::public.duty_status,authorized_categories=cats,max_decrypt_risk_score=(p->>'max_risk')::integer,expires_at=(p->>'expires_at')::timestamptz WHERE user_id=target.id;
  result:=jsonb_build_object('duty_status',p->>'duty_status','categories',cats,'max_risk',(p->>'max_risk')::integer,'expires_at',p->>'expires_at');
 ELSE RAISE EXCEPTION 'Unknown admin operation'; END IF;
 INSERT INTO public.admin_account_events(actor_id,target_id,action,reason,before_data,after_data) VALUES(actor_id,target.id,upper(action_name),p->>'reason',previous,result);
 RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION public.fn_admin_accounts(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_admin_accounts(text,jsonb) TO triase_app;
