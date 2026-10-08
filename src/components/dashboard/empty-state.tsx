import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Ajakan aksi. Tombol atau link, misalnya "Buat aduan". */
  action?: ReactNode;
};

/**
 * Keadaan kosong.
 *
 * `role="status"` dipakai supaya layar pembaca mengumumkan pesan ini saat
 * muncul. Untuk daftar yang dimuat lewat fetch, pengumuman itu penting:
 * pengguna yang tidak melihat layar akan tetap tahu datanya kosong, bukan
 * sekadar menunggu elemen yang tidak pernah datang.
 */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 px-6 py-12 text-center"
    >
      <span
        className="grid size-12 place-items-center rounded-2xl bg-slate-800/60 text-slate-400 ring-1 ring-inset ring-slate-700/60"
        aria-hidden
      >
        <Icon className="size-6" />
      </span>

      <p className="mt-4 font-medium text-white">{title}</p>
      <p className="mt-1.5 max-w-sm text-sm text-slate-400">{description}</p>

      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}