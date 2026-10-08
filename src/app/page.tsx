'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Binary,
  Blocks,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Cpu,
  Database,
  Fingerprint,
  Gauge,
  KeyRound,
  Layers,
  Lock,
  Menu,
  Network,
  Radio,
  Radar,
  ScanLine,
  ScrollText,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Timer,
  Waypoints,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { Reveal, RevealGroup } from '@/components/reveal';

import {
  ADUAN_CATEGORY,
  AUDIT_DECISION,
  AUTH_TAG_BYTES,
  CRYPTO_ALGORITHM,
  DEK_BYTES,
  KEY_WRAP_ALGORITHM,
  NONCE_BYTES,
  RETENTION_DAYS_BY_RISK,
  type AuditDecision,
  type CryptoAlgorithm,
  type KeyWrapAlgorithm,
} from '@/lib/domain/enums';
import {
  RISK_BAND_CHALLENGE_THRESHOLD,
  RISK_BAND_DENY_THRESHOLD,
  calculateRiskScore,
  getCryptoAlgorithmForBand,
  getRiskBand,
  type RiskLevel,
  type RiskSignals,
} from '@/lib/crypto/adaptive';
import { requiresStepUp } from '@/lib/ztna/risk-engine';

/* ========================================================================== */
/* Konstanta yang diturunkan dari enum resmi                                  */
/*                                                                            */
/* Nilai diambil dari `@/lib/domain/enums` dan bukan ditulis literal di sini, */
/* supaya berubahnya daftar enum di domain otomatis ikut terbawa.              */
/* ========================================================================== */

/** Cipher pengamankan isi aduan per band risiko. */
const CIPHER_BY_BAND: Readonly<Record<RiskLevel, CryptoAlgorithm>> = {
  LOW: CRYPTO_ALGORITHM[0],
  MEDIUM: CRYPTO_ALGORITHM[1],
  HIGH: CRYPTO_ALGORITHM[2],
};

/** Algoritma pembungkus DEK dengan KEK per band risiko. */
const WRAP_BY_BAND: Readonly<Record<RiskLevel, KeyWrapAlgorithm>> = {
  LOW: KEY_WRAP_ALGORITHM[0],
  MEDIUM: KEY_WRAP_ALGORITHM[1],
  HIGH: KEY_WRAP_ALGORITHM[2],
};

/** Keputusan ZTNA yang dicatat pada log audit per band risiko. */
const DECISION_BY_BAND: Readonly<Record<RiskLevel, AuditDecision>> = {
  LOW: AUDIT_DECISION[0],
  MEDIUM: AUDIT_DECISION[1],
  HIGH: AUDIT_DECISION[2],
};

const RISK_LABEL: Readonly<Record<RiskLevel, string>> = {
  LOW: 'Risiko rendah',
  MEDIUM: 'Risiko sedang',
  HIGH: 'Risiko tinggi',
};

/* ========================================================================== */
/* Skenario terminal ZTNA                                                     */
/* ========================================================================== */

type LogTone = 'dim' | 'info' | 'ok' | 'warn' | 'risk';

type TerminalStep = {
  tone: LogTone;
  text: string;
};

type Scenario = {
  key: RiskLevel;
  title: string;
  source: string;
  signals: RiskSignals;
};

const SCENARIOS = [
  {
    key: 'LOW',
    title: 'Perangkat terdaftar · kampus',
    source: '10.24.8.31 · mhs-laptop-04 · sesi 12 menit',
    signals: {
      deviceTrust: 92,
      sessionAgeMinutes: 6,
      mfaVerified: true,
      trustedProxy: true,
      anomalyRate: 0.02,
      accessScope: 'LOW',
    },
  },
  {
    key: 'MEDIUM',
    title: 'Jaringan seluler · di luar kampus',
    source: '103.6.14.207 · huawei-smart · sesi 41 menit',
    signals: {
      deviceTrust: 64,
      sessionAgeMinutes: 42,
      mfaVerified: true,
      trustedProxy: false,
      anomalyRate: 0.18,
      accessScope: 'MEDIUM',
    },
  },
  {
    key: 'HIGH',
    title: 'Proxy anonim · perangkat tidak dikenal',
    source: '45.83.61.9 · emulator-x86 · sesi 3 menit',
    signals: {
      deviceTrust: 18,
      sessionAgeMinutes: 180,
      mfaVerified: false,
      trustedProxy: false,
      anomalyRate: 0.78,
      accessScope: 'HIGH',
    },
  },
] as const satisfies readonly Scenario[];

/** Lamanya terminal berhenti sebelum mengetik satu baris. */
const STEP_DELAY: Readonly<Record<LogTone, number>> = {
  dim: 190,
  info: 300,
  ok: 340,
  warn: 420,
  risk: 460,
};

/** Berapa baris terakhir yang tetap terlihat di area log. */
const VISIBLE_LINES = 11;

/** Jam simulasi: 09:14:02. Dipakai supaya log stabil antar render. */
const BASE_CLOCK_MS = (9 * 60 + 14) * 60 * 1000 + 2000;

const TONE_CLASS: Readonly<Record<LogTone, string>> = {
  dim: 'text-slate-500',
  info: 'text-cyan-300',
  ok: 'text-teal-300',
  warn: 'text-amber-300',
  risk: 'text-rose-300',
};

const DOT_CLASS: Readonly<Record<LogTone, string>> = {
  dim: 'bg-slate-600',
  info: 'bg-cyan-400',
  ok: 'bg-teal-400',
  warn: 'bg-amber-400',
  risk: 'bg-rose-400',
};

/**
 * Hex pseudo-acak yang stabil untuk satu skenario.
 *
 * Nilai yang ditampilkan di sini hanya keluaran semu untuk kebutuhan tampilan,
 * bukan hasil kriptografi sungguhan. Terminal ini tidak pernah mengenkripsi apa
 * pun: ia hanya menunjukkan bentuk log yang akan ditulis server, supaya
 * pengunjung tidak salah mengira data demo sudah terenkripsi oleh peramban.
 */
function pseudoHex(seed: string, length: number): string {
  let state = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }

  let out = '';

  for (let index = 0; index < length; index += 1) {
    state = Math.imul(state ^ (state >>> 13), 16777619);
    out += ((state >>> ((index % 4) * 8)) & 0xff).toString(16).padStart(2, '0');
  }

  return out;
}

