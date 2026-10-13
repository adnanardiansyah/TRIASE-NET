"use client";

import Link from "next/link";
import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { Brand } from "@/components/brand";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="flex min-h-svh flex-col bg-white px-6 py-8"><div className="mx-auto w-full max-w-5xl"><Brand /></div><div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16"><span className="grid size-12 place-items-center rounded-lg bg-amber-50 text-amber-700"><TriangleAlert size={24} strokeWidth={1.5} /></span><h1 className="mt-6 text-2xl font-semibold">Halaman belum dapat dimuat.</h1><p role="alert" className="mt-4 text-sm leading-7 text-zinc-500">Terjadi kendala saat memuat layanan. Coba kembali beberapa saat lagi.</p><div className="mt-7 flex flex-wrap gap-3"><button onClick={reset} className="ui-btn ui-btn-primary"><RefreshCw size={15} />Coba lagi</button><Link href="/" className="ui-btn"><ArrowLeft size={15} />Kembali ke beranda</Link></div></div></main>;
}
