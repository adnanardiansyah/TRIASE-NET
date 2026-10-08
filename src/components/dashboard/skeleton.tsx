/**
 * Placeholder saat data belum arrive.
 *
 * Kerangka (skeleton) dipilih daripada spinner karena spinner cuma memberi tahu
 * "ada proses", sedangkan kerangka memberi tahu "akan muncul di sini". Di
 * dasbor yang isinya kartu angka dan tabel, bentuk akhirnya sudah diketahui,
 * jadi tidak perlu menebak.
 *
 * Animasi `animate-pulse` otomatis dimatikan oleh aturan
 * `prefers-reduced-motion` global di `globals.css`.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-800/70 ${className}`} aria-hidden />;
}

/** Kerangka untuk satu kartu KPI: bentuknya sama dengan `StatCard`. */
export function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-9 rounded-xl" />
      </div>
      <Skeleton className="mt-3 h-8 w-20" />
      <Skeleton className="mt-2 h-3 w-32" />
    </div>
  );
}

/** Kerangka untuk panel tabel, dengan jumlah baris yang ditentukan pemanggil. */
export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={`h-4 ${columnIndex === 0 ? "w-24" : columnIndex === columns - 1 ? "w-20" : "flex-1"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Kerangka untuk daftar di dalam kartu. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-4 w-3/4" />
          <Skeleton className="mt-3 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}