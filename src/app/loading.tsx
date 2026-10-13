import { Loader2 } from "lucide-react";

export default function Loading() {
  return <div role="status" className="flex min-h-[70svh] items-center justify-center gap-3 bg-[#f7f9f8] text-xs text-zinc-500"><Loader2 size={18} className="animate-spin text-emerald-700" />Memuat halaman...</div>;
}
