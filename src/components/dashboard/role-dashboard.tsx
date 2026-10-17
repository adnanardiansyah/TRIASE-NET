"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, FilePlus2, Inbox, LayoutGrid, List, Link2, Loader2, ShieldCheck, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Ticket, X, type LucideIcon } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { RiskPill, StatusPill } from "./pill";
import type { SessionRole } from "@/lib/auth/jwt";
import type { TicketMetadata } from "@/lib/ticket-types";
import { ADUAN_CATEGORY, ADUAN_STATUS } from "@/lib/domain/enums";
import { STATUS_TRANSITIONS } from "@/lib/ticket-workflow";
import { INITIAL_FILTERS, filterTickets, isTicketClosed, ticketCsv, type TicketFilters } from "@/lib/dashboard-view";
import { buildSlaSummary, formatRelativeTime, formatRiskBand, formatTicketCategory, formatTicketStatus } from "@/lib/dashboard-aggregates";

import { TicketDeadline } from "@/components/ticket-deadline";
import { Reveal, RevealGroup } from "@/components/reveal";
import { readDashboardLocation, writeDashboardLocation, type TicketView } from "@/lib/dashboard-location";
import { DashboardOverview } from "./dashboard-overview";
import { DashboardAnalytics } from "./dashboard-analytics";
import { dashboardPaths, dashboardTicketLink, legacyDashboardDestination, type DashboardSection } from "@/lib/dashboard-routes";
import { ticketSlaState } from "@/lib/ticket-sla";

const copy = {
  MAHASISWA: { title: "Ruang aduan saya", subtitle: "Setiap laporan berarti. Pantau prosesnya, ikuti perkembangannya.", table: "Aduan saya" },
  SATGAS: { title: "Ringkasan penanganan", subtitle: "Prioritaskan aduan yang membutuhkan perhatian hari ini.", table: "Antrean aduan" },
  ADMIN: { title: "Ringkasan operasional", subtitle: "Pantau arus aduan dan progres penanganan dalam kewenangan Anda.", table: "Daftar aduan" },
};
const PAGE_SIZE = 8;
function Metric({ label, value, note, icon: Icon, tone, href }: { label: string; value: string; note: string; icon: LucideIcon; tone: string; href: string }) {
  return <Link href={href} className="metric dashboard-metric-link"><div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium text-zinc-500">{label}</p><span className={`grid size-7 shrink-0 place-items-center rounded-md ${tone}`}><Icon size={15} strokeWidth={1.7} /></span></div><p className="metric-value">{value}</p><p className="mt-2 text-[10px] text-zinc-400">{note}</p></Link>;
}

