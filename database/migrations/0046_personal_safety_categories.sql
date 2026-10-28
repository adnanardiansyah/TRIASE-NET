-- Catalogue expansion only. Existing tickets, ciphertext and mandates are unchanged.
-- Do not use these values in DML until this transaction has committed.
ALTER TYPE public.aduan_category ADD VALUE IF NOT EXISTS 'PELECEHAN_SEKSUAL' BEFORE 'LAINNYA';
ALTER TYPE public.aduan_category ADD VALUE IF NOT EXISTS 'PELECEHAN_NON_SEKSUAL' BEFORE 'LAINNYA';
ALTER TYPE public.aduan_category ADD VALUE IF NOT EXISTS 'PERUNDUNGAN' BEFORE 'LAINNYA';
ALTER TYPE public.aduan_category ADD VALUE IF NOT EXISTS 'KEKERASAN_FISIK' BEFORE 'LAINNYA';
ALTER TYPE public.aduan_category ADD VALUE IF NOT EXISTS 'KEKERASAN_PSIKOLOGIS' BEFORE 'LAINNYA';
ALTER TYPE public.aduan_category ADD VALUE IF NOT EXISTS 'DISKRIMINASI' BEFORE 'LAINNYA';
ALTER TYPE public.aduan_category ADD VALUE IF NOT EXISTS 'ANCAMAN_INTIMIDASI' BEFORE 'LAINNYA';