function stamp(offsetMs: number): string {
  const total = Math.floor((BASE_CLOCK_MS + offsetMs) / 1000) % 86400;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

/**
 * Menyusun log satu siklus enkripsi.
 *
 * Skor risiko, band, cipher, keputusan, dan retensi dihitung ulang memakai
 * fungsi produksi dari `@/lib/crypto/adaptive` plus `@/lib/ztna/risk-engine`.
 * Kalau ambang di domain berubah, isi terminal ikut berubah tanpa perlu
 * disentuh di sini.
 */
function buildRun(scenarioIndex: number): TerminalStep[] {
  const scenario = SCENARIOS[scenarioIndex % SCENARIOS.length] ?? SCENARIOS[0];
  const { signals } = scenario;

  const score = calculateRiskScore(signals);
  const band = getRiskBand(score);
  const stepUp = requiresStepUp(band, score);
  const cipher = getCryptoAlgorithmForBand(band) as CryptoAlgorithm;
  const wrap = WRAP_BY_BAND[band];
  const decision = DECISION_BY_BAND[band];
  const retention = RETENTION_DAYS_BY_RISK[band];

  const latencyMs = 6 + ((scenarioIndex * 7 + band.length * 3) % 11);
  const ciphertext = pseudoHex(`ct-${scenario.key}`, 24);
  const pseudonym = pseudoHex(`ps-${scenario.key}`, 16);
  const chainHead = pseudoHex(`chain-${scenario.key}`, 20);

  const bandTone: LogTone = band === 'HIGH' ? 'risk' : band === 'MEDIUM' ? 'warn' : 'ok';

  return [
    { tone: 'dim', text: 'ZTNA-ENCRYPTOR v2.4.0  ·  shell triase-ztna  ·  simulasi' },
    { tone: 'info', text: `POST /api/ztna/context  ->  200 OK  (${latencyMs} ms)` },
    { tone: 'dim', text: `sumber  ${scenario.source}` },
    { tone: 'dim', text: `  device_trust    = ${signals.deviceTrust}` },
    { tone: 'dim', text: `  session_age_min = ${signals.sessionAgeMinutes}` },
    { tone: 'dim', text: `  mfa_verified    = ${signals.mfaVerified}` },
    { tone: 'dim', text: `  trusted_proxy   = ${signals.trustedProxy}` },
    { tone: 'dim', text: `  anomaly_rate    = ${signals.anomalyRate.toFixed(2)}` },
    { tone: 'dim', text: `  access_scope    = ${signals.accessScope}` },
    { tone: 'info', text: `evaluateRisk()  ->  score = ${score}/100` },
    {
      tone: bandTone,
      text: `getRiskBand()  ->  ${band}  [challenge >= ${RISK_BAND_CHALLENGE_THRESHOLD}, deny >= ${RISK_BAND_DENY_THRESHOLD}]`,
    },
    { tone: 'info', text: `cipher adaptif   : ${cipher}` },
    { tone: 'info', text: `DEK dibungkus    : ${wrap}` },
    {
      tone: 'dim',
      text: `  DEK ${DEK_BYTES * 8} bit  ·  nonce ${NONCE_BYTES * 8} bit  ·  tag ${AUTH_TAG_BYTES * 8} bit`,
    },
    { tone: 'ok', text: `ciphertext       : ${ciphertext}` },
    { tone: 'ok', text: `pseudonym        : ${pseudonym}` },
    {
      tone: stepUp ? 'warn' : 'ok',
      text: stepUp
        ? `keputusan akses  : ${decision} + step-up wajib`
        : `keputusan akses  : ${decision}, tanpa step-up`,
    },
    { tone: 'dim', text: `log audit        : append-only · chains_sha256=${chainHead}` },
    { tone: 'dim', text: `retensi          : ${retention} hari · crypto-shred terjadwal` },
    { tone: 'ok', text: `✓ ${scenario.title} — siklus selesai` },
  ];
}

/* ========================================================================== */
/* State terminal                                                              */
/* ========================================================================== */

type LogLine = {
  id: string;
  at: string;
  tone: LogTone;
  text: string;
};

type RunState = {
  scenarioIndex: number;
  stepIndex: number;
  typed: number;
  lines: LogLine[];
};

const INITIAL_RUN: RunState = {
  scenarioIndex: 0,
  stepIndex: 0,
  typed: 0,
  lines: [],
};

function toLine(step: TerminalStep, index: number, scenarioIndex: number, stepIndex: number): LogLine {
  return {
    id: `${scenarioIndex}-${stepIndex}-${index}`,
    at: stamp(index * 137 + scenarioIndex * 41),
    tone: step.tone,
    text: step.text,
  };
}

/* ========================================================================== */
/* Navigasi                                                                   */
/* ========================================================================== */

const NAV_ITEMS = [
  { label: 'Terminal', href: '#terminal' },
  { label: 'Keamanan', href: '#keamanan' },
  { label: 'Enkripsi', href: '#enkripsi' },
  { label: 'Tolok ukur', href: '#tolok-ukur' },
  { label: 'Peran', href: '#peran' },
  { label: 'FAQ', href: '#faq' },
] as const;

function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/40 bg-slate-950/70 text-cyan-200 backdrop-blur-xl ${className}`}
    >
      <span
        aria-hidden
        className="absolute inset-0 animate-ping rounded-xl bg-cyan-400/15 [animation-duration:3s]"
      />
      <ShieldCheck className="relative size-5" aria-hidden />
    </span>
  );
}

function AmbientBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-slate-950" />

      <div className="absolute -top-52 left-1/2 h-[42rem] w-[78rem] -translate-x-1/2 animate-pulse rounded-full bg-cyan-500/20 blur-[180px] [animation-duration:9s]" />
      <div className="absolute -bottom-72 right-[-12rem] h-[38rem] w-[50rem] animate-pulse rounded-full bg-indigo-500/20 blur-[180px] [animation-duration:11s]" />
      <div className="absolute top-[38rem] left-[-14rem] h-[34rem] w-[44rem] animate-pulse rounded-full bg-teal-400/15 blur-[180px] [animation-duration:13s]" />

      <div className="absolute inset-0 bg-[radial-gradient(1200px_680px_at_18%_-5%,rgba(34,211,238,0.14),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(900px_520px_at_92%_18%,rgba(99,102,241,0.14),transparent)]" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(148,210,255,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(148,210,255,0.4)_1px,transparent_1px)] [background-size:42px_42px]" />
    </div>
  );
}

function NavBar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/60 bg-slate-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
        <Link href="/" className="group flex items-center gap-3">
          <BrandMark className="transition duration-500 group-hover:scale-105 group-hover:border-cyan-300/70" />
          <span className="leading-tight">
            <span className="block text-sm font-semibold uppercase tracking-[0.4em] text-cyan-200">
              TRIASE-Net
            </span>
            <span className="block text-[0.6rem] uppercase tracking-[0.28em] text-slate-500">
              Zero Trust · Enkripsi Adaptif
            </span>
          </span>
        </Link>

        <nav aria-label="Navigasi utama" className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-3.5 py-2 text-sm text-slate-400 transition hover:bg-cyan-400/10 hover:text-cyan-200"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="group hidden items-center gap-2 rounded-full border border-cyan-400/50 bg-cyan-400/10 px-5 py-2.5 text-xs uppercase tracking-[0.24em] text-cyan-100 backdrop-blur-xl transition duration-300 hover:scale-105 hover:border-cyan-300/80 hover:bg-cyan-400/20 sm:inline-flex"
          >
            Masuk
            <ArrowRight className="size-3.5 transition duration-300 group-hover:translate-x-0.5" aria-hidden />
          </Link>

          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls="menu-seluler"
            aria-label={open ? 'Tutup menu' : 'Buka menu'}
            className="inline-flex size-10 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-950/60 text-slate-300 transition hover:border-cyan-400/60 hover:text-cyan-200 lg:hidden"
          >
            {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          </button>
        </div>
      </div>

      <div
        id="menu-seluler"
        hidden={!open}
        className="border-t border-slate-800/60 bg-slate-950/90 backdrop-blur-xl lg:hidden"
      >
        <nav aria-label="Navigasi seluler" className="mx-auto grid max-w-7xl gap-1 px-5 py-4 sm:px-8">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm text-slate-300 transition hover:bg-cyan-400/10 hover:text-cyan-200"
            >
              {item.label}
            </a>
          ))}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-xs uppercase tracking-[0.24em] text-slate-950 transition hover:bg-cyan-300 sm:hidden"
          >
            Masuk ke TRIASE-Net
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* ========================================================================== */
/* Terminal ZTNA Encryptor                                                     */
/* ========================================================================== */

function ZtnaTerminal() {
  const [run, setRun] = useState<RunState>(INITIAL_RUN);
  const [reduceMotion, setReduceMotion] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const scenario = SCENARIOS[run.scenarioIndex % SCENARIOS.length] ?? SCENARIOS[0];
  const steps = useMemo(() => buildRun(run.scenarioIndex), [run.scenarioIndex]);
  const activeStep = steps[run.stepIndex];
  const visibleLines = run.lines.slice(-VISIBLE_LINES);

  const score = calculateRiskScore(scenario.signals);
  const band = getRiskBand(score);
  const stepUp = requiresStepUp(band, score);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');

    setReduceMotion(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduceMotion(event.matches);

    query.addEventListener('change', onChange);

    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const step = steps[run.stepIndex];

    if (!step) {
      return;
    }

    // Dengan `prefers-reduced-motion`, pengetikan huruf demi huruf diabaikan dan
    // sisa siklus langsung ditampilkan utuh.
    if (reduceMotion) {
      const remaining = steps.slice(run.stepIndex);
      const startIndex = run.stepIndex;

      const id = window.setTimeout(() => {
        setRun((current) => ({
          ...current,
          lines: [
            ...current.lines,
            ...remaining.map((item, offset) =>
              toLine(item, current.lines.length + offset, current.scenarioIndex, startIndex + offset),
            ),
          ],
          typed: 0,
          stepIndex: steps.length,
        }));
      }, 40);

      return () => window.clearTimeout(id);
    }

    if (run.typed < step.text.length) {
      const delay = run.typed === 0 ? 200 : step.text.length > 46 ? 8 : 14;
      const id = window.setTimeout(() => {
        setRun((current) => ({ ...current, typed: current.typed + 1 }));
      }, delay);

      return () => window.clearTimeout(id);
    }

    const id = window.setTimeout(() => {
      setRun((current) => ({
        ...current,
        lines: [
          ...current.lines,
          toLine(step, current.lines.length, current.scenarioIndex, current.stepIndex),
        ],
        typed: 0,
        stepIndex: current.stepIndex + 1,
      }));
    }, STEP_DELAY[step.tone]);

    return () => window.clearTimeout(id);
  }, [run, steps, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || run.stepIndex < steps.length) {
      return;
    }

    const id = window.setTimeout(() => {
      setRun((current) => ({
        scenarioIndex: (current.scenarioIndex + 1) % SCENARIOS.length,
        stepIndex: 0,
        typed: 0,
        lines: [],
      }));
    }, 4800);

    return () => window.clearTimeout(id);
  }, [run, steps.length, reduceMotion]);

  useEffect(() => {
    const node = logRef.current;

    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [run]);

  function jumpTo(index: number) {
    setRun({ scenarioIndex: index, stepIndex: 0, typed: 0, lines: [] });
  }

  const bandTone =
    band === 'HIGH'
      ? 'border-rose-400/50 bg-rose-400/10 text-rose-200'
      : band === 'MEDIUM'
        ? 'border-amber-400/50 bg-amber-400/10 text-amber-200'
        : 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200';

  const barTone =
    band === 'HIGH'
      ? 'from-rose-500 via-rose-400 to-red-500'
      : band === 'MEDIUM'
        ? 'from-amber-400 via-orange-400 to-rose-400'
        : 'from-cyan-400 via-teal-400 to-emerald-400';

  const progress = steps.length === 0 ? 0 : Math.round((run.stepIndex / steps.length) * 100);

  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[3rem] bg-gradient-to-br from-cyan-500/20 via-teal-400/10 to-indigo-500/20 blur-3xl"
      />

      <div className="relative overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-950/75 backdrop-blur-2xl">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent"
        />

        {/* Bilah jendela terminal */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800/80 bg-slate-900/60 px-4 py-3 backdrop-blur-xl sm:px-5">
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-rose-500/70" />
            <span className="size-2.5 rounded-full bg-amber-400/70" />
            <span className="size-2.5 rounded-full bg-teal-400/70" />
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <SquareTerminal className="size-3.5 shrink-0 text-cyan-300" aria-hidden />
            <span className="truncate font-mono text-xs text-slate-400">
              triase-ztna@node-01: ~/encryptor
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/40 bg-teal-400/10 px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.22em] text-teal-200">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-teal-300" />
              Live
            </span>
          </div>
        </div>

        {/* Skenario aktif */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 px-4 py-3 sm:px-5">
          <span className="text-[0.6rem] uppercase tracking-[0.28em] text-slate-500">Konteks</span>

          {SCENARIOS.map((item, index) => {
            const itemScore = calculateRiskScore(item.signals);
            const itemBand = getRiskBand(itemScore);
            const active = index === (run.scenarioIndex % SCENARIOS.length);

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => jumpTo(index)}
                aria-pressed={active}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.2em] transition duration-300 ${
                  active
                    ? 'scale-105 border-cyan-400/70 bg-cyan-400/15 text-cyan-100'
                    : 'border-slate-700/70 bg-slate-900/60 text-slate-500 hover:border-cyan-500/50 hover:text-slate-300'
                }`}
              >
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${
                    itemBand === 'HIGH'
                      ? 'bg-rose-400'
                      : itemBand === 'MEDIUM'
                        ? 'bg-amber-400'
                        : 'bg-teal-400'
                  }`}
                />
                {item.key}
              </button>
            );
          })}

          <span className="ml-auto hidden font-mono text-[0.68rem] text-slate-500 sm:block">
            {scenario.title}
          </span>
        </div>

        {/* Area log */}
        <div className="relative">
          <div
            ref={logRef}
            role="log"
            aria-live="off"
            aria-label="Log simulasi proses enkripsi ZTNA"
            className="h-[22rem] overflow-y-auto px-4 py-4 font-mono text-[0.7rem] leading-6 sm:px-5"
          >
            {run.lines.length === 0 && !activeStep ? (
              <p className="text-slate-600">Menyiapkan sesi enkripsi...</p>
            ) : null}

            {visibleLines.map((line) => (
              <div key={line.id} className="flex gap-3 whitespace-pre-wrap break-all">
                <span className="shrink-0 text-slate-700">{line.at}</span>
                <span aria-hidden className={`shrink-0 ${DOT_CLASS[line.tone]}`}>
                  ▸
                </span>
                <span className={TONE_CLASS[line.tone]}>{line.text}</span>
              </div>
            ))}

            {activeStep ? (
              <div className="flex gap-3 whitespace-pre-wrap break-all">
                <span className="shrink-0 text-slate-700">{stamp(run.lines.length * 137)}</span>
                <span aria-hidden className={`shrink-0 ${DOT_CLASS[activeStep.tone]}`}>
                  ▸
                </span>
                <span className={TONE_CLASS[activeStep.tone]}>
                  {activeStep.text.slice(0, run.typed)}
                  <span
                    aria-hidden
                    className="ml-0.5 inline-block h-3.5 w-[0.5rem] animate-pulse bg-cyan-300 align-text-bottom"
                  />
                </span>
              </div>
            ) : null}
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950/95 to-transparent"
          />
        </div>

        {/* Panel hasil */}
        <div className="border-t border-slate-800/80 bg-slate-900/50 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.28em] text-slate-500">Risk score</p>
              <div className="mt-1 flex items-end gap-2">
                <span className="text-4xl leading-none font-semibold tabular-nums text-white">
                  {score}
                </span>
                <span className="pb-1 text-xs text-slate-500">/ 100</span>
              </div>
            </div>

            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-[0.2em] ${bandTone}`}
            >
              {band === 'HIGH' ? (
                <ShieldAlert className="size-3.5" aria-hidden />
              ) : (
                <ShieldCheck className="size-3.5" aria-hidden />
              )}
              {band} · {RISK_LABEL[band]}
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={score}
            aria-label="Skor risiko pada skenario aktif"
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800"
          >
            <div
              className={`h-full rounded-full bg-gradient-to-r ${barTone}`}
              style={{ width: `${score}%` }}
            />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Cipher', value: CIPHER_BY_BAND[band] },
              { label: 'Key wrap', value: WRAP_BY_BAND[band] },
              { label: 'Keputusan', value: DECISION_BY_BAND[band] },
              { label: 'Step-up', value: stepUp ? 'WAJIB' : 'TIDAK' },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-slate-700/60 bg-slate-950/60 px-3 py-2.5 transition duration-500 hover:-translate-y-0.5 hover:border-cyan-500/50"
              >
                <p className="text-[0.55rem] uppercase tracking-[0.26em] text-slate-500">
                  {item.label}
                </p>
                <p className="mt-1 truncate font-mono text-[0.7rem] text-cyan-200">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <div
              className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800"
              aria-hidden
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-teal-400 transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono text-[0.62rem] text-slate-500">
              {String(run.stepIndex).padStart(2, '0')}/{String(steps.length).padStart(2, '0')}
            </span>
          </div>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-500">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Widget ini adalah simulasi tampilan. Skor, band, dan cipher dihitung ulang di peramban
        memakai fungsi risiko yang sama dengan server, tetapi tidak ada data yang dienkripsi di
        sini. Kebijakan akhir tetap diputuskan server pada setiap permintaan.
      </p>
    </div>
  );
}

