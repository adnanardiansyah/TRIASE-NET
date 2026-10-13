-- Runtime ticket workflow. Existing migrations are immutable.

CREATE FUNCTION public.fn_app_resolve_actor(p_email text, p_role public.app_role)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT id FROM public.users
  WHERE email_normalized = lower(btrim(p_email)) AND role = p_role
    AND status = 'ACTIVE' AND (locked_until IS NULL OR locked_until <= now());
$$;
REVOKE ALL ON FUNCTION public.fn_app_resolve_actor(text, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_app_resolve_actor(text, public.app_role) TO triase_app;

-- Owners must be able to decrypt their own HIGH tickets, including the outer layer.
DROP POLICY layers_select_scoped ON public.aduan_crypto_layers;
CREATE POLICY layers_select_scoped ON public.aduan_crypto_layers
FOR SELECT TO triase_app USING (
  EXISTS (SELECT 1 FROM public.aduan a WHERE a.id = aduan_crypto_layers.aduan_id)
);

DROP POLICY status_history_read_staff ON public.aduan_status_history;
CREATE POLICY status_history_read_scoped ON public.aduan_status_history
FOR SELECT TO triase_app USING (
  EXISTS (SELECT 1 FROM public.aduan a WHERE a.id = aduan_status_history.aduan_id)
);
DROP POLICY status_history_insert_staff ON public.aduan_status_history;
CREATE POLICY status_history_insert_scoped ON public.aduan_status_history
FOR INSERT TO triase_app WITH CHECK (
  changed_by = public.fn_ztna_actor_id()
  AND changed_by_role = public.fn_ztna_actor_role()
  AND changed_by_pseudonym_id IS NOT DISTINCT FROM public.fn_ztna_pseudonym()
  AND EXISTS (SELECT 1 FROM public.aduan a WHERE a.id = aduan_status_history.aduan_id)
);
REVOKE UPDATE, DELETE, TRUNCATE ON public.aduan_status_history FROM triase_app;

CREATE TABLE public.aduan_replies (
  id uuid PRIMARY KEY,
  aduan_id uuid NOT NULL REFERENCES public.aduan(id),
  author_role public.app_role NOT NULL,
  author_pseudonym_id text,
  payload jsonb NOT NULL,
  kek_version integer NOT NULL REFERENCES public.kek_versions(version),
  ztna_audit_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT replies_payload_ck CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ? 'primary'
    AND payload->>'algorithm' IN ('AES_256_GCM', 'CHACHA20_POLY1305', 'HYBRID_DOUBLE')
  ),
  CONSTRAINT replies_author_ck CHECK (
    (author_role = 'MAHASISWA' AND author_pseudonym_id ~ '^[0-9a-f]{64}$')
    OR (author_role IN ('SATGAS', 'ADMIN') AND author_pseudonym_id IS NULL)
  )
);
CREATE INDEX idx_replies_ticket ON public.aduan_replies(aduan_id, created_at, id);
ALTER TABLE public.aduan_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aduan_replies FROM PUBLIC;
GRANT SELECT, INSERT ON public.aduan_replies TO triase_app;
CREATE POLICY replies_read_scoped ON public.aduan_replies
FOR SELECT TO triase_app USING (
  EXISTS (SELECT 1 FROM public.aduan a WHERE a.id = aduan_replies.aduan_id)
);
CREATE POLICY replies_insert_scoped ON public.aduan_replies
FOR INSERT TO triase_app WITH CHECK (
  author_role = public.fn_ztna_actor_role()
  AND author_pseudonym_id IS NOT DISTINCT FROM public.fn_ztna_pseudonym()
  AND EXISTS (
    SELECT 1 FROM public.aduan a WHERE a.id = aduan_replies.aduan_id
      AND a.status NOT IN ('SELESAI', 'DITUTUP', 'DITOLAK')
  )
);
CREATE TRIGGER trg_replies_no_mutation BEFORE UPDATE OR DELETE ON public.aduan_replies
FOR EACH ROW EXECUTE FUNCTION public.fn_reject_mutation();
CREATE TRIGGER trg_replies_no_truncate BEFORE TRUNCATE ON public.aduan_replies
FOR EACH STATEMENT EXECUTE FUNCTION public.fn_reject_mutation();

-- Bind new history/reply rows to a real audit entry from the same actor and resource.
CREATE FUNCTION public.fn_guard_workflow_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_action text;
BEGIN
  IF TG_TABLE_NAME = 'aduan_replies' THEN
    v_action := 'ADUAN_REPLY';
    PERFORM 1 FROM public.aduan WHERE id = NEW.aduan_id
      AND status NOT IN ('SELESAI', 'DITUTUP', 'DITOLAK') FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conversation is closed' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.from_status IS NULL THEN v_action := 'ADUAN_SUBMIT';
  ELSE v_action := 'ADUAN_STATUS_CHANGE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ztna_audit_logs l
    WHERE l.id = NEW.ztna_audit_id AND l.resource_id = NEW.aduan_id::text
      AND l.action::text = v_action AND l.decision = 'ALLOW'
      AND l.actor_user_id = public.fn_ztna_actor_id()
      AND l.actor_role = public.fn_ztna_actor_role()
  ) THEN
    RAISE EXCEPTION 'Workflow requires a matching audit entry' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_guard_workflow_audit() FROM PUBLIC;
CREATE TRIGGER trg_replies_audit BEFORE INSERT ON public.aduan_replies
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_workflow_audit();
CREATE TRIGGER trg_history_audit BEFORE INSERT ON public.aduan_status_history
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_workflow_audit();

-- Closed states cannot be skipped or silently reopened by a stale dashboard.
CREATE FUNCTION public.fn_guard_aduan_status_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'DITERIMA' AND NEW.status IN ('DALAM_PENANGANAN', 'DITOLAK')) OR
    (OLD.status = 'DALAM_PENANGANAN' AND NEW.status IN ('MENUNGGU_TINDAK_LANJUT', 'SELESAI', 'DITOLAK')) OR
    (OLD.status = 'MENUNGGU_TINDAK_LANJUT' AND NEW.status IN ('DALAM_PENANGANAN', 'SELESAI')) OR
    (OLD.status = 'SELESAI' AND NEW.status IN ('DITUTUP', 'DALAM_PENANGANAN'))
  ) THEN RAISE EXCEPTION 'Invalid status transition' USING ERRCODE = '23514'; END IF;
  NEW.closed_at := CASE WHEN NEW.status IN ('SELESAI', 'DITUTUP', 'DITOLAK') THEN COALESCE(OLD.closed_at, now()) ELSE NULL END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_guard_aduan_status_transition() FROM PUBLIC;
CREATE TRIGGER trg_aduan_status_transition BEFORE UPDATE OF status ON public.aduan
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_aduan_status_transition();
