"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowRight, Loader2, Search } from "lucide-react";
import { DashboardShell } from "./dashboard-shell";
import { StatusPill } from "./dashboard/pill";
import { formatTicketCategory, formatTicketStatus } from "@/lib/dashboard-aggregates";
import type { TicketMetadata } from "@/lib/ticket-types";
import type { TimelineEntry } from "@/lib/db/tickets";
export { ComplaintForm } from "./complaint-form";

export function TicketTracker() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ ticket: TicketMetadata; timeline: TimelineEntry[] } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(""); setResult(null);
    try {
      const response = await fetch(`/api/aduan/${encodeURIComponent(code.trim().toUpperCase())}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) { setError(data.message ?? "Tiket belum dapat ditemukan."); return; }
      setResult(data);
    } catch { setError("Tidak dapat menghubungi layanan pelacakan."); }
    finally { setPending(false); }
  }
  return <DashboardShell role="MAHASISWA" title="Lacak tiket aduan" subtitle="Lihat status terbaru dan perjalanan penanganan aduan Anda.">
    <div className="max-w-3xl border-t border-zinc-200 pt-7"><form onSubmit={submit}><label htmlFor="tracking-code" className="ui-label">Nomor tiket</label><div className="flex flex-col gap-3 sm:flex-row"><input id="tracking-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} disabled={pending} required maxLength={17} pattern="TRX-[0-9]{4}-[A-Z0-9]{8}" placeholder="TRX-2026-XXXXXXXX" className="ui-input font-mono" /><button disabled={pending || !code.trim()} className="ui-btn ui-btn-primary shrink-0">{pending ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}{pending ? "Mencari..." : "Cari tiket"}</button></div></form>{error && <p role="alert" className="ui-alert mt-5">{error}</p>}
      {result ? <section className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none mt-8 border-y border-zinc-200 bg-white px-5 py-6 sm:px-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[11px] text-emerald-700">{result.ticket.ticketId}</p><h2 className="mt-2 break-words text-xl font-semibold">{result.ticket.subject}</h2><p className="mt-2 text-xs text-zinc-500">{formatTicketCategory(result.ticket.category)}</p></div><StatusPill status={result.ticket.status} label={formatTicketStatus(result.ticket.status)} /></div><dl className="mt-6 grid gap-5 border-y border-zinc-100 py-5 text-xs sm:grid-cols-2"><div><dt className="text-zinc-400">Dibuat</dt><dd className="mt-2 text-zinc-700">{new Date(result.ticket.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</dd></div><div><dt className="text-zinc-400">Terakhir diperbarui</dt><dd className="mt-2 text-zinc-700">{new Date(result.ticket.updatedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</dd></div></dl><h3 className="mt-6 text-sm font-semibold">Riwayat penanganan</h3><ol className="mt-4 space-y-5 border-l border-emerald-100 pl-4">{result.timeline.map((item) => <li key={item.id}><p className="text-xs font-medium">{formatTicketStatus(item.toStatus)}</p><time dateTime={item.createdAt} className="mt-1 block text-[10px] text-zinc-400">{new Date(item.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</time></li>)}</ol><Link href={`/aduan/${result.ticket.ticketId}`} className="ui-btn ui-btn-primary mt-7">Buka detail & percakapan<ArrowRight size={15} /></Link></section> : !pending && !error && <div className="mt-10 flex items-start gap-3 border-t border-zinc-200 pt-6 text-zinc-400"><Search size={19} strokeWidth={1.5} /><div><p className="text-xs font-medium text-zinc-500">Nomor tiket ada di dashboard Anda.</p><Link href="/mahasiswa/aduan" className="mt-3 inline-flex items-center gap-1 text-xs text-emerald-700">Lihat aduan saya<ArrowRight size={13} /></Link></div></div>}
    </div>
  </DashboardShell>;
}
