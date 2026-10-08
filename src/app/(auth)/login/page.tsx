'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Fingerprint,
  Globe,
  Loader2,
  LockKeyhole,
  Network,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { Reveal } from '@/components/reveal';

import { getRoleHomePath } from '@/lib/auth/guard';
import type { SessionRole } from '@/lib/auth/jwt';
import {
  UNKNOWN_TRANSPORT,
  assessLoginContext,
  collectDeviceSignals,
  parseTransportContext,
  type ContextAssessment,
  type SignalStatus,
  type TransportContext,
} from '@/lib/ztna/device-context';

/**
 * Akun demo.
 *
 * Kredensial ini milik demo dan sudah tercantum juga di
 * `src/app/api/auth/route.ts`. Selector di bawah tidak boleh tetap ada kalau
 * endpoint auth nanti diganti ke basis data sungguhan: daftar akun yang bisa
 * ditebak dari kode sumber adalah lubang yang memang sengaja dibuka, bukan
 * fitur.
 */
const DEMO_ACCOUNTS = [
  { label: 'Satgas', email: 'satgas@poltek.test', password: 'admin123' },
  { label: 'Mahasiswa', email: 'mahasiswa@poltek.test', password: 'mahasiswa123' },
  { label: 'Admin', email: 'admin@poltek.test', password: 'admin123' },
] as const;

const TOTP_LENGTH = 6;
const TOTP_PERIOD_SECONDS = 30;

type LoginStep = 'CREDENTIALS' | 'TOTP';

type LoginResponse = {
  ok?: boolean;
  mfaRequired?: boolean;
  challengeId?: string;
  message?: string;
  redirectTo?: string;
  user?: { role?: SessionRole };
};

const STATUS_TONE: Readonly<Record<SignalStatus, { chip: string; dot: string }>> = {
  PASS: { chip: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200', dot: 'bg-cyan-300' },
  WARN: { chip: 'border-amber-400/40 bg-amber-400/10 text-amber-200', dot: 'bg-amber-300' },
  FAIL: { chip: 'border-rose-400/40 bg-rose-400/10 text-rose-200', dot: 'bg-rose-300' },
};

const RISK_TONE = {
  LOW: {
    chip: 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200',
    label: 'Risiko rendah',
    bar: 'from-cyan-400 via-teal-400 to-emerald-400',
    glow: 'shadow-[0_0_120px_-40px_rgba(34,211,238,0.85)]',
  },
  MEDIUM: {
    chip: 'border-amber-400/50 bg-amber-400/10 text-amber-200',
    label: 'Risiko sedang',
    bar: 'from-amber-400 via-orange-400 to-rose-400',
    glow: 'shadow-[0_0_120px_-40px_rgba(251,191,36,0.85)]',
  },
  HIGH: {
    chip: 'border-rose-400/50 bg-rose-400/10 text-rose-200',
    label: 'Risiko tinggi',
    bar: 'from-rose-500 via-rose-400 to-red-500',
    glow: 'shadow-[0_0_120px_-40px_rgba(244,63,94,0.9)]',
  },
} as const;

const RISK_ICON = {
  LOW: ShieldCheck,
  MEDIUM: ShieldAlert,
  HIGH: ShieldAlert,
} as const satisfies Record<ContextAssessment['riskBand'], LucideIcon>;

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-700/70 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400/70 focus:shadow-[0_0_60px_-35px_rgba(34,211,238,0.9)]';

/**
 * Middleware menulis tujuan asal ke query `redirect`, jadi login perlu
 * menghormatinya. Nilai dari query string adalah input tak tepercaya: hanya
 * path lokal yang diterima, dan `//evil.test` ditolak karena browser
 * memperlakukannya sebagai URL absolut.
 */
function safeRedirectTarget(fallback: string): string {
  const requested = new URLSearchParams(window.location.search).get('redirect');

  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) {
    return fallback;
  }

  return requested;
}

/**
 * Membaca body `/api/auth` tanpa melempar salah.
 *
 * Server bisa menjawab 500 dengan body kosong atau HTML, misalnya saat
 * `getTotpSecret` melempar karena seed TOTP belum disetel. Kalau `response.json()`
 * ikut berada di dalam blok catch jaringan, pengguna akan membaca "tidak dapat
 * menghubungi server" padahal server sudah menjawab dan yang salah
 * konfigurasinya.
 */