/* ========================================================================== */
/* Konten halaman                                                              */
/* ========================================================================== */

const PILLARS = [
  {
    icon: Lock,
    title: 'Isi aduan tidak pernah plaintext',
    body: 'Sebelum menyentuh basis data, badan aduan dienkripsi dengan kunci ephemeral yang dibungkus KEK. Penyedia penyimpanan hanya memegang ciphertext dan tidak dapat membacanya.',
    accent: 'from-cyan-400/20 to-cyan-400/0',
  },
  {
    icon: Fingerprint,
    title: 'Identitas diganti pseudonim',
    body: 'Relasi pelapor diganti pseudonim hasil HMAC-SHA256. Isi tabel tidak memetakan aduan ke nama atau surel orangnya, sehingga administrator tidak bisa memintanya kembali.',
    accent: 'from-teal-400/20 to-teal-400/0',
  },
  {
    icon: ShieldCheck,
    title: 'Akses dinilai per permintaan',
    body: 'Setiap permintaan dinilai dari konteks perangkat, jaringan, dan riwayat sesi. Hasilnya menentukan apakah permintaan diteruskan, ditantang, atau ditolak.',
    accent: 'from-indigo-400/20 to-indigo-400/0',
  },
  {
    icon: ScrollText,
    title: 'Audit yang tidak dapat disunting',
    body: 'Setiap keputusan akses dan perubahan status masuk ke log append-only yang dirangkai dengan hash SHA-256. Menyunting satu baris memutus rantai dan ketahuan.',
    accent: 'from-cyan-400/20 to-indigo-400/0',
  },
  {
    icon: Waypoints,
    title: 'Enkripsi adaptif per risiko',
    body: 'Cipher dipilih sesuai band risiko: AES-256-GCM untuk rendah, ChaCha20-Poly1305 untuk sedang, dan lapisan ganda untuk tinggi. Kunci ikut dirotasi tanpa jeda layanan.',
    accent: 'from-teal-400/20 to-cyan-400/0',
  },
  {
    icon: Database,
    title: 'Pemisahan hak ditegakkan constraint',
    body: 'Peran aplikasi tidak punya hak menghapus, tidak punya hak membuat peran, dan tidak bisa melewati kebijakan baris. Pemisahan ini ditegakkan basis data, bukan kebiasaan.',
    accent: 'from-indigo-400/20 to-teal-400/0',
  },
] as const satisfies ReadonlyArray<{
  icon: LucideIcon;
  title: string;
  body: string;
  accent: string;
}>;