export function RoleDashboard({ role, section = "overview" }: { role: SessionRole; section?: DashboardSection }) {
  const paths = dashboardPaths(role);
  const heading = section === "tickets" ? { title: copy[role].table, subtitle: "Cari, saring, dan ikuti setiap aduan dalam kewenangan Anda." } : section === "analytics" ? { title: role === "MAHASISWA" ? "Analitik pribadi" : role === "SATGAS" ? "Analitik penanganan" : "Analitik operasional", subtitle: "Telusuri aktivitas pengajuan, status, kategori, dan target penanganan." } : copy[role];
  useEffect(() => {
    if (section !== "overview") return;
    let redirecting = false;
    const redirectLegacy = () => {
      const destination = legacyDashboardDestination(role, window.location.hash, window.location.search);
      if (destination && !redirecting) { redirecting = true; window.location.replace(destination); }
    };
    redirectLegacy();
    const frame = requestAnimationFrame(redirectLegacy);
    window.addEventListener("hashchange", redirectLegacy);
    window.addEventListener("popstate", redirectLegacy);
    window.addEventListener("pageshow", redirectLegacy);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", redirectLegacy); window.removeEventListener("popstate", redirectLegacy); window.removeEventListener("pageshow", redirectLegacy); };
  }, [role, section]);
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => { setClock(Date.now()); const timer = setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const [rows, setRows] = useState<TicketMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState<TicketFilters>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [view, setView] = useState<TicketView>("table");
  const [locationReady, setLocationReady] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const restore = () => {
      const location = readDashboardLocation(new URLSearchParams(window.location.search), role !== "MAHASISWA");
      setFilters(location.filters); setView(location.view); setPage(1);
      setAdvanced(!!(location.filters.status || location.filters.category || location.filters.risk || location.filters.period));
      setLocationReady(true);
    };
    restore(); window.addEventListener("popstate", restore);
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || target instanceof HTMLElement && (target.isContentEditable || target.closest("input,textarea,select,[role=dialog]")) || document.querySelector('[role="dialog"]')) return;
      event.preventDefault(); searchInput.current?.focus();
    };
    window.addEventListener("keydown", shortcut);
    return () => { window.removeEventListener("popstate", restore); window.removeEventListener("keydown", shortcut); };
  }, [role, section]);
  useEffect(() => {
    if (!locationReady || section === "overview") return;
    const params = writeDashboardLocation(new URLSearchParams(window.location.search), filters, view).toString();
    const next = window.location.pathname + (params ? `?${params}` : "") + window.location.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", next);
  }, [filters, view, locationReady, section]);
  const [pending, setPending] = useState("");
  const [refreshed, setRefreshed] = useState<Date | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(""); setLoadStatus(null);
    try {
      const response = await fetch("/api/aduan", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) { setLoadStatus(response.status); setError(data.message ?? "Daftar aduan belum dapat dimuat."); return; }
      setRows(data.items ?? []); setRefreshed(new Date());
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof SyntaxError ? "Respons layanan belum tersedia." : "Tidak dapat menghubungi server."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const setFilter = (key: keyof TicketFilters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const now = clock ?? refreshed?.getTime() ?? 0;
  const filtered = useMemo(() => filterTickets(rows, filters, now), [rows, filters, now]);
  const summaryRows = section === "analytics" ? filtered : rows;
  const active = summaryRows.filter((ticket) => !isTicketClosed(ticket.status));
  const waiting = summaryRows.filter((ticket) => ticket.status === "MENUNGGU_TINDAK_LANJUT");
  const closed = summaryRows.filter((ticket) => isTicketClosed(ticket.status));
  const high = active.filter((ticket) => ticket.riskBand === "HIGH");
  const sla = buildSlaSummary(summaryRows, new Date(now));
  const dueSoon = active.filter((ticket) => ticketSlaState(ticket, now) === "DUE_SOON");
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const isStaff = role !== "MAHASISWA";
  const activeFilters = filters.query || filters.status || filters.category || filters.risk || filters.period || filters.sort !== "newest";
  const analyticsParams = section === "analytics" ? writeDashboardLocation(new URLSearchParams(), filters, "table").toString() : "";
  const slaHref = paths.analytics + (analyticsParams ? `?${analyticsParams}` : "") + "#target-penanganan";
  const date = refreshed ? new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(refreshed) : "";
  async function shareFilters() {
    const params = writeDashboardLocation(new URLSearchParams(window.location.search), filters, view);
    const url = new URL(window.location.pathname, window.location.origin);
    url.search = params.toString(); url.hash = "";
    try { await navigator.clipboard.writeText(url.toString()); setNotice("Tautan filter disalin. Kata pencarian tidak disertakan; akses tetap sesuai akun penerima."); }
    catch { setNotice("Salin tautan dari bilah alamat browser. Filter tersimpan pada URL; kata pencarian tidak disertakan."); }
  }
  function ticketActions(ticket: TicketMetadata) {
    return <div className="flex items-center justify-end gap-2">{isStaff && STATUS_TRANSITIONS[ticket.status].length > 0 && <select aria-label={`Ubah status ${ticket.ticketId}`} value="" disabled={!!pending || loading || !!error} onChange={(event) => void changeStatus(ticket, event.target.value)} className="max-w-[150px] rounded border border-zinc-200 bg-white px-2 py-2 text-[10px] text-zinc-600"><option value="">{pending === ticket.ticketId ? "Menyimpan..." : "Ubah status"}</option>{STATUS_TRANSITIONS[ticket.status].map((status) => <option key={status} value={status}>{formatTicketStatus(status)}</option>)}</select>}<Link href={`/aduan/${ticket.ticketId}`} className="ui-icon" title="Buka detail aduan" aria-label={`Buka detail ${ticket.ticketId}`}><ArrowUpRight size={14} /></Link></div>;
  }
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
      window.dispatchEvent(new Event("triase:ticket-updated"));
      setNotice(`${ticket.ticketId}: ${formatTicketStatus(data.status)}.`);
    } catch { setError("Perubahan belum terkonfirmasi. Muat ulang sebelum mencoba lagi."); }
    finally { setPending(""); }
  }
  const tabs = [{ key: "all", label: "Semua", count: rows.length }, { key: "active", label: "Aktif", count: active.length }, { key: "waiting", label: "Tindak lanjut", count: waiting.length }, { key: "closed", label: "Tidak aktif", count: closed.length }, ...(isStaff ? [{ key: "dueSoon", label: "Mendekati tenggat", count: dueSoon.length }, { key: "overdue", label: "Lewat target", count: sla.overdueOpen }] : [])];
  return <DashboardShell role={role} title={heading.title} subtitle={heading.subtitle} actions={<>
    <span className="hidden text-[11px] text-zinc-400 xl:mr-3 xl:inline">{date}</span><button onClick={() => void load()} disabled={loading} title="Muat ulang data" aria-label="Muat ulang data" className="ui-icon"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
    {role === "MAHASISWA" ? <Link href="/aduan/baru" className="ui-btn ui-btn-primary"><FilePlus2 size={15} />Buat aduan</Link> : section !== "overview" ? <button onClick={download} disabled={loading || !!error || filtered.length === 0} className="ui-btn"><ArrowDownToLine size={15} />Ekspor CSV</button> : <Link href={paths.tickets} className="ui-btn ui-btn-primary"><Inbox size={15} />Lihat aduan</Link>}
  </>}>
    <div data-dashboard-section={section} className="dashboard-content flex min-w-0 flex-col">
    {section === "overview" && <>
    <Reveal trigger="mount" distance={18} duration={0.6} className="dashboard-welcome">
      <div><span className="dashboard-overline">TRIASE-Net / Ruang kerja Anda</span><h2>{isStaff ? "Fokus pada hal yang berarti." : "Dari suara, menjadi perubahan."}</h2><p>{isStaff ? "Tinjau antrean, pantau target, dan ikuti setiap perkembangan penanganan." : "Satu tempat untuk menyampaikan aduan dan mengikuti setiap perkembangannya."}</p><div className="dashboard-welcome-links">{isStaff ? <Link href={dashboardTicketLink(role, { tab: "active" })}>Tinjau aduan aktif<ArrowUpRight size={15} /></Link> : <Link href="/aduan/baru">Sampaikan aduan<ArrowUpRight size={15} /></Link>}<Link href={paths.analytics}>Lihat analitik<ArrowRight size={15} /></Link></div></div>
      <div className="dashboard-welcome-art" aria-hidden="true"><span /><ShieldCheck size={62} strokeWidth={1} /><span /></div>
    </Reveal>
    <RevealGroup trigger="mount" stagger={0.07} className="dashboard-shortcuts">{[
      { icon: isStaff ? Inbox : FilePlus2, label: isStaff ? "Antrean aduan" : "Buat aduan", note: isStaff ? "Tinjau aduan dalam kewenangan" : "Ceritakan persoalan kampus", href: isStaff ? paths.tickets : "/aduan/baru" },
      { icon: isStaff ? Activity : Search, label: isStaff ? "Analitik penanganan" : "Lacak tiket", note: isStaff ? "Lihat aktivitas dan profil risiko" : "Ikuti progres penanganan", href: isStaff ? paths.analytics : "/aduan/lacak" },
      { icon: ShieldCheck, label: "Privasi & bantuan", note: "Kenali perlindungan layanan", href: "/#privasi" },
    ].map((item) => <Reveal key={item.label} distance={16} duration={0.5}><Link href={item.href} className="dashboard-shortcut"><span><item.icon size={19} strokeWidth={1.5} /></span><div><strong>{item.label}</strong><p>{item.note}</p></div><ArrowUpRight size={14} /></Link></Reveal>)}</RevealGroup></>}
    {error && <div role="alert" className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none ui-alert mb-5"><ShieldAlert size={17} className="mt-0.5 shrink-0" /><span>{error}</span><button type="button" onClick={() => void load()} disabled={loading} className="ml-auto font-semibold">Coba lagi</button></div>}
    {loadStatus === 403 && <p className="mb-5 text-xs leading-6 text-zinc-600">Akses data memerlukan kewenangan, status tugas, dan mandat yang masih berlaku. Periksa informasi akun Anda atau hubungi pengelola layanan.</p>}
    {notice && <div role="status" className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none ui-alert ui-alert-success mb-5"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice("")} className="ml-auto" aria-label="Tutup pemberitahuan"><X size={15} /></button></div>}
    {(!error || refreshed && loadStatus !== 403 && loadStatus !== 401) && <>
    {section !== "tickets" && <div className="dashboard-metrics order-1 grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4" aria-busy={loading}>
      {loading && !refreshed ? Array.from({ length: 4 }, (_, index) => <div key={index} className="metric"><div className="h-3 w-24 animate-pulse rounded bg-zinc-100" /><div className="mt-6 h-7 w-14 animate-pulse rounded bg-zinc-100" /><div className="mt-4 h-2 w-32 animate-pulse rounded bg-zinc-100" /></div>) : <>
        <Metric href={dashboardTicketLink(role, { ...(section === "analytics" ? filters : {}), tab: role === "SATGAS" ? "active" : "all" })} label={role === "SATGAS" ? "Antrean aktif" : "Total aduan"} value={String(role === "SATGAS" ? active.length : summaryRows.length)} note={role === "SATGAS" ? `${summaryRows.length} aduan dalam kewenangan` : section === "analytics" ? "Aduan sesuai filter terpilih" : "Seluruh tiket yang dapat diakses"} icon={Inbox} tone="bg-blue-50 text-blue-600" />
        <Metric href={dashboardTicketLink(role, { ...(section === "analytics" ? filters : {}), tab: role === "MAHASISWA" ? "active" : "waiting" })} label={role === "MAHASISWA" ? "Dalam proses" : "Perlu tindak lanjut"} value={String(role === "MAHASISWA" ? active.length : waiting.length)} note={role === "MAHASISWA" ? "Sedang ditangani satuan tugas" : "Menunggu perkembangan penanganan"} icon={Clock3} tone="bg-amber-50 text-amber-600" />
        <Metric href={dashboardTicketLink(role, { ...(section === "analytics" ? filters : {}), tab: role === "ADMIN" ? "active" : "closed", ...(role === "ADMIN" ? { risk: "HIGH" } : {}) })} label={role === "ADMIN" ? "Risiko tinggi aktif" : "Tidak aktif"} value={String(role === "ADMIN" ? high.length : closed.length)} note={role === "ADMIN" ? "Memerlukan perhatian lebih" : "Selesai, ditutup, atau ditolak"} icon={role === "ADMIN" ? ShieldAlert : CheckCircle2} tone={role === "ADMIN" ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"} />
        <Metric href={role === "MAHASISWA" ? dashboardTicketLink(role, { ...(section === "analytics" ? filters : {}), tab: "waiting" }) : slaHref} label={role === "MAHASISWA" ? "Menunggu tindak lanjut" : "SLA penanganan"} value={role === "MAHASISWA" ? String(waiting.length) : sla.resolved ? `${sla.rate}%` : "-"} note={role === "MAHASISWA" ? "Pantau perkembangan percakapan" : sla.resolved ? `${sla.withinTarget} dari ${sla.resolved} tiket selesai tepat waktu` : "Belum ada tiket selesai"} icon={Activity} tone="bg-violet-50 text-violet-600" />
      </>}
    </div>}

    {section === "overview" && <DashboardOverview role={role} rows={rows} now={now} loading={loading} />}
    {section === "analytics" && <DashboardAnalytics role={role} rows={filtered} now={now} filters={filters} onFilter={setFilter} onReset={() => { setFilters({ ...INITIAL_FILTERS }); setPage(1); }} loading={loading} />}

    {isStaff && sla.overdueOpen > 0 && <div className="order-2 mt-5 flex flex-wrap items-center gap-3 border-l-2 lg:order-3 border-amber-400 bg-amber-50/70 px-4 py-3 text-xs"><Clock3 size={16} className="text-amber-600" /><span className="text-amber-800"><strong>{sla.overdueOpen} aduan aktif</strong> sudah melewati target penanganan.</span><Link href={dashboardTicketLink(role, { tab: "overdue", sort: "deadline" })} className="ml-auto inline-flex items-center gap-1 font-semibold text-amber-800">Tinjau antrean<ArrowRight size={14} /></Link></div>}

    {section === "tickets" && <section id="aduan" className="dashboard-tickets order-3 mt-7 min-w-0 scroll-mt-24 lg:order-4" aria-labelledby="ticket-list-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><h2 id="ticket-list-title" className="ui-section-title">{copy[role].table}</h2><span className="ui-tag">{rows.length}</span></div>{role === "MAHASISWA" && <Link href="/aduan/lacak" className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">Lacak tiket<ArrowUpRight size={13} /></Link>}</div>
      <div role="group" aria-label="Kelompok status aduan" className="dashboard-tabs mt-2">{tabs.map((tab) => <button key={tab.key} type="button" id={`tab-${tab.key}`} aria-pressed={filters.tab === tab.key} aria-controls="ticket-panel" onClick={() => { setFilters((current) => ({ ...current, tab: tab.key, status: "" })); setPage(1); }} className="dashboard-tab">{tab.label}<span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-400">{tab.count}</span></button>)}</div>
      <div id="ticket-panel" aria-labelledby={`tab-${filters.tab}`}>
        <div className="flex flex-wrap items-center gap-3 py-4"><label className="relative min-w-0 flex-1 basis-52"><Search size={15} className="pointer-events-none absolute left-3 top-3.5 text-zinc-400" /><span className="sr-only">Cari aduan</span><input ref={searchInput} className="ui-input pl-9" placeholder="Cari nomor tiket, judul, atau pseudonim..." value={filters.query} onChange={(event) => setFilter("query", event.target.value)} /></label><label><span className="sr-only">Urutkan aduan</span><select value={filters.sort} onChange={(event) => setFilter("sort", event.target.value)} className="ui-input min-w-[146px]"><option value="newest">Terbaru</option><option value="oldest">Terlama</option><option value="risk">Risiko tertinggi</option><option value="deadline">Tenggat terdekat</option></select></label><button aria-expanded={advanced} aria-controls="ticket-filters" onClick={() => setAdvanced(!advanced)} className={`ui-btn ${advanced ? "border-emerald-300 bg-emerald-50 text-emerald-700" : ""}`}><SlidersHorizontal size={14} />Filter</button>{activeFilters && <button className="ui-icon" onClick={() => { setFilters((current) => ({ ...INITIAL_FILTERS, tab: current.tab })); setPage(1); }} title="Hapus filter" aria-label="Hapus filter"><X size={14} /></button>}</div>
        {advanced && <div id="ticket-filters" className="animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none mb-4 grid gap-3 border-b border-zinc-200 pb-4 sm:grid-cols-2 xl:grid-cols-4">{[
          { key: "status", label: "Status", options: ADUAN_STATUS.map((key) => ({ key, label: formatTicketStatus(key) })) },
          { key: "category", label: "Kategori", options: ADUAN_CATEGORY.map((key) => ({ key, label: formatTicketCategory(key) })) },
          { key: "risk", label: "Risiko", options: ["HIGH", "MEDIUM", "LOW"].map((key) => ({ key, label: formatRiskBand(key) })) },
          { key: "period", label: "Waktu pengajuan", options: [{ key: "7", label: "7 hari terakhir" }, { key: "30", label: "30 hari terakhir" }, { key: "90", label: "90 hari terakhir" }] },
        ].map((filter) => <label key={filter.key}><span className="ui-label">{filter.label}</span><select className="ui-input" value={filters[filter.key as keyof TicketFilters]} onChange={(event) => setFilter(filter.key as keyof TicketFilters, event.target.value)}><option value="">Semua</option>{filter.options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>)}</div>}
        <div className="dashboard-list-tools"><div role="group" aria-label="Tampilan daftar aduan" className="dashboard-view-toggle"><button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}><List size={15} />Tabel</button><button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}><LayoutGrid size={15} />Kartu</button></div><button type="button" className="ui-btn" onClick={() => void shareFilters()}><Link2 size={14} />Bagikan filter</button></div>
        <div className="dashboard-active-filters" aria-label="Filter aktif">{([
          ["query", filters.query ? `Cari: ${filters.query}` : ""], ["category", filters.category ? formatTicketCategory(filters.category) : ""], ["status", filters.status ? formatTicketStatus(filters.status) : ""], ["risk", filters.risk ? `Risiko ${formatRiskBand(filters.risk)}` : ""], ["period", filters.period ? `${filters.period} hari terakhir` : ""],
        ] as const).filter(([, label]) => label).map(([key, label]) => <button key={key} type="button" onClick={() => setFilter(key, "")} aria-label={`Hapus filter ${label}`}>{label}<X size={12} /></button>)}</div>
        <div className={`dashboard-ticket-results ${view === "cards" ? "dashboard-cards-mode" : "overflow-x-auto"} border-y border-zinc-200 bg-white`} aria-busy={loading}>
          {view === "cards" && <div className="dashboard-ticket-grid">{loading && !refreshed ? <p role="status" className="p-5 text-sm text-zinc-500">Memuat aduan...</p> : visible.map((ticket) => <article key={ticket.ticketId} className="dashboard-ticket-card"><div className="dashboard-ticket-card-top"><span className="font-mono text-xs text-emerald-700">{ticket.ticketId}</span><StatusPill status={ticket.status} label={formatTicketStatus(ticket.status)} /></div><h3><Link href={`/aduan/${ticket.ticketId}`}>{ticket.subject}</Link></h3><p>{formatTicketCategory(ticket.category)}{isStaff && <span> / {ticket.pseudonym}</span>}</p><div className="dashboard-ticket-card-meta"><RiskPill riskBand={ticket.riskBand} label={formatRiskBand(ticket.riskBand)} /><TicketDeadline ticket={ticket} /></div><div className="dashboard-ticket-card-bottom"><time dateTime={ticket.updatedAt}>{formatRelativeTime(ticket.updatedAt)}</time>{ticketActions(ticket)}</div></article>)}</div>}
          <div hidden={view !== "table"}>
          <table className="ticket-table min-w-[720px]"><thead><tr><th>Tiket & aduan</th><th>Kategori</th><th>Status</th><th>Risiko</th><th>Diperbarui / target</th><th className="text-right">{isStaff ? "Penanganan" : ""}</th></tr></thead><tbody>
            {loading && !refreshed ? Array.from({ length: 4 }, (_, i) => <tr key={i}>{Array.from({ length: 6 }, (_, j) => <td key={j}><div className="h-3 w-20 animate-pulse rounded bg-zinc-100" /></td>)}</tr>) : visible.map((ticket) => <tr key={ticket.ticketId}><td><Link href={`/aduan/${ticket.ticketId}`} className="block max-w-64"><span className="font-mono text-[10px] font-medium text-emerald-700">{ticket.ticketId}</span><span className="mt-1.5 block truncate font-medium text-zinc-700">{ticket.subject}</span>{isStaff && <span className="mt-1 block text-[9px] text-zinc-400">{ticket.pseudonym}</span>}</Link></td><td className="text-zinc-500">{formatTicketCategory(ticket.category)}</td><td><StatusPill status={ticket.status} label={formatTicketStatus(ticket.status)} /></td><td><RiskPill riskBand={ticket.riskBand} label={formatRiskBand(ticket.riskBand)} /></td><td className="whitespace-nowrap text-[10px] text-zinc-400"><time dateTime={ticket.updatedAt} title={new Date(ticket.updatedAt).toLocaleString("id-ID")}>{formatRelativeTime(ticket.updatedAt)}</time><TicketDeadline ticket={ticket} /></td><td>{ticketActions(ticket)}</td></tr>)}
          </tbody></table></div>
          {!loading && !error && visible.length === 0 && <div className="flex flex-col items-center px-5 py-12 text-center"><span className="mb-3 grid size-12 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Ticket size={23} strokeWidth={1.4} /></span><h3 className="text-sm font-semibold">{rows.length ? "Tidak ada aduan yang cocok" : "Belum ada aduan"}</h3><p className="mt-2 max-w-sm text-xs leading-6 text-zinc-400">{rows.length ? "Coba kata pencarian atau pilihan filter lainnya." : role === "MAHASISWA" ? "Aduan yang Anda kirim akan tampil di sini." : "Antrean akan terisi saat aduan tersedia dalam kewenangan Anda."}</p>{role === "MAHASISWA" && !rows.length && <Link href="/aduan/baru" className="ui-btn ui-btn-primary mt-5"><FilePlus2 size={14} />Buat aduan pertama</Link>}</div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-4"><p className="text-[10px] text-zinc-400">{filtered.length ? `${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(currentPage * PAGE_SIZE, filtered.length)} dari ${filtered.length} aduan` : "0 aduan"}{loading && refreshed && <Loader2 size={12} className="ml-2 inline animate-spin" />}</p><div className="flex items-center gap-3"><button className="ui-icon size-8" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} title="Halaman sebelumnya" aria-label="Halaman sebelumnya"><ChevronLeft size={15} /></button><span className="text-[11px] tabular-nums text-zinc-500">{currentPage} / {pages}</span><button className="ui-icon size-8" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} title="Halaman berikutnya" aria-label="Halaman berikutnya"><ChevronRight size={15} /></button></div></div>
      </div>
    </section>}
    </>}
    </div>
  </DashboardShell>;
}