async function readLoginResponse(response: Response): Promise<LoginResponse> {
  try {
    return (await response.json()) as LoginResponse;
  } catch {
    return {
      ok: false,
      message: `Server menolak permintaan ini (HTTP ${response.status}). Coba lagi atau hubungi administrator.`,
    };
  }
}

/**
 * Kartu authenticate satu tahap.
 *
 * `delay` dipakai untuk menggeser pintu masuk panel kedua sedikit supaya
 * keduanya tidak muncul serentak. Nilainya dalam detik dan diteruskan apa
 * adanya ke `Reveal`.
 */
function Panel({
  icon: Icon,
  eyebrow,
  subtitle,
  delay = 0,
  children,
}: {
  icon: LucideIcon;
  eyebrow: string;
  subtitle: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <Reveal as="section" className="relative" delay={delay} distance={24} duration={0.55}>
      <div
        aria-hidden
        className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-cyan-500/20 via-teal-400/10 to-indigo-500/20 blur-3xl"
      />
      <div className="relative h-full overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-950/70 p-6 backdrop-blur-2xl sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/4 h-48 w-72 rounded-full bg-cyan-400/15 blur-[100px]"
        />

        <header className="relative flex items-start gap-4">
          <div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/40 bg-cyan-400/10 text-cyan-200">
            <div
              aria-hidden
              className="absolute inset-0 animate-ping rounded-2xl bg-cyan-400/10 [animation-duration:3s]"
            />
            <Icon className="relative size-5" aria-hidden />
          </div>
          <div>
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.42em] text-cyan-300/90">
              {eyebrow}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>
          </div>
        </header>

        <div className="relative mt-6">{children}</div>
      </div>
    </Reveal>
  );
}

