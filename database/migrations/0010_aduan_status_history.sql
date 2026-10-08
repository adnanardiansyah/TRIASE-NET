-- ===========================================================================
-- TRIASE-Net :: 0010_aduan_status_history.sql
-- Riwayat perubahan status aduan (append-only).
--
-- Setiap perubahan status WAJIB dikaitkan dengan entri audit ZTNA sehingga
-- selalu dapat dipertanggungjawabkan siapa yang berubah status pada konteks
-- akses apa.
-- ===========================================================================

CREATE TABLE public.aduan_status_history
(
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aduan_id           uuid        NOT NULL
        REFERENCES public.aduan (id) ON DELETE CASCADE,

    from_status        public.aduan_status,
    to_status          public.aduan_status NOT NULL,
    reason_code        text        NOT NULL, -- kode tertutup, bukan bebas teks
    note               text,               -- catatan singkat non-PII

    changed_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
    changed_by_role    public.app_role,
    changed_by_pseudonym_id text,

    -- Relasi ke ztna_audit_logs. Soft reference (tabel audit dipartisi).
    ztna_audit_id      uuid        NOT NULL,
    trace_id           uuid        NOT NULL,

    changed_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.aduan_status_history IS
    'Jejak audit perubahan status aduan. Tabel append-only (trigger fn_reject_mutation).';
COMMENT ON COLUMN public.aduan_status_history.reason_code IS
    'Kode dari daftar tertutup (mis. RESOLVED_EXPLAINED). Hindari teks bebas agar tidak menjadi celah kebocoran PII.';
COMMENT ON COLUMN public.aduan_status_history.ztna_audit_id IS
    'ID entri ztna_audit_logs yang menjadi dasar perubahan status ini (diverifikasi oleh db:verify).';

CREATE INDEX idx_status_history_aduan
    ON public.aduan_status_history (aduan_id, changed_at DESC);
CREATE INDEX idx_status_history_actor
    ON public.aduan_status_history (changed_by, changed_at DESC);
CREATE INDEX idx_status_history_audit
    ON public.aduan_status_history (ztna_audit_id);

-- Jaga append-only.
CREATE TRIGGER trg_status_history_no_update
    BEFORE UPDATE OR DELETE
    ON public.aduan_status_history
    FOR EACH ROW
EXECUTE FUNCTION public.fn_reject_mutation();

CREATE TRIGGER trg_status_history_no_truncate
    BEFORE TRUNCATE
    ON public.aduan_status_history
FOR EACH STATEMENT
EXECUTE FUNCTION public.fn_reject_mutation();
