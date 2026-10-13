"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FilePlus2, Inbox, Loader2, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Ticket, X, type LucideIcon } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { RiskPill, StatusPill } from "./pill";
import type { SessionRole } from "@/lib/auth/jwt";
import type { TicketMetadata } from "@/lib/ticket-types";
import { ADUAN_CATEGORY, ADUAN_STATUS } from "@/lib/domain/enums";
import { STATUS_TRANSITIONS } from "@/lib/ticket-workflow";
import { INITIAL_FILTERS, dailyTicketCounts, filterTickets, isTicketClosed, ticketCsv, type TicketFilters } from "@/lib/dashboard-view";
import { buildCategoryDistribution, buildRiskDistribution, buildSlaSummary, formatRelativeTime, formatRiskBand, formatTicketCategory, formatTicketStatus, SLA_TARGET_DAYS } from "@/lib/dashboard-aggregates";

const copy = {
  MAHASISWA: { title: "Ruang aduan saya", subtitle: "Setiap laporan berarti. Pantau prosesnya, ikuti perkembangannya.", table: "Aduan saya" },
  SATGAS: { title: "Ringkasan penanganan", subtitle: "Prioritaskan aduan yang membutuhkan perhatian hari ini.", table: "Antrean aduan" },
  ADMIN: { title: "Ringkasan operasional", subtitle: "Pantau arus aduan dan progres penanganan dalam kewenangan Anda.", table: "Daftar aduan" },
};
const PAGE_SIZE = 8;
const colors = { HIGH: "#e77878", MEDIUM: "#e8b653", LOW: "#57ae88" };
function Metric({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: LucideIcon; tone: string }) {
  return <div className="metric"><div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium text-zinc-500">{label}</p><span className={`grid size-7 shrink-0 place-items-center rounded-md ${tone}`}><Icon size={15} strokeWidth={1.7} /></span></div><p className="metric-value">{value}</p><p className="mt-2 text-[10px] text-zinc-400">{note}</p></div>;
}