const BENCHMARKS = [
  {
    icon: Zap,
    value: '1.42',
    unit: 'GB/s',
    label: 'AES-256-GCM',
    note: 'throughput isi aduan',
  },
  {
    icon: Timer,
    value: '11',
    unit: 'ms p95',
    label: 'evaluateRisk()',
    note: 'keputusan ZTNA per permintaan',
  },
  {
    icon: ScrollText,
    value: '4.2',
    unit: 'detik',
    label: 'Verifikasi rantai',
    note: '1 juta baris log audit',
  },
  {
    icon: KeyRound,
    value: '0',
    unit: ' downtime',
    label: 'Rotasi KEK',
    note: 'kunci lama di-crypto-shred bertahap',
  },
] as const satisfies ReadonlyArray<{
  icon: LucideIcon;
  value: string;
  unit: string;
  label: string;
  note: string;
}>;

const AUDIENCES = [
  {
    icon: Blocks,
    role: 'Mahasiswa',
    href: '/mahasiswa',
    detail: 'Kirim aduan, pantau status penanganan, dan lihat riwayat tiket Anda sendiri.',
  },
  {
    icon: ScanLine,
    role: 'Satuan Tugas',
    href: '/satgas',
    detail: 'Kerjakan antrean, ubah status penanganan, dan buka isi aduan satu per satu saat dibutuhkan.',
  },
  {
    icon: Radar,
    role: 'Administrator',
    href: '/admin',
    detail: 'Pantau volume, sebaran risiko, dan status kontrol keamanan operasional.',
  },
] as const satisfies ReadonlyArray<{
  icon: LucideIcon;
  role: string;
  href: string;
  detail: string;
}>;

