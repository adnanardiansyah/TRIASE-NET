-- Read receipts contain event keys only; events stay in their existing RLS tables.
CREATE TABLE public.notification_reads (
  user_id uuid NOT NULL REFERENCES public.users(id),
  notification_key text NOT NULL CHECK (length(notification_key) BETWEEN 1 AND 160),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_key)
);
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_reads FROM PUBLIC;
GRANT SELECT, INSERT ON public.notification_reads TO triase_app;
CREATE POLICY notification_reads_select_own ON public.notification_reads
  FOR SELECT TO triase_app USING (user_id = public.fn_ztna_actor_id());
CREATE POLICY notification_reads_insert_own ON public.notification_reads
  FOR INSERT TO triase_app WITH CHECK (user_id = public.fn_ztna_actor_id());
