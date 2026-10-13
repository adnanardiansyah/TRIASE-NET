-- Enum values must be committed before being used by subsequent transactions.
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'ADUAN_REPLY';