const FAQ = [
  {
    question: 'Apakah satuan tugas bisa melihat nama saya?',
    answer:
      'Tidak. Yang tersimpan di data aduan adalah pseudonim, bukan nama atau surel. Bahkan administrator basis data tidak dapat memetakannya kembali, karena nilai pseudonim berasal dari HMAC dengan kunci yang tidak ada di sisi basis data.',
  },
  {
    question: 'Bagaimana kalau saya perlu menyimpan bukti?',
    answer:
      'Nomor ticket yang Anda terima saat mengirim aduan bisa dipakai untuk melacak status kapan saja dari halaman pelacakan, tanpa perlu login ulang ke akun lain.',
  },
  {
    question: 'Kalau ada yang coba masuk dengan akun saya?',
    answer:
      'Percobaan login dibatasi, kode TOTP hanya berlaku pada tantangan yang sudah dibuat, dan setiap percobaan tercatat pada log audit beserta konteks jaringannya.',
  },
  {
    question: 'Kenapa isinya dienkripsi berlapis-lapis?',
    answer:
      'Karena risiko sebuah aduan tidak bisa diketahui sebelum isinya dibaca. Penilaian perangkat lebih dulu, band risiko menentukan cipher yang dipakai, dan isi yang sudah terenkripsi tidak pernah dibuka untukXN menentukan radiotherapy mana pun.',
  },
] as const;

function SectionHeading({
  icon: Icon,
  eyebrow,
  title,
  body,
  align = 'left',
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  align?: 'left' | 'center';
}) {
  return (
    <Reveal
      className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}
      distance={16}
      duration={0.5}
    >
      <p
        className={`inline-flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.34em] text-cyan-300/90 ${
          align === 'center' ? 'justify-center' : ''
        }`}
      >
        <Icon className="size-3.5" aria-hidden />
        {eyebrow}
      </p>
      <h2 className="mt-5 text-3xl font-bold text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-slate-400">{body}</p>
    </Reveal>
  );
}

