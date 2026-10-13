"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, CheckCircle2, Copy, FilePlus2, Fingerprint, Loader2, LockKeyhole, MessageSquareText, Search, Send } from "lucide-react";
import { DashboardShell } from "./dashboard-shell";
import { RiskPill, StatusPill } from "./dashboard/pill";
import { ADUAN_CATEGORY, type AduanCategory } from "@/lib/domain/enums";
import { formatRiskBand, formatTicketCategory, formatTicketStatus } from "@/lib/dashboard-aggregates";
import type { TicketMetadata } from "@/lib/ticket-types";
import type { TimelineEntry } from "@/lib/db/tickets";

interface CreatedTicket { ticketId: string; pseudonym: string; riskBand: string }

export function ComplaintForm() {
  const [category, setCategory] = useState<AduanCategory>("FASILITAS");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedTicket | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const selected = new URLSearchParams(window.location.search).get("category");
    if (ADUAN_CATEGORY.includes(selected as AduanCategory)) setCategory(selected as AduanCategory);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/aduan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, subject: subject.trim(), body: body.trim() }) });
      const data = await response.json();
      if (!response.ok || !data.ok) { setError(data.message ?? "Aduan belum berhasil dikirim."); return; }
      setCreated(data); setSubject(""); setBody("");
    } catch { setError("Pengiriman belum terkonfirmasi. Periksa daftar aduan sebelum mengirim ulang."); }
    finally { setPending(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(created!.ticketId); setCopied(true); }
    catch { setError("Nomor tiket belum dapat disalin."); }
  }
  return <DashboardShell role="MAHASISWA" title="Sampaikan aduan" subtitle="Ceritakan hal yang perlu mendapat perhatian. Kami mendengarkan." actions={<Link href="/mahasiswa" className="ui-btn">Aduan saya<ArrowRight size={14} /></Link>}>
    {created ? <section className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none max-w-3xl border-y border-emerald-200 bg-emerald-50/60 px-5 py-8 sm:px-8"><span className="grid size-12 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><CheckCircle2 size={25} strokeWidth={1.5} /></span><h2 className="mt-5 text-xl font-semibold text-emerald-950">Aduan Anda sudah diterima.</h2><p className="mt-2 text-xs leading-6 text-emerald-800/70">Ikuti perkembangan penanganan melalui nomor tiket berikut.</p><div className="mt-6 flex flex-wrap items-center gap-3 border-y border-emerald-200 py-5"><span className="break-all font-mono text-lg font-semibold text-emerald-800">{created.ticketId}</span><button onClick={() => void copy()} className="ui-icon" title="Salin nomor tiket" aria-label="Salin nomor tiket">{copied ? <Check size={15} /> : <Copy size={15} />}</button>{copied && <span role="status" className="text-xs text-emerald-700">Tersalin</span>}</div><dl className="mt-5 grid gap-4 text-xs sm:grid-cols-2"><div><dt className="text-zinc-500">Pseudonim pelapor</dt><dd className="mt-2 break-all font-mono text-zinc-700">{created.pseudonym}</dd></div><div><dt className="text-zinc-500">Risiko aduan</dt><dd className="mt-2"><RiskPill riskBand={created.riskBand} label={formatRiskBand(created.riskBand)} /></dd></div></dl><div className="mt-7 flex flex-wrap gap-3"><Link href={`/aduan/${created.ticketId}`} className="ui-btn ui-btn-primary">Buka detail tiket<ArrowRight size={15} /></Link><button onClick={() => { setCreated(null); setCopied(false); setError(""); }} className="ui-btn"><FilePlus2 size={15} />Buat aduan lainnya</button></div>{error && <p role="alert" className="mt-4 text-xs text-rose-600">{error}</p>}</section> : <div className="grid gap-10 border-t border-zinc-200 pt-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(250px,.7fr)]">
      <form onSubmit={submit} className="min-w-0 space-y-6" aria-busy={pending}>
        <div className="flex items-center gap-2"><FilePlus2 size={17} className="text-emerald-700" /><h2 className="ui-section-title">Informasi pengaduan</h2></div>
        {error && <p role="alert" className="ui-alert">{error}</p>}
        <div><label htmlFor="complaint-category" className="ui-label">Kategori aduan</label><select id="complaint-category" value={category} disabled={pending} onChange={(event) => setCategory(event.target.value as AduanCategory)} className="ui-input">{ADUAN_CATEGORY.map((key) => <option key={key} value={key}>{formatTicketCategory(key)}</option>)}</select></div>
        <div><div className="flex items-center justify-between gap-3"><label htmlFor="complaint-subject" className="ui-label">Judul aduan</label><span className="text-[10px] tabular-nums text-zinc-400">{subject.length}/200</span></div><input id="complaint-subject" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={pending} maxLength={200} required className="ui-input" placeholder="Ringkasan singkat persoalan yang Anda alami" /></div>
        <div><div className="flex items-center justify-between gap-3"><label htmlFor="complaint-body" className="ui-label">Ceritakan persoalannya</label><span className="text-[10px] tabular-nums text-zinc-400">{body.length}/8000</span></div><textarea id="complaint-body" value={body} onChange={(event) => setBody(event.target.value)} disabled={pending} maxLength={8000} required rows={10} className="ui-input min-h-52 resize-y leading-7" placeholder="Ceritakan kronologi, waktu kejadian, serta hal yang Anda harapkan dapat ditindaklanjuti." /></div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-200 pt-5"><span className="inline-flex items-center gap-2 text-[10px] text-zinc-400"><LockKeyhole size={13} />Isi aduan dilindungi enkripsi</span><button disabled={pending || !subject.trim() || !body.trim()} className="ui-btn ui-btn-primary px-5">{pending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{pending ? "Mengirim aduan..." : "Kirim aduan"}</button></div>
      </form>
      <aside className="space-y-7 border-t border-zinc-200 pt-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"><div><p className="eyebrow">Sebelum mengirim</p><h2 className="mt-3 text-lg font-semibold">Bercerita dengan aman.</h2><p className="mt-3 text-xs leading-7 text-zinc-500">Sertakan informasi yang relevan dan hindari data pribadi yang tidak diperlukan.</p></div>{[{ icon: Fingerprint, title: "Pseudonim untuk pelapor", body: "Nama dan email Anda tidak ditampilkan bersama tiket kepada petugas." }, { icon: MessageSquareText, title: "Ruang untuk tindak lanjut", body: "Informasi tambahan dapat disampaikan dalam percakapan setelah tiket dibuat." }, { icon: CheckCircle2, title: "Perkembangan dalam satu tiket", body: "Riwayat status tersedia pada halaman detail aduan." }].map((item) => <div key={item.title} className="flex items-start gap-3"><item.icon size={18} strokeWidth={1.5} className="mt-1 shrink-0 text-emerald-700" /><div><h3 className="text-xs font-semibold">{item.title}</h3><p className="mt-2 text-[11px] leading-6 text-zinc-500">{item.body}</p></div></div>)}</aside>
    </div>}
  </DashboardShell>;
}

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
      {result ? <section className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none mt-8 border-y border-zinc-200 bg-white px-5 py-6 sm:px-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[11px] text-emerald-700">{result.ticket.ticketId}</p><h2 className="mt-2 break-words text-xl font-semibold">{result.ticket.subject}</h2><p className="mt-2 text-xs text-zinc-500">{formatTicketCategory(result.ticket.category)}</p></div><StatusPill status={result.ticket.status} label={formatTicketStatus(result.ticket.status)} /></div><dl className="mt-6 grid gap-5 border-y border-zinc-100 py-5 text-xs sm:grid-cols-2"><div><dt className="text-zinc-400">Dibuat</dt><dd className="mt-2 text-zinc-700">{new Date(result.ticket.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</dd></div><div><dt className="text-zinc-400">Terakhir diperbarui</dt><dd className="mt-2 text-zinc-700">{new Date(result.ticket.updatedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</dd></div></dl><h3 className="mt-6 text-sm font-semibold">Riwayat penanganan</h3><ol className="mt-4 space-y-5 border-l border-emerald-100 pl-4">{result.timeline.map((item) => <li key={item.id}><p className="text-xs font-medium">{formatTicketStatus(item.toStatus)}</p><time dateTime={item.createdAt} className="mt-1 block text-[10px] text-zinc-400">{new Date(item.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</time></li>)}</ol><Link href={`/aduan/${result.ticket.ticketId}`} className="ui-btn ui-btn-primary mt-7">Buka detail & percakapan<ArrowRight size={15} /></Link></section> : !pending && !error && <div className="mt-10 flex items-start gap-3 border-t border-zinc-200 pt-6 text-zinc-400"><Search size={19} strokeWidth={1.5} /><div><p className="text-xs font-medium text-zinc-500">Nomor tiket ada di dashboard Anda.</p><Link href="/mahasiswa" className="mt-3 inline-flex items-center gap-1 text-xs text-emerald-700">Lihat aduan saya<ArrowRight size={13} /></Link></div></div>}
    </div>
  </DashboardShell>;
}
