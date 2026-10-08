import type { ReactNode } from "react";

type Tone = "cyan" | "amber" | "emerald" | "rose" | "violet" | "slate";

/**
 * Warna pil.
 *
 * Satu pemetaan untuk foreground dan latar, bukan dua, supaya tidak mungkin
 * ada status yang teksnya gelap di atas latar terang (atau sebaliknya) akibat
 * hanya satu sisinya yang diubah.
 */
const TONE_CLASS: Readonly<Record<Tone, string>> = {
  cyan: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/25",
  amber: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  emerald: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  rose: "bg-rose-400/10 text-rose-300 ring-rose-400/25",
  violet: "bg-violet-400/10 text-violet-300 ring-violet-400/25",
  slate: "bg-slate-400/10 text-slate-300 ring-slate-400/25",
};

/** Warna titik solid, untuk pil yang memakai penanda berbentuk titik. */
const DOT_CLASS: Readonly<Record<Tone, string>> = {
  cyan: "bg-cyan-400",
  amber: "bg-amber-400",
  emerald: "bg-emerald-400",
  rose: "bg-rose-400",
  violet: "bg-violet-400",
  slate: "bg-slate-400",
};

const STATUS_TONE: Readonly<Record<string, Tone>> = {
  DALAM_PENANGANAN: "cyan",
  MENUNGGU_TINDAK_LANJUT: "amber",
  SELESAI: "emerald",
};

const RISK_TONE: Readonly<Record<string, Tone>> = {
  HIGH: "rose",
  MEDIUM: "amber",
  LOW: "emerald",
};

/**
 * Pil status tiket.
 *
 * Titik warnanya dekoratif, jadi disembunyikan dari pembaca layar; maknanya
 * sudah dibawa oleh teksnya sendiri. Tanpa itu, setiap baris tabel akan
 * diumumkan dua kali.
 */
export function StatusPill({ status, label }: { status: string; label: string }) {
  const tone = STATUS_TONE[status] ?? "slate";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONE_CLASS[tone]}`}
    >
      <span className={`size-1.5 rounded-full ${DOT_CLASS[tone]}`} aria-hidden />
      {label}
    </span>
  );
}

/** Pil band risiko, dengan label Indonesia. */
export function RiskPill({ riskBand, label }: { riskBand: string; label: string }) {
  const tone = RISK_TONE[riskBand] ?? "slate";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONE_CLASS[tone]}`}
    >
      <span className={`size-1.5 rounded-full ${DOT_CLASS[tone]}`} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Pil netral untuk metadata lain, misalnya kategori atau pseudonim.
 *
 * `label`/`value` dipisah supaya pemanggil tidak perlu memotong teks panjang
 * di dalam komponen.
 */
export function MetaPill({ value, title }: { value: string; title?: ReactNode }) {
  return (
    <span
      title={typeof title === "string" ? title : undefined}
      className="inline-flex max-w-full items-center rounded-md bg-slate-800/70 px-2 py-0.5 text-xs text-slate-300 ring-1 ring-inset ring-slate-700/60"
    >
      <span className="truncate">{value}</span>
    </span>
  );
}