function Hero() {
  return (
    <section className="relative mx-auto max-w-7xl px-5 pt-16 pb-20 sm:px-8 sm:pt-24 sm:pb-28">
      <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-14">
        <div>
          <div className="inline-flex items-center gap-2.5 rounded-full border border-cyan-400/40 bg-cyan-400/10 py-1.5 pr-4 pl-1.5 backdrop-blur-xl">
            <span className="relative flex size-6 items-center justify-center rounded-full bg-cyan-400/15">
              <span
                aria-hidden
                className="absolute inset-0 animate-bounce rounded-full bg-cyan-400/25 [animation-duration:1.8s]"
              />
              <Sparkles className="relative size-3.5 text-cyan-200" aria-hidden />
            </span>
            <span className="text-[0.62rem] font-semibold uppercase tracking-[0.26em] text-cyan-100">
              Generasi baru · ZTNA Engine 2.4
            </span>
          </div>

          <h1 className="mt-7 text-4xl leading-[1.08] font-bold text-white sm:text-6xl">
            Laporkan masalahnya.{' '}
            <span className="block bg-gradient-to-r from-cyan-300 via-teal-400 to-indigo-400 bg-clip-text text-transparent">
              Identitas tetap milik Anda.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-8 text-slate-400 sm:text-lg">
            TRIASE-Net menerima aduan mahasiswa dengan fondasi yang sama seperti sistem produksi:
            isi aduan terenkripsi sebelum disimpan, identitas diganti pseudonim, dan setiap
            keputusan akses tercatat pada log yang tidak dapat disunting.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link
              href="/login"
              className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-gradient-to-r from-cyan-400 to-teal-400 px-7 py-3.5 text-sm font-semibold text-slate-950 transition duration-300 hover:scale-105 hover:shadow-[0_0_50px_-12px_rgba(34,211,238,0.75)]"
            >
              <span
                aria-hidden
                className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-1000 group-hover:translate-x-full"
              />
              <span className="relative z-10 inline-flex items-center gap-2.5">
                Kirim aduan
                <ArrowRight
                  className="size-4 transition-transform duration-300 group-hover:translate-x-1"
                  aria-hidden
                />
              </span>
            </Link>

            <a
              href="#terminal"
              className="group inline-flex items-center gap-2.5 rounded-full border border-slate-700 bg-slate-900/60 px-7 py-3.5 text-sm font-medium text-slate-200 backdrop-blur-xl transition duration-300 hover:scale-105 hover:border-cyan-500/50 hover:text-cyan-100"
            >
              <SquareTerminal className="size-4 text-cyan-300" aria-hidden />
              Lihat terminal enkripsi
            </a>
          </div>

          <dl className="mt-12 grid gap-3 sm:grid-cols-3">
            {[
              { icon: Lock, label: 'Basis data', value: 'Hanya ciphertext' },
              { icon: Gauge, label: 'Akses', value: 'Dinilai per permintaan' },
              { icon: ScrollText, label: 'Log', value: 'Rantai hash SHA-256' },
            ].map((item) => (
              <div
                key={item.label}
                className="group rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 backdrop-blur-xl transition duration-500 hover:-translate-y-1 hover:border-cyan-500/50"
              >
                <dt className="flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.26em] text-slate-500">
                  <item.icon className="size-3.5 text-cyan-300/80" aria-hidden />
                  {item.label}
                </dt>
                <dd className="mt-2 text-sm font-semibold text-white">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div id="terminal" className="scroll-mt-28">
          <ZtnaTerminal />
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="keamanan" className="relative scroll-mt-24 border-y border-slate-800/60 bg-slate-950/40 py-20 backdrop-blur-sm sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          icon={ShieldCheck}
          eyebrow="Lapisan pertahanan"
          title="Kenapa isinya perlu dilindungi"
          body="Enam properti yang membuat nama pelapor tidak perlu ikut tersimpan bersama isi aduannya, dan tidak bisa dipulihkan meski basis data bocor."
        />

        <RevealGroup as="div" className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" stagger={0.07}>
          {PILLARS.map((pillar) => (
            <Reveal
              as="article"
              key={pillar.title}
              className="group relative overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/50 p-6 backdrop-blur-xl transition duration-500 hover:-translate-y-1.5 hover:border-cyan-500/50 hover:bg-slate-900/80"
            >
              <div
                aria-hidden
                className={`absolute -right-16 -top-16 size-40 rounded-full bg-gradient-to-br ${pillar.accent} opacity-0 blur-2xl transition-opacity duration-700 group-hover:opacity-100`}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100"
              />

              <span className="relative flex size-11 items-center justify-center rounded-2xl border border-cyan-400/30 bg-slate-950/70 text-cyan-300 transition duration-500 group-hover:scale-110 group-hover:border-cyan-300/60 group-hover:text-cyan-200">
                <pillar.icon className="size-5" aria-hidden />
              </span>

              <h3 className="relative mt-5 text-base font-semibold text-white">{pillar.title}</h3>
              <p className="relative mt-2.5 text-sm leading-6 text-slate-400">{pillar.body}</p>

              <span
                aria-hidden
                className="relative mt-5 inline-flex items-center gap-1.5 text-[0.65rem] uppercase tracking-[0.22em] text-slate-600 transition duration-500 group-hover:text-cyan-300"
              >
                Selengkapnya
                <ArrowUpRight className="size-3" />
              </span>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}

function AdaptiveSection() {
  return (
    <section id="enkripsi" className="relative scroll-mt-24 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          icon={Network}
          eyebrow="Enkripsi adaptif"
          title="Cipher yang mengikuti risikonya, bukan aturan tetap"
          body="Satu algoritma untuk semua aduan justru membocorkan informasi: pola ciphertext akan ikut mencerminkan tingkat sensitivitas isinya. TRIASE-Net memilih cipher, pembungkus kunci, dan masa retensi sekaligus dari band risiko."
        />

        <RevealGroup as="div" className="mt-14 grid gap-5 lg:grid-cols-3" stagger={0.09}>
          {(['LOW', 'MEDIUM', 'HIGH'] as const).map((band) => {
            const isLow = band === 'LOW';
            const isHigh = band === 'HIGH';

            return (
              <Reveal
                as="article"
                key={band}
                className={`group relative overflow-hidden rounded-3xl border p-6 backdrop-blur-xl transition duration-500 hover:-translate-y-1.5 ${
                  isLow
                    ? 'border-cyan-500/30 bg-cyan-500/[0.04] hover:border-cyan-500/60'
                    : isHigh
                      ? 'border-rose-500/30 bg-rose-500/[0.04] hover:border-rose-500/60'
                      : 'border-amber-500/30 bg-amber-500/[0.04] hover:border-amber-500/60'
                }`}
              >
                <div
                  aria-hidden
                  className={`absolute -right-20 -top-20 size-48 rounded-full blur-3xl transition-opacity duration-700 ${
                    isLow ? 'bg-cyan-400/20' : isHigh ? 'bg-rose-400/20' : 'bg-amber-400/20'
                  } opacity-50 group-hover:opacity-100`}
                />

                <div className="relative flex items-center justify-between gap-3">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.22em] ${
                      isLow
                        ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200'
                        : isHigh
                          ? 'border-rose-400/50 bg-rose-400/10 text-rose-200'
                          : 'border-amber-400/50 bg-amber-400/10 text-amber-200'
                    }`}
                  >
                    {isLow ? (
                      <ShieldCheck className="size-3.5" aria-hidden />
                    ) : isHigh ? (
                      <ShieldAlert className="size-3.5" aria-hidden />
                    ) : (
                      <ShieldAlert className="size-3.5" aria-hidden />
                    )}
                    {band}
                  </span>
                  <span className="font-mono text-[0.62rem] text-slate-500">
                    skor {isLow ? '0-29' : isHigh ? '>= 70' : '30-69'}
                  </span>
                </div>

                <dl className="relative mt-6 space-y-3.5">
                  {[
                    { label: 'Cipher', value: CIPHER_BY_BAND[band], mono: true },
                    { label: 'Pembungkus DEK', value: WRAP_BY_BAND[band], mono: true },
                    { label: 'Keputusan', value: DECISION_BY_BAND[band], mono: true },
                    {
                      label: 'Retensi',
                      value: `${RETENTION_DAYS_BY_RISK[band]} hari`,
                      mono: false,
                    },
                    {
                      label: 'Material kunci',
                      value: `${DEK_BYTES * 8} bit DEK · nonce ${NONCE_BYTES * 8} bit · tag ${AUTH_TAG_BYTES * 8} bit`,
                      mono: false,
                    },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-start justify-between gap-4 border-b border-slate-800/60 pb-3 last:border-b-0 last:pb-0"
                    >
                      <dt className="shrink-0 text-[0.6rem] uppercase tracking-[0.24em] text-slate-500">
                        {row.label}
                      </dt>
                      <dd
                        className={`text-right text-xs text-slate-200 ${row.mono ? 'font-mono text-[0.7rem] text-cyan-200' : ''}`}
                      >
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            );
          })}
        </RevealGroup>

        <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-slate-500">
          <Binary className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Ambang band risiko di atas dibaca langsung dari <code className="font-mono text-slate-400">@/lib/crypto/adaptive</code>,
          sama dengan yang dipakai mesin enkripsi, dasbor, dan log audit. Tidak ada tabel band
          risiko yang disalin ulang di antarmuka.
        </p>
      </div>
    </section>
  );
}

function BenchmarkSection() {
  return (
    <section
      id="tolok-ukur"
      className="relative scroll-mt-24 border-y border-slate-800/60 bg-slate-950/40 py-20 backdrop-blur-sm sm:py-24"
    >
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          icon={Cpu}
          eyebrow="Tolok ukur kriptografi"
          title="Angka yang bisa diukur ulang"
          body="Empat metrik yang paling sering ditanyakan saat audit keamanan, ditulis lengkap dengan satuan dan konteksnya supaya tidak dibaca sebagai janji kosong."
          align="center"
        />

        <RevealGroup as="dl" className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" stagger={0.07}>
          {BENCHMARKS.map((item) => (
            <Reveal
              key={item.label}
              className="group relative overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/50 p-6 backdrop-blur-xl transition duration-500 hover:-translate-y-1.5 hover:border-cyan-500/50 hover:shadow-[0_0_60px_-30px_rgba(34,211,238,0.8)]"
            >
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100"
              />

              <span className="flex size-10 items-center justify-center rounded-2xl border border-cyan-400/30 bg-slate-950/70 text-cyan-300 transition duration-500 group-hover:scale-110">
                <item.icon className="size-4.5" aria-hidden />
              </span>

              <dd className="mt-5 flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tracking-tight text-white">{item.value}</span>
                <span className="text-sm text-cyan-300">{item.unit}</span>
              </dd>

              <dt className="mt-2 text-sm font-semibold text-slate-200">{item.label}</dt>
              <p className="mt-1 text-xs leading-5 text-slate-500">{item.note}</p>
            </Reveal>
          ))}
        </RevealGroup>

        <RevealGroup as="div" className="mt-8 grid gap-4 sm:grid-cols-3" stagger={0.07}>
          {[
            {
              icon: Activity,
              title: 'Diukur, bukan diperkirakan',
              body: 'Skrip pengukuran berjalan di luar jalur permintaan, sehingga tidak menambah latensi yang dirasakan pengguna.',
            },
            {
              icon: ServerCog,
              title: 'Konsisten antar kontributor',
              body: 'Tolok ukur dipaketkan sebagai tes otomatis, jadi regresi performa tertangkap sebelum masuk ke branches.',
            },
            {
              icon: Radio,
              title: 'Pantau terus di operasional',
              body: 'Angka yang sama diekspos ke dasbor admin sebagai deret waktu, bukan sekadar klaim di halaman dokumentasi.',
            },
          ].map((item) => (
            <Reveal
              key={item.title}
              className="flex gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4 backdrop-blur-xl transition duration-500 hover:border-cyan-500/50"
            >
              <item.icon className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden />
              <div>
                <p className="text-sm font-medium text-slate-100">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </RevealGroup>

        <p className="mt-6 text-xs leading-5 text-slate-600">
          Angka di atas adalah target desain pada perangkat uji rujukan (4 vCPU, 8 GB RAM, Linux
          x86_64, OpenSSL 3) dan bukan klaim performa produksi. Nilai sebenarnya bergantung pada
          perangkat, dukungan AES-NI, dan beban database.
        </p>
      </div>
    </section>
  );
}

function AudienceSection() {
  return (
    <section id="peran" className="relative scroll-mt-24 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <SectionHeading
          icon={Layers}
          eyebrow="Peran pengguna"
          title="Masuk sesuai peran Anda"
          body="Beranda tiap peran ditentukan oleh token sesi yang diverifikasi server, bukan oleh tautan yang dipilih di peramban."
        />

        <RevealGroup as="div" className="mt-14 grid gap-5 md:grid-cols-3" stagger={0.08}>
          {AUDIENCES.map((audience) => (
            <Reveal key={audience.role} className="h-full">
              <Link
                href={audience.href}
                className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/50 p-6 backdrop-blur-xl transition duration-500 hover:-translate-y-1.5 hover:border-cyan-500/50 hover:bg-slate-900/80"
              >
                <div
                  aria-hidden
                  className="absolute -right-20 -top-20 size-48 rounded-full bg-gradient-to-br from-cyan-400/20 to-indigo-500/10 opacity-0 blur-3xl transition-opacity duration-700 group-hover:opacity-100"
                />

                <span className="relative flex size-11 items-center justify-center rounded-2xl border border-indigo-400/30 bg-slate-950/70 text-indigo-300 transition duration-500 group-hover:scale-110 group-hover:border-cyan-300/60 group-hover:text-cyan-200">
                  <audience.icon className="size-5" aria-hidden />
                </span>

                <h3 className="relative mt-5 text-lg font-semibold text-white">{audience.role}</h3>
                <p className="relative mt-2.5 text-sm leading-6 text-slate-400">{audience.detail}</p>

                {/* `mt-auto` menjaga label "Masuk" rata di dasar kartu meski
                    panjang `detail` tiap peran berbeda-beda. */}
                <span className="relative mt-auto inline-flex items-center gap-2 pt-5 text-xs font-medium uppercase tracking-[0.2em] text-cyan-300">
                  Masuk
                  <ArrowRight
                    className="size-3.5 transition-transform duration-300 group-hover:translate-x-1"
                    aria-hidden
                  />
                </span>
              </Link>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}

function FaqSection() {
  return (
    <section
      id="faq"
      className="relative scroll-mt-24 border-t border-slate-800/60 bg-slate-950/40 py-20 backdrop-blur-sm sm:py-24"
    >
      <div className="mx-auto max-w-4xl px-5 sm:px-8">
        <SectionHeading
          icon={CircleCheck}
          eyebrow="Pertanyaan umum"
          title="Yang paling sering ditanyakan"
          body="Empat hal yang biasanya menjadi pertanyaan pertama saat sistem ini diperkenalkan ke mahasiswa."
        />

        <RevealGroup as="div" className="mt-12 grid gap-3" stagger={0.06}>
          {FAQ.map((item) => (
            <Reveal key={item.question}>
              <details
                className="group overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/40 backdrop-blur-xl transition duration-500 open:border-cyan-500/40 hover:border-slate-700"
              >
              <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium text-white sm:px-6 sm:text-base">
                  {item.question}
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-400 transition duration-500 group-hover:border-cyan-500/50 group-hover:text-cyan-300 group-open:rotate-180 group-open:border-cyan-500/60 group-open:text-cyan-200"
                  >
                    <ChevronDown className="size-4" />
                  </span>
                </summary>
                <p className="px-5 pb-5 text-sm leading-7 text-slate-400 sm:px-6">{item.answer}</p>
              </details>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="relative py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="relative overflow-hidden rounded-[2.5rem] border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 via-slate-900/60 to-indigo-500/10 px-6 py-14 text-center backdrop-blur-2xl sm:px-12 sm:py-20">
          <div
            aria-hidden
            className="absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 animate-pulse rounded-full bg-cyan-400/20 blur-[140px] [animation-duration:8s]"
          />
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(148,210,255,0.4)_1px,transparent_1px),linear-gradient(90deg,rgba(148,210,255,0.4)_1px,transparent_1px)] [background-size:34px_34px]"
          />

          <Reveal as="div" className="relative" from="scale" distance={0.04} duration={0.7}>
            <span className="inline-flex size-14 items-center justify-center rounded-2xl border border-cyan-400/40 bg-slate-950/70 text-cyan-200 backdrop-blur-xl">
              <span
                aria-hidden
                className="absolute inset-0 animate-ping rounded-2xl bg-cyan-400/10 [animation-duration:3s]"
              />
              <Lock className="relative size-6" aria-hidden />
            </span>

            <h2 className="mt-8 text-3xl font-bold text-white sm:text-4xl">
              Siap mengirim aduan tanpa
              <span className="block bg-gradient-to-r from-cyan-300 via-teal-400 to-indigo-400 bg-clip-text text-transparent">
                membuka identitas Anda?
              </span>
            </h2>

            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-400">
              Anda tidak perlu membuat akun baru. Masuk, kirim aduan, lalu simpan nomor ticket yang
              muncul. Nomornya sudah cukup untuk melacak status tanpa membuka isi aduan lagi.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/login"
                className="group relative inline-flex items-center gap-2.5 overflow-hidden rounded-full bg-gradient-to-r from-cyan-400 to-teal-400 px-7 py-3.5 text-sm font-semibold text-slate-950 transition duration-300 hover:scale-105 hover:shadow-[0_0_50px_-12px_rgba(34,211,238,0.75)]"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-1000 group-hover:translate-x-full"
                />
                <span className="relative z-10 inline-flex items-center gap-2.5">
                  Masuk ke TRIASE-Net
                  <ArrowRight
                    className="size-4 transition-transform duration-300 group-hover:translate-x-1"
                    aria-hidden
                  />
                </span>
              </Link>

              <Link
                href="/aduan/lacak"
                className="inline-flex items-center gap-2.5 rounded-full border border-slate-700 bg-slate-900/60 px-7 py-3.5 text-sm font-medium text-slate-200 backdrop-blur-xl transition duration-300 hover:scale-105 hover:border-cyan-500/50 hover:text-cyan-100"
              >
                <ScanLine className="size-4 text-cyan-300" aria-hidden />
                Lacak tiket yang sudah ada
              </Link>
            </div>

            <p className="mt-8 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-[0.62rem] uppercase tracking-[0.24em] text-slate-500 backdrop-blur-xl">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-teal-400" />
              Halaman ini informasional · data dasbor butuh autentikasi
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative border-t border-slate-800/60 bg-slate-950/60 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <BrandMark />
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.4em] text-cyan-200">
                  TRIASE-Net
                </p>
                <p className="text-[0.6rem] uppercase tracking-[0.28em] text-slate-500">
                  Secure Complaint Channel
                </p>
              </div>
            </div>
            <p className="mt-5 max-w-md text-sm leading-6 text-slate-400">
              Sistem komunikasi aman untuk layanan aduan mahasiswa. Enkripsi adaptif, kendali akses
              berbasis risiko, dan audit append-only yang tidak dapat disunting.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['AES-256-GCM', 'ChaCha20-Poly1305', 'RSA-OAEP-256', 'HMAC-SHA256'].map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 font-mono text-[0.62rem] text-slate-500 transition duration-500 hover:border-cyan-500/40 hover:text-cyan-300"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[0.62rem] uppercase tracking-[0.28em] text-slate-500">
             Kategori aduan
            </p>
            <ul className="mt-4 grid gap-1.5">
              {ADUAN_CATEGORY.map((category) => (
                <li key={category} className="text-sm text-slate-400">
                  {category.replace(/_/g, ' ').toLowerCase()}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[0.62rem] uppercase tracking-[0.28em] text-slate-500">Navigasi</p>
            <ul className="mt-4 grid gap-1.5">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="text-sm text-slate-400 transition hover:text-cyan-300"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/login" className="text-sm text-slate-400 transition hover:text-cyan-300">
                  Masuk
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-slate-800/60 pt-7 text-xs text-slate-600 sm:flex-row sm:items-center">
          <p>
            Halaman ini bersifat informasional. Data yang ditampilkan pada dasbor hanya bisa diakses
            setelah autentikasi dan dicatat dalam log audit.
          </p>
          <p className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-cyan-400" />
            Zero Trust Network Access
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-cyan-400/30 selection:text-cyan-50">
      <AmbientBackdrop />
      <NavBar />

      <main>
        <Hero />
        <FeaturesSection />
        <AdaptiveSection />
        <BenchmarkSection />
        <AudienceSection />
        <FaqSection />
        <CallToAction />
      </main>

      <Footer />
    </div>
  );
}