export function RoleDashboard({ role }: { role: SessionRole }) {
  const [rows, setRows] = useState<TicketMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState<TicketFilters>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [pending, setPending] = useState("");
  const [refreshed, setRefreshed] = useState<Date | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/aduan", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) { setError(data.message ?? "Daftar aduan belum dapat dimuat."); return; }
      setRows(data.items ?? []); setRefreshed(new Date());
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof SyntaxError ? "Respons layanan belum tersedia." : "Tidak dapat menghubungi server."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const setFilter = (key: keyof TicketFilters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const active = rows.filter((ticket) => !isTicketClosed(ticket.status));
  const waiting = rows.filter((ticket) => ticket.status === "MENUNGGU_TINDAK_LANJUT");
  const closed = rows.filter((ticket) => isTicketClosed(ticket.status));
  const high = active.filter((ticket) => ticket.riskBand === "HIGH");
  const sla = buildSlaSummary(rows);
  const risk = buildRiskDistribution(rows);
  const categories = buildCategoryDistribution(rows);
  const trend = useMemo(() => dailyTicketCounts(rows), [rows]);
  const filtered = useMemo(() => filterTickets(rows, filters), [rows, filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const isStaff = role !== "MAHASISWA";
  const activeFilters = filters.query || filters.status || filters.category || filters.risk || filters.period || filters.sort !== "newest";
  const maxTrend = Math.max(1, ...trend.map((item) => item.count));
  const date = refreshed ? new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(refreshed) : "";
  const riskAngle = (key: string) => (risk.find((slice) => slice.key === key)?.count ?? 0) / Math.max(1, rows.length) * 360;
  const highEnd = riskAngle("HIGH");
  const mediumEnd = highEnd + riskAngle("MEDIUM");

  function download() {
    const url = URL.createObjectURL(new Blob([ticketCsv(filtered)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `triase-${role.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function changeStatus(ticket: TicketMetadata, status: string) {
    setPending(ticket.ticketId); setNotice(""); setError("");
    try {
      const response = await fetch(`/api/aduan/${encodeURIComponent(ticket.ticketId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, expectedVersion: ticket.rowVersion }) });
      const data = await response.json();
      if (!response.ok) { setError(data.message ?? "Status belum dapat diperbarui."); if (response.status === 409) await load(); return; }
      setRows((current) => current.map((row) => row.ticketId === ticket.ticketId ? { ...row, status: data.status, updatedAt: data.updatedAt, rowVersion: data.rowVersion } : row));
      setNotice(`${ticket.ticketId}: ${formatTicketStatus(data.status)}.`);
    } catch { setError("Perubahan belum terkonfirmasi. Muat ulang sebelum mencoba lagi."); }
    finally { setPending(""); }
  }
  const tabs = [{ key: "all", label: "Semua", count: rows.length }, { key: "active", label: "Aktif", count: active.length }, { key: "waiting", label: "Tindak lanjut", count: waiting.length }, { key: "closed", label: "Tidak aktif", count: closed.length }];
  return <DashboardShell role={role} title={copy[role].title} subtitle={copy[role].subtitle} actions={<>
    <span className="hidden text-[11px] text-zinc-400 xl:mr-3 xl:inline">{date}</span><button onClick={() => void load()} disabled={loading} title="Muat ulang data" aria-label="Muat ulang data" className="ui-icon"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
    {role === "MAHASISWA" ? <Link href="/aduan/baru" className="ui-btn ui-btn-primary"><FilePlus2 size={15} />Buat aduan</Link> : <button onClick={download} disabled={loading || filtered.length === 0} className="ui-btn"><ArrowDownToLine size={15} />Ekspor CSV</button>}
  </>}>
    <div className="flex min-w-0 flex-col">
    {error && <div role="alert" className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none ui-alert mb-5"><ShieldAlert size={17} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
    {notice && <div role="status" className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none ui-alert ui-alert-success mb-5"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice("")} className="ml-auto" aria-label="Tutup pemberitahuan"><X size={15} /></button></div>}
    <div className="order-1 grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4" aria-busy={loading}>
      {loading && !refreshed ? Array.from({ length: 4 }, (_, index) => <div key={index} className="metric"><div className="h-3 w-24 animate-pulse rounded bg-zinc-100" /><div className="mt-6 h-7 w-14 animate-pulse rounded bg-zinc-100" /><div className="mt-4 h-2 w-32 animate-pulse rounded bg-zinc-100" /></div>) : <>
        <Metric label={role === "SATGAS" ? "Antrean aktif" : "Total aduan"} value={String(role === "SATGAS" ? active.length : rows.length)} note={role === "SATGAS" ? `${rows.length} aduan dalam kewenangan` : "Seluruh tiket yang dapat diakses"} icon={Inbox} tone="bg-blue-50 text-blue-600" />
        <Metric label={role === "MAHASISWA" ? "Dalam proses" : "Perlu tindak lanjut"} value={String(role === "MAHASISWA" ? active.length : waiting.length)} note={role === "MAHASISWA" ? "Sedang ditangani satuan tugas" : "Menunggu perkembangan penanganan"} icon={Clock3} tone="bg-amber-50 text-amber-600" />
        <Metric label={role === "ADMIN" ? "Risiko tinggi aktif" : "Tidak aktif"} value={String(role === "ADMIN" ? high.length : closed.length)} note={role === "ADMIN" ? "Memerlukan perhatian lebih" : "Selesai, ditutup, atau ditolak"} icon={role === "ADMIN" ? ShieldAlert : CheckCircle2} tone={role === "ADMIN" ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"} />
        <Metric label={role === "MAHASISWA" ? "Menunggu tindak lanjut" : "SLA penanganan"} value={role === "MAHASISWA" ? String(waiting.length) : sla.resolved ? `${sla.rate}%` : "-"} note={role === "MAHASISWA" ? "Pantau perkembangan percakapan" : sla.resolved ? `${sla.withinTarget} dari ${sla.resolved} tiket selesai tepat waktu` : "Belum ada tiket selesai"} icon={Activity} tone="bg-violet-50 text-violet-600" />
      </>}
    </div>

    <section id="analitik" aria-label="Analitik aduan" className="order-4 mt-6 grid min-w-0 scroll-mt-24 divide-y divide-zinc-100 border-y border-zinc-200 bg-white lg:order-2 lg:grid-cols-[1.3fr_1fr_1fr] lg:divide-x lg:divide-y-0">
      <div className="min-w-0 px-5 py-5"><div className="flex items-start justify-between gap-3"><div><h2 className="ui-section-title">Aktivitas pengajuan</h2><p className="mt-1 text-[10px] text-zinc-400">7 hari terakhir</p></div><span className="ui-tag">{trend.reduce((total, item) => total + item.count, 0)} aduan</span></div><div className="mt-5 flex h-[146px] items-end gap-2">{trend.map((item) => <div key={item.date} className="trend-column" title={`${item.date}: ${item.count} aduan`}><span className="text-[10px] tabular-nums text-zinc-400">{item.count}</span><div role="img" aria-label={`${item.date}: ${item.count} aduan`} className="trend-column-bar" style={{ height: `${Math.max(3, item.count / maxTrend * 84)}px`, backgroundColor: item.count === 0 ? "#e9efeb" : undefined }} /><span className="text-[10px] text-zinc-400">{item.label}</span></div>)}</div></div>
      <div className="min-w-0 px-5 py-5"><h2 className="ui-section-title">Profil risiko</h2><p className="mt-1 text-[10px] text-zinc-400">Komposisi seluruh aduan</p><div className="mt-6 flex flex-wrap items-center gap-5"><div className="grid size-[110px] shrink-0 place-items-center rounded-full" role="img" aria-label={`Risiko tinggi ${risk.find((r) => r.key === "HIGH")?.count ?? 0}, sedang ${risk.find((r) => r.key === "MEDIUM")?.count ?? 0}, rendah ${risk.find((r) => r.key === "LOW")?.count ?? 0}`} style={{ background: rows.length ? `conic-gradient(${colors.HIGH} 0deg ${highEnd}deg, ${colors.MEDIUM} ${highEnd}deg ${mediumEnd}deg, ${colors.LOW} ${mediumEnd}deg 360deg)` : "#edf1ee" }}><div className="grid size-[84px] content-center rounded-full bg-white text-center"><span className="text-2xl font-semibold">{rows.length}</span><span className="text-[9px] text-zinc-400">Total aduan</span></div></div><dl className="min-w-24 flex-1 space-y-3">{(["HIGH", "MEDIUM", "LOW"] as const).map((band) => <div key={band} className="flex items-center gap-2 text-[11px]"><span className="size-2 rounded-full" style={{ backgroundColor: colors[band] }} /><dt className="text-zinc-500">{formatRiskBand(band)}</dt><dd className="ml-auto font-semibold">{risk.find((slice) => slice.key === band)?.count ?? 0}</dd></div>)}</dl></div></div>
      <div className="min-w-0 px-5 py-5"><h2 className="ui-section-title">Kategori teratas</h2><p className="mt-1 text-[10px] text-zinc-400">Berdasarkan jumlah pengajuan</p>{categories.length ? <div className="mt-5 space-y-4">{categories.slice(0, 3).map((category) => <div key={category.key}><div className="flex justify-between gap-2 text-[11px]"><span className="truncate text-zinc-500">{category.label}</span><span className="shrink-0 font-semibold">{category.count}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-zinc-100"><div className="h-full origin-left bg-emerald-500/60" style={{ transform: `scaleX(${category.percent / 100})` }} /></div></div>)}</div> : <p className="mt-10 text-center text-xs text-zinc-400">Belum ada data kategori.</p>}</div>
    </section>

    {isStaff && sla.overdueOpen > 0 && <div className="order-2 mt-5 flex flex-wrap items-center gap-3 border-l-2 lg:order-3 border-amber-400 bg-amber-50/70 px-4 py-3 text-xs"><Clock3 size={16} className="text-amber-600" /><span className="text-amber-800"><strong>{sla.overdueOpen} aduan aktif</strong> sudah melewati target penanganan.</span><button onClick={() => { setFilters({ ...INITIAL_FILTERS, tab: "active", sort: "oldest" }); setPage(1); document.getElementById("aduan")?.scrollIntoView({ behavior: "smooth" }); }} className="ml-auto inline-flex items-center gap-1 font-semibold text-amber-800">Tinjau antrean<ArrowRight size={14} /></button></div>}

    <section id="aduan" className="order-3 mt-7 min-w-0 scroll-mt-24 lg:order-4" aria-labelledby="ticket-list-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><h2 id="ticket-list-title" className="ui-section-title">{copy[role].table}</h2><span className="ui-tag">{rows.length}</span></div>{role === "MAHASISWA" && <Link href="/aduan/lacak" className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">Lacak tiket<ArrowUpRight size={13} /></Link>}</div>
      <div role="group" aria-label="Kelompok status aduan" className="dashboard-tabs mt-2">{tabs.map((tab) => <button key={tab.key} type="button" id={`tab-${tab.key}`} aria-pressed={filters.tab === tab.key} aria-controls="ticket-panel" onClick={() => { setFilters((current) => ({ ...current, tab: tab.key, status: "" })); setPage(1); }} className="dashboard-tab">{tab.label}<span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-400">{tab.count}</span></button>)}</div>
      <div id="ticket-panel" aria-labelledby={`tab-${filters.tab}`}>
        <div className="flex flex-wrap items-center gap-3 py-4"><label className="relative min-w-0 flex-1 basis-52"><Search size={15} className="pointer-events-none absolute left-3 top-3.5 text-zinc-400" /><span className="sr-only">Cari aduan</span><input className="ui-input pl-9" placeholder="Cari nomor tiket, judul, atau pseudonim..." value={filters.query} onChange={(event) => setFilter("query", event.target.value)} /></label><label><span className="sr-only">Urutkan aduan</span><select value={filters.sort} onChange={(event) => setFilter("sort", event.target.value)} className="ui-input min-w-[146px]"><option value="newest">Terbaru</option><option value="oldest">Terlama</option><option value="risk">Risiko tertinggi</option></select></label><button aria-expanded={advanced} aria-controls="ticket-filters" onClick={() => setAdvanced(!advanced)} className={`ui-btn ${advanced ? "border-emerald-300 bg-emerald-50 text-emerald-700" : ""}`}><SlidersHorizontal size={14} />Filter</button>{activeFilters && <button className="ui-icon" onClick={() => { setFilters((current) => ({ ...INITIAL_FILTERS, tab: current.tab })); setPage(1); }} title="Hapus filter" aria-label="Hapus filter"><X size={14} /></button>}</div>
        {advanced && <div id="ticket-filters" className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none mb-4 grid gap-3 border-b border-zinc-200 pb-4 sm:grid-cols-2 xl:grid-cols-4">{[
          { key: "status", label: "Status", options: ADUAN_STATUS.map((key) => ({ key, label: formatTicketStatus(key) })) },
          { key: "category", label: "Kategori", options: ADUAN_CATEGORY.map((key) => ({ key, label: formatTicketCategory(key) })) },
          { key: "risk", label: "Risiko", options: ["HIGH", "MEDIUM", "LOW"].map((key) => ({ key, label: formatRiskBand(key) })) },
          { key: "period", label: "Waktu pengajuan", options: [{ key: "7", label: "7 hari terakhir" }, { key: "30", label: "30 hari terakhir" }, { key: "90", label: "90 hari terakhir" }] },
        ].map((filter) => <label key={filter.key}><span className="ui-label">{filter.label}</span><select className="ui-input" value={filters[filter.key as keyof TicketFilters]} onChange={(event) => setFilter(filter.key as keyof TicketFilters, event.target.value)}><option value="">Semua</option>{filter.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>)}</div>}
        <div className="overflow-x-auto border-y border-zinc-200 bg-white" aria-busy={loading}>
          <table className="ticket-table min-w-[720px]"><thead><tr><th>Tiket & aduan</th><th>Kategori</th><th>Status</th><th>Risiko</th><th>Diperbarui</th><th className="text-right">{isStaff ? "Penanganan" : ""}</th></tr></thead><tbody>
            {loading && !refreshed ? Array.from({ length: 4 }, (_, i) => <tr key={i}>{Array.from({ length: 6 }, (_, j) => <td key={j}><div className="h-3 w-20 animate-pulse rounded bg-zinc-100" /></td>)}</tr>) : visible.map((ticket) => <tr key={ticket.ticketId}><td><Link href={`/aduan/${ticket.ticketId}`} className="block max-w-64"><span className="font-mono text-[10px] font-medium text-emerald-700">{ticket.ticketId}</span><span className="mt-1.5 block truncate font-medium text-zinc-700">{ticket.subject}</span>{isStaff && <span className="mt-1 block text-[9px] text-zinc-400">{ticket.pseudonym}</span>}</Link></td><td className="text-zinc-500">{formatTicketCategory(ticket.category)}</td><td><StatusPill status={ticket.status} label={formatTicketStatus(ticket.status)} /></td><td><RiskPill riskBand={ticket.riskBand} label={formatRiskBand(ticket.riskBand)} /></td><td className="whitespace-nowrap text-[10px] text-zinc-400"><time dateTime={ticket.updatedAt} title={new Date(ticket.updatedAt).toLocaleString("id-ID")}>{formatRelativeTime(ticket.updatedAt)}</time>{isStaff && !isTicketClosed(ticket.status) && Date.now() - Date.parse(ticket.createdAt) > (SLA_TARGET_DAYS[ticket.riskBand] ?? 7) * 86400000 && <span className="mt-1 block text-amber-600">Lewat target</span>}</td><td><div className="flex items-center justify-end gap-2">{isStaff && STATUS_TRANSITIONS[ticket.status].length > 0 && <select aria-label={`Ubah status ${ticket.ticketId}`} value="" disabled={!!pending} onChange={(event) => void changeStatus(ticket, event.target.value)} className="max-w-[150px] rounded border border-zinc-200 bg-white px-2 py-2 text-[10px] text-zinc-600"><option value="">{pending === ticket.ticketId ? "Menyimpan..." : "Ubah status"}</option>{STATUS_TRANSITIONS[ticket.status].map((status) => <option key={status} value={status}>{formatTicketStatus(status)}</option>)}</select>}<Link href={`/aduan/${ticket.ticketId}`} className="ui-icon size-8" title="Buka detail aduan" aria-label={`Buka detail ${ticket.ticketId}`}><ArrowUpRight size={14} /></Link></div></td></tr>)}
          </tbody></table>
          {!loading && !error && visible.length === 0 && <div className="flex flex-col items-center px-5 py-12 text-center"><span className="mb-3 grid size-12 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Ticket size={23} strokeWidth={1.4} /></span><h3 className="text-sm font-semibold">{rows.length ? "Tidak ada aduan yang cocok" : "Belum ada aduan"}</h3><p className="mt-2 max-w-sm text-xs leading-6 text-zinc-400">{rows.length ? "Coba kata pencarian atau pilihan filter lainnya." : role === "MAHASISWA" ? "Aduan yang Anda kirim akan tampil di sini." : "Antrean akan terisi saat aduan tersedia dalam kewenangan Anda."}</p>{role === "MAHASISWA" && !rows.length && <Link href="/aduan/baru" className="ui-btn ui-btn-primary mt-5"><FilePlus2 size={14} />Buat aduan pertama</Link>}</div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-4"><p className="text-[10px] text-zinc-400">{filtered.length ? `${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(currentPage * PAGE_SIZE, filtered.length)} dari ${filtered.length} aduan` : "0 aduan"}{loading && refreshed && <Loader2 size={12} className="ml-2 inline animate-spin" />}</p><div className="flex items-center gap-3"><button className="ui-icon size-8" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} title="Halaman sebelumnya" aria-label="Halaman sebelumnya"><ChevronLeft size={15} /></button><span className="text-[11px] tabular-nums text-zinc-500">{currentPage} / {pages}</span><button className="ui-icon size-8" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} title="Halaman berikutnya" aria-label="Halaman berikutnya"><ChevronRight size={15} /></button></div></div>
      </div>
    </section>
    </div>
  </DashboardShell>;
}
