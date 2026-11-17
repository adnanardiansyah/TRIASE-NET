-- Hapus tabel warisan dari 0012_auth_supporting yang tidak lagi dipakai.
--
-- Sesi kini berupa JWT stateless (src/lib/auth/jwt.ts), step-up/MFA memakai
-- account_login_challenges (0039/0043), dan pembatasan laju memakai
-- auth_rate_limits (0042). Tidak ada kode aplikasi yang membaca/menulis:
--   ztna_sessions, refresh_tokens, mfa_challenges, aduan_rate_limits
--
-- Urutan penting: refresh_tokens dan mfa_challenges memiliki FK ke
-- ztna_sessions. Kebijakan RLS, indeks, constraint dan grant ikut terhapus
-- bersama tabelnya. Sengaja tanpa CASCADE agar dependensi tak terduga
-- membatalkan migrasi alih-alih ikut terhapus diam-diam.

DROP TABLE IF EXISTS public.refresh_tokens;
DROP TABLE IF EXISTS public.mfa_challenges;
DROP TABLE IF EXISTS public.ztna_sessions;
DROP TABLE IF EXISTS public.aduan_rate_limits;
