import type { DistributionSlice } from "@/lib/dashboard-aggregates";

const BAR_TONE: Readonly<Record<string, string>> = {
  HIGH: "bg-rose-400",
  MEDIUM: "bg-amber-400",
  LOW: "bg-emerald-400",
  DALAM_PENANGANAN: "bg-cyan-400",
  MENUNGGU_TINDAK_LANJUT: "bg-amber-400",
  SELESAI: "bg-emerald-400",
};

const DEFAULT_BAR = "bg-slate-500";

export type DistributionBarsProps = {
  slices: DistributionSlice[];
  /** Kunci slice yang menentukan warna,(default `key`). */
  toneKey?: (slice: DistributionSlice) => string;
  emptyLabel?: string;
};

/**
 * Daftar bar horizontal untuk sebaran data.
 *
 * Dipakai untuk risiko, status, dan kategori. Bar dianimasikan lewat
 * `transition-[width]`, bukan Motion: yang berubah hanya satu nilai lebar CSS,
 * sehingga transisi CSS cukup dan tidak menambah animasi yang harus dihormati
 * `prefers-reduced-motion`.
 *
 * Lebar bar diambil langsung dari `percent` tanpa dianimasikan ulang saat data
 * berubah, karena `percent` sudah berupa bilangan bulat 0-100.
 */
export function DistributionBars({
  slices,
  toneKey = (slice) => slice.key,
  emptyLabel = "Belum ada data.",
}: DistributionBarsProps) {
  if (slices.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-3.5">
      {slices.map((slice) => {
        const tone = BAR_TONE[toneKey(slice)] ?? DEFAULT_BAR;

        return (
          <li key={slice.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-slate-300">{slice.label}</span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {slice.count}
                <span className="mx-1 text-slate-600" aria-hidden>
                  &middot;
                </span>
                {slice.percent}%
              </span>
            </div>

            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800"
              role="img"
              aria-label={`${slice.label}: ${slice.count} tiket, ${slice.percent} persen`}
            >
              <div
                className={`h-full rounded-full ${tone} transition-[width] duration-500`}
                style={{ width: `${slice.percent}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}