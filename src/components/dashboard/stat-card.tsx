import type { LucideIcon } from "lucide-react";

type Tone = "cyan" | "amber" | "emerald" | "rose" | "violet";

const TONE_SURFACE: Readonly<Record<Tone, string>> = {
  cyan: "from-cyan-500/12",
  amber: "from-amber-500/12",
  emerald: "from-emerald-500/12",
  rose: "from-rose-500/12",
  violet: "from-violet-500/12",
};

const TONE_ICON: Readonly<Record<Tone, string>> = {
  cyan: "bg-cyan-400/10 text-cyan-300 ring-cyan-400/20",
  amber: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
  emerald: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
  rose: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
  violet: "bg-violet-400/10 text-violet-300 ring-violet-400/20",
};

export type StatCardProps = {
  label: string;
  value: string;
  /** Baris kedua di bawah angka. Boleh dikosongkan. */
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
};

/**
 * Kartu KPI.
 *
 * `value` sengaja tidak dipotong dengan `truncate`: angka dan satuan seperti
 * "3 hari" adalah bagian dari jawaban, dan memotongnya membuat pengguna
 * salah baca. Yang dipotong hanya `hint`, karena di situ tidak ada angka
 * yang/action perlu dibaca utuh.
 */
export function StatCard({ label, value, hint, icon: Icon, tone = "cyan" }: StatCardProps) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br ${TONE_SURFACE[tone]} to-slate-900 p-5 transition-colors hover:border-slate-700`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${TONE_ICON[tone]}`}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
      </div>

      <p className="mt-3 text-2xl font-bold tracking-tight text-white tabular-nums">{value}</p>

      {hint ? (
        <p className="mt-1.5 truncate text-xs text-slate-400" title={hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}