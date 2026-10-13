import Link from "next/link";
import { ArrowLeft, Home, Search } from "lucide-react";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return <main className="flex min-h-svh flex-col bg-white px-6 py-8"><div className="mx-auto w-full max-w-5xl"><Brand /></div><div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16"><span className="grid size-12 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Search size={24} strokeWidth={1.5} /></span><p className="eyebrow mt-6">404 · Halaman tidak ditemukan</p><h1 className="mt-3 text-3xl font-semibold">Belum menemukan tujuan?</h1><p className="mt-4 text-sm leading-7 text-zinc-500">Halaman atau tiket ini tidak tersedia. Untuk tiket aduan, pastikan nomor tiket benar dan Anda masuk dengan akun yang memiliki akses.</p><div className="mt-7 flex flex-wrap gap-3"><Link href="/" className="ui-btn ui-btn-primary"><Home size={15} />Beranda</Link><Link href="/login" className="ui-btn"><ArrowLeft size={15} />Masuk ke akun</Link></div></div></main>;
}
