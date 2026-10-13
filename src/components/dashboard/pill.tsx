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
  cyan: "bg-blue-50 text-blue-700 ring-blue-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-200/60",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  rose: "bg-rose-50 text-rose-700 ring-rose-100",
  violet: "bg-indigo-50 text-indigo-600 ring-indigo-100",
  slate: "bg-zinc-100 text-zinc-600 ring-zinc-200",
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
  DITERIMA: "violet",
  DITUTUP: "slate",
  DITOLAK: "rose",
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
      className="inline-flex max-w-full items-center rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 ring-1 ring-inset ring-zinc-200"
    >
      <span className="truncate">{value}</span>
    </span>
  );
}