export default function LoginPage() {
  const [step, setStep] = useState<LoginStep>('CREDENTIALS');
  const [mfaPassed, setMfaPassed] = useState(false);

  const [demoLabel, setDemoLabel] = useState<string>(DEMO_ACCOUNTS[0].label);
  const [email, setEmail] = useState<string>(DEMO_ACCOUNTS[0].email);
  const [password, setPassword] = useState<string>(DEMO_ACCOUNTS[0].password);
  const [showPassword, setShowPassword] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [digits, setDigits] = useState<string[]>(() => Array<string>(TOTP_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [transport, setTransport] = useState<TransportContext>(UNKNOWN_TRANSPORT);
  const [context, setContext] = useState<ContextAssessment | null>(null);
  const [contextError, setContextError] = useState('');
  const [assessing, setAssessing] = useState(true);

  const totpRefs = useRef<Array<HTMLInputElement | null>>([]);
  // `loadContext` dibuat sekali lewat `useCallback`, jadi status MFA terkini
  // dibaca dari ref supaya panel tidak memakai nilai yang sudah basi.
  const mfaPassedRef = useRef(mfaPassed);

  useEffect(() => {
    mfaPassedRef.current = mfaPassed;
  }, [mfaPassed]);

  const loadContext = useCallback(async () => {
    setAssessing(true);
    setContextError('');

    let nextTransport: TransportContext = UNKNOWN_TRANSPORT;
    let failed = false;

    try {
      const response = await fetch('/api/ztna/context', { cache: 'no-store' });
      const payload: unknown = await response.json();

      nextTransport = parseTransportContext(payload);
    } catch {
      // Panel konteks tidak boleh menjatuhkan halaman login. Kegagalan di sini
      // ditampilkan sebagai konteks yang belum terbaca, bukan sebagai error
      // yang memblokir autentikasi.
      failed = true;
      setContextError(
        'Konteks jaringan tidak dapat dibaca. Penilaian memakai nilai cadangan.',
      );
    }

    setTransport(nextTransport);
    setContext(
      assessLoginContext(collectDeviceSignals(), nextTransport, mfaPassedRef.current),
    );
    setAssessing(false);

    if (failed) {
      setTransport(UNKNOWN_TRANSPORT);
    }
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (step === 'TOTP') {
      totpRefs.current[0]?.focus();
    }
  }, [step]);

  /**
   * Kode TOTP hanya berlaku 30 detik. Hitungan ini memakai jam perangkat, jadi
   * labelnya menyebut perkiraan: perangkat yang jamnya salah bisa melihat
   * angka yang tidak sama dengan seed di server.
   */
  const [periodRemaining, setPeriodRemaining] = useState(TOTP_PERIOD_SECONDS);

  useEffect(() => {
    if (step !== 'TOTP') {
      return;
    }

    const tick = () => {
      const elapsed = Math.floor(Date.now() / 1000) % TOTP_PERIOD_SECONDS;
      setPeriodRemaining(TOTP_PERIOD_SECONDS - elapsed);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [step]);

  const otpCode = useMemo(() => digits.join(''), [digits]);

  function finishLogin(result: LoginResponse) {
    const fallback =
      result.redirectTo ?? (result.user?.role ? getRoleHomePath(result.user.role) : '/');

    window.location.href = safeRedirectTarget(fallback);
  }

  async function submitCredentials() {
    setLoading(true);
    setError('');
    setNotice('');

    let response: Response;

    try {
      response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
    } catch {
      // Tanpa try/catch di sini, kegagalan jaringan membuat state `loading`
      // menggantung dan tombol tidak pernah bisa ditekan lagi.
      setLoading(false);
      setError('Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.');
      return;
    }

    const result = await readLoginResponse(response);
    setLoading(false);

    if (!result.ok) {
      setError(result.message ?? 'Login gagal.');
      return;
    }

    if (!result.mfaRequired || !result.challengeId) {
      finishLogin(result);
      return;
    }

    setChallengeId(result.challengeId);
    setDigits(Array<string>(TOTP_LENGTH).fill(''));
    setStep('TOTP');
    setNotice(result.message ?? 'Masukkan kode 6 digit dari aplikasi autentikator.');
  }

  async function submitTotp() {
    if (!challengeId || otpCode.length !== TOTP_LENGTH) {
      setError('Kode TOTP harus lengkap 6 digit.');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');

    let response: Response;

    try {
      response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, otp: otpCode }),
      });
    } catch {
      setLoading(false);
      setError('Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.');
      return;
    }

    const result = await readLoginResponse(response);
    setLoading(false);

    if (!result.ok) {
      // Tantangan di server sudah dihapus setelah lima kali gagal, jadi kode
      // yang diketik ulang tidak akan pernah diterima. Mengosongkan form
      // mencegah pengguna mengetik kode yang sama berulang kali.
      setDigits(Array<string>(TOTP_LENGTH).fill(''));
      setError(result.message ?? 'Kode MFA tidak valid.');
      totpRefs.current[0]?.focus();
      return;
    }

    setMfaPassed(true);
    finishLogin(result);
  }

  function backToCredentials() {
    setStep('CREDENTIALS');
    setChallengeId('');
    setDigits(Array<string>(TOTP_LENGTH).fill(''));
    setError('');
    setNotice('');
  }

  function handleDigitChange(index: number, raw: string) {
    const digit = raw.replace(/\D/g, '').slice(-1);
    const next = [...digits];

    next[index] = digit;
    setDigits(next);
    setError('');

    if (digit && index < TOTP_LENGTH - 1) {
      totpRefs.current[index + 1]?.focus();
    }
  }

  function handleDigitKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const next = [...digits];

      if (digits[index]) {
        next[index] = '';
        setDigits(next);
        return;
      }

      if (index > 0) {
        next[index - 1] = '';
        setDigits(next);
        totpRefs.current[index - 1]?.focus();
      }

      return;
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      totpRefs.current[index - 1]?.focus();
    }

    if (event.key === 'ArrowRight' && index < TOTP_LENGTH - 1) {
      event.preventDefault();
      totpRefs.current[index + 1]?.focus();
    }
  }

  function handleDigitPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, TOTP_LENGTH);

    if (pasted.length === 0) {
      return;
    }

    const next = Array<string>(TOTP_LENGTH)
      .fill('')
      .map((_, index) => pasted[index] ?? '');

    setDigits(next);
    setError('');
    totpRefs.current[Math.min(pasted.length, TOTP_LENGTH - 1)]?.focus();
  }

  function handleCredentialsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitCredentials();
  }

  function handleTotpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitTotp();
  }

  const band = context?.riskBand ?? 'MEDIUM';
  const tone = RISK_TONE[band];
  const RiskIcon = RISK_ICON[band];

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Lapisan ambient glow. Murni dekoratif, disembunyikan dari pembaca layar. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[38rem] w-[70rem] -translate-x-1/2 rounded-full bg-cyan-500/20 blur-[170px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-56 right-0 h-[34rem] w-[46rem] rounded-full bg-indigo-500/20 blur-[170px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(1100px_600px_at_15%_0%,rgba(45,212,191,0.12),transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(148,210,255,0.35)_1px,transparent_1px),linear-gradient(90deg,rgba(148,210,255,0.35)_1px,transparent_1px)] [background-size:38px_38px]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-10 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative flex size-11 items-center justify-center rounded-2xl border border-cyan-400/40 bg-slate-950/80 text-cyan-200 backdrop-blur-xl">
              <ShieldCheck className="size-5" aria-hidden />
              <div
                aria-hidden
                className="absolute inset-0 animate-ping rounded-2xl bg-cyan-400/10 [animation-duration:3s]"
              />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.42em] text-cyan-200">
                TRIASE-Net
              </p>
              <p className="text-[0.65rem] uppercase tracking-[0.3em] text-slate-500">
                Zero Trust · Enkripsi Adaptif
              </p>
            </div>
          </div>

          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-950/60 px-4 py-2 text-xs uppercase tracking-[0.24em] text-slate-300 backdrop-blur-xl transition hover:border-cyan-400/60 hover:text-cyan-100"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Beranda
          </Link>
        </header>

        <div className="mt-10 grid flex-1 items-start gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
          <Panel
            icon={Network}
            eyebrow="Konteks Akses"
            subtitle="Penilaian perangkat dan IP terjadi di peramban, sebelum kredensial dikirim. Skor memakai ambang risiko yang sama dengan enkripsi adaptif."
          >
            <p aria-live="polite" className="sr-only">
              {assessing
                ? 'Menilai konteks perangkat.'
                : context
                  ? `Konteks dinilai. Risiko ${context.riskBand}, skor ${context.riskScore} dari 100.`
                  : ''}
            </p>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.65rem] uppercase tracking-[0.3em] text-slate-500">
                Skor risiko
              </span>
              <button
                type="button"
                onClick={() => void loadContext()}
                disabled={assessing}
                className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 px-3 py-1.5 text-[0.6rem] uppercase tracking-[0.24em] text-slate-400 transition hover:border-cyan-400/60 hover:text-cyan-100 disabled:opacity-60"
              >
                <RefreshCw className={`size-3 ${assessing ? 'animate-spin' : ''}`} aria-hidden />
                Periksa ulang
              </button>
            </div>

            <div
              className={`mt-3 rounded-2xl border border-slate-700/60 bg-slate-950/70 p-5 backdrop-blur-xl transition-shadow duration-700 ${tone.glow}`}
            >
              <div className="flex items-end justify-between gap-4">
                <div className="flex items-end gap-2">
                  <span className="text-5xl font-semibold leading-none tabular-nums text-white">
                    {assessing ? '--' : (context?.riskScore ?? 0)}
                  </span>
                  <span className="pb-1 text-sm text-slate-500">/ 100</span>
                </div>
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-[0.2em] ${tone.chip}`}
                >
                  <RiskIcon className="size-3.5" aria-hidden />
                  {assessing ? 'Menilai' : band}
                </span>
              </div>

              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={assessing ? undefined : (context?.riskScore ?? 0)}
                aria-label="Skor risiko konteks"
                className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-800"
              >
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${tone.bar} transition-[width] duration-700 ease-out`}
                  style={{ width: `${assessing ? 6 : (context?.riskScore ?? 0)}%` }}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[0.65rem] text-slate-500">
                <span>Kepercayaan perangkat {assessing ? '--' : `${context?.trustScore ?? 0}%`}</span>
                <span>{assessing ? 'Mengambil sinyal' : tone.label}</span>
              </div>

              {!assessing && context?.requiresStepUp ? (
                <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[0.68rem] leading-5 text-amber-200">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Konteks ini mewajibkan step-up authentication. Verifikasi TOTP tetap wajib
                  apa pun hasil penilaiannya.
                </p>
              ) : null}
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                {
                  icon: Globe,
                  label: 'Alamat IP',
                  value: transport.ip === 'unknown' ? 'Tidak tersedia' : transport.ip,
                  mono: true,
                },
                { icon: Fingerprint, label: 'Perangkat', value: context?.device ?? 'Mendeteksi...' },
                { icon: ShieldCheck, label: 'Zona waktu', value: context?.timezone ?? 'Mendeteksi...' },
                { icon: Network, label: 'Viewport', value: context?.viewport ?? 'Mendeteksi...' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-700/60 bg-slate-950/60 p-4 transition duration-500 hover:-translate-y-0.5 hover:border-cyan-400/50"
                >
                  <dt className="flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.28em] text-slate-500">
                    <item.icon className="size-3.5 text-cyan-300/80" aria-hidden />
                    {item.label}
                  </dt>
                  <dd
                    className={`mt-2 truncate text-sm text-slate-100 ${item.mono ? 'font-mono text-xs' : ''}`}
                  >
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 rounded-2xl border border-slate-700/60 bg-slate-950/60 p-4">
              <p className="text-[0.6rem] uppercase tracking-[0.28em] text-slate-500">
                Sinyal perangkat
              </p>
              {context === null ? (
                <p className="mt-3 text-xs text-slate-500">Sinyal belum tersedia.</p>
              ) : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {context.checks.map((check) => (
                    <li
                      key={check.id}
                      className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${STATUS_TONE[check.status].chip}`}
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${STATUS_TONE[check.status].dot}`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{check.label}</span>
                        <span className="block truncate text-[0.68rem] opacity-80">
                          {check.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {contextError ? (
              <p className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                {contextError}
              </p>
            ) : null}

            <p className="mt-4 text-xs leading-5 text-slate-500">
              Panel ini hanya memberi indikasi. Kebijakan akhir tetap diputuskan server pada setiap
              permintaan, dan klien tidak pernah menjadi pihak yang mengizinkan akses.
            </p>
          </Panel>

          <Panel
            icon={step === 'TOTP' ? Smartphone : LockKeyhole}
            delay={0.09}
            eyebrow={`Tahap ${step === 'CREDENTIALS' ? 1 : 2} dari 2`}
            subtitle={
              step === 'CREDENTIALS'
                ? 'Kata sandi diperiksa lebih dulu. Respons MFA tidak pernah memuat apa pun tentang identitas pemohon.'
                : 'Kode 6 digit dari aplikasi autentikator, diperiksa pada tantangan yang sudah dibuat server.'
            }
          >
            <div
              role="tablist"
              aria-label="Tahap autentikasi"
              className="relative grid grid-cols-2 gap-1 rounded-full border border-slate-700/60 bg-slate-950/70 p-1"
            >
              <div
                aria-hidden
                className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-gradient-to-r from-cyan-400/25 to-teal-400/15 transition-transform duration-700 ease-out ${
                  step === 'TOTP' ? 'translate-x-[calc(100%+0.5rem)]' : 'translate-x-0'
                }`}
              />
              <button
                type="button"
                role="tab"
                aria-selected={step === 'CREDENTIALS'}
                onClick={backToCredentials}
                className={`relative z-10 rounded-full px-3 py-2 text-[0.62rem] uppercase tracking-[0.24em] transition ${
                  step === 'CREDENTIALS' ? 'text-cyan-100' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Kredensial utama
              </button>
              <div
                role="tab"
                aria-selected={step === 'TOTP'}
                aria-disabled="true"
                title="Tahap ini hanya terbuka setelah kata sandi terverifikasi."
                className={`relative z-10 rounded-full px-3 py-2 text-center text-[0.62rem] uppercase tracking-[0.24em] ${
                  step === 'TOTP' ? 'text-cyan-100' : 'text-slate-600'
                }`}
              >
                Verifikasi TOTP
              </div>
            </div>

            {step === 'CREDENTIALS' ? (
              <form key="credentials" onSubmit={handleCredentialsSubmit} className="mt-5 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="demo-account"
                    className="flex items-center gap-2 text-[0.65rem] font-medium uppercase tracking-[0.28em] text-slate-400"
                  >
                    <UserRound className="size-3.5 text-cyan-300/80" aria-hidden />
                    Akun demo
                  </label>
                  <select
                    id="demo-account"
                    value={demoLabel}
                    onChange={(event) => {
                      const label = event.target.value;
                      const account = DEMO_ACCOUNTS.find((item) => item.label === label);

                      setDemoLabel(label);

                      if (account) {
                        setEmail(account.email);
                        setPassword(account.password);
                      }
                    }}
                    className={INPUT_CLASS}
                  >
                    {DEMO_ACCOUNTS.map((account) => (
                      <option key={account.label} value={account.label}>
                        {account.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="email"
                    className="flex items-center gap-2 text-[0.65rem] font-medium uppercase tracking-[0.28em] text-slate-400"
                  >
                    <UserRound className="size-3.5 text-cyan-300/80" aria-hidden />
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    required
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="password"
                    className="flex items-center gap-2 text-[0.65rem] font-medium uppercase tracking-[0.28em] text-slate-400"
                  >
                    <LockKeyhole className="size-3.5 text-cyan-300/80" aria-hidden />
                    Kata sandi
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                      className={`${INPUT_CLASS} pr-24`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute inset-y-1 right-1 rounded-lg px-3 text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 transition hover:text-cyan-200"
                    >
                      {showPassword ? 'Sembunyi' : 'Lihat'}
                    </button>
                  </div>
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-xs text-rose-200"
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="group relative mt-1 inline-flex items-center justify-center gap-2 overflow-hidden rounded-full border border-cyan-400/60 bg-gradient-to-r from-cyan-400/25 via-teal-400/10 to-transparent px-5 py-3 text-xs uppercase tracking-[0.3em] text-cyan-100 transition hover:border-cyan-200/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-cyan-200/25 to-transparent transition-transform duration-1000 group-hover:translate-x-full"
                  />
                  <span className="relative z-10 inline-flex items-center gap-2">
                    {loading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        Memeriksa
                      </>
                    ) : (
                      <>
                        Lanjut ke TOTP
                        <ArrowRight
                          className="size-4 transition-transform duration-500 group-hover:translate-x-1"
                          aria-hidden
                        />
                      </>
                    )}
                  </span>
                </button>
              </form>
            ) : (
              <form key="totp" onSubmit={handleTotpSubmit} className="mt-5 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/60 bg-slate-950/70 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Smartphone className="size-4 shrink-0 text-cyan-300" aria-hidden />
                    <div>
                      <p className="text-xs font-medium text-slate-200">Perangkat autentikator</p>
                      <p className="text-[0.65rem] text-slate-500">
                        Perkiraan sisa masa berlaku {periodRemaining} detik
                      </p>
                    </div>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={TOTP_PERIOD_SECONDS}
                    aria-valuenow={periodRemaining}
                    aria-label="Sisa masa berlaku kode TOTP"
                    className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-800"
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-teal-400 transition-[width] duration-1000 ease-linear"
                      style={{ width: `${(periodRemaining / TOTP_PERIOD_SECONDS) * 100}%` }}
                    />
                  </div>
                </div>

                <fieldset>
                  <legend className="text-[0.65rem] uppercase tracking-[0.28em] text-slate-400">
                    Kode TOTP 6 digit
                  </legend>
                  <div className="mt-3 flex justify-between gap-2">
                    {digits.map((digit, index) => (
                      <input
                        key={index}
                        ref={(element) => {
                          totpRefs.current[index] = element;
                        }}
                        value={digit}
                        onChange={(event) => handleDigitChange(index, event.target.value)}
                        onKeyDown={(event) => handleDigitKeyDown(index, event)}
                        onPaste={handleDigitPaste}
                        inputMode="numeric"
                        autoComplete={index === 0 ? 'one-time-code' : 'off'}
                        maxLength={1}
                        aria-label={`Digit TOTP ke-${index + 1}`}
                        className="size-11 rounded-xl border border-slate-700/70 bg-slate-950/80 text-center text-lg font-semibold text-slate-100 outline-none transition focus:border-cyan-400/70 focus:shadow-[0_0_50px_-25px_rgba(34,211,238,0.9)] sm:size-12"
                      />
                    ))}
                  </div>
                </fieldset>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-xs text-rose-200"
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={loading || otpCode.length !== TOTP_LENGTH}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-400/60 bg-gradient-to-r from-cyan-400/25 via-teal-400/10 to-transparent px-5 py-3 text-xs uppercase tracking-[0.3em] text-cyan-100 transition hover:border-cyan-200/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Memverifikasi
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="size-4" aria-hidden />
                      Verifikasi MFA
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={backToCredentials}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-700/70 px-5 py-2.5 text-[0.65rem] uppercase tracking-[0.24em] text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Kembali ke kredensial
                </button>
              </form>
            )}

            {notice ? (
              <p className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                {notice}
              </p>
            ) : null}

            <ul className="mt-6 space-y-2 border-t border-slate-800 pt-4 text-[0.7rem] leading-5 text-slate-500">
              <li>Percobaan login dibatasi per alamat IP dan per identitas.</li>
              <li>Tantangan MFA berlaku lima menit dan dihapus setelah lima kali gagal.</li>
              <li>Peran dan beranda ditetapkan token sesi yang diverifikasi server.</li>
            </ul>
          </Panel>
        </div>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-5 text-[0.65rem] uppercase tracking-[0.24em] text-slate-600">
          <span>TRIASE-Net · Secure Complaint Channel</span>
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-cyan-400" />
            Konteks dinilai langsung di peramban
          </span>
        </footer>
      </div>
    </main>
  );
}
