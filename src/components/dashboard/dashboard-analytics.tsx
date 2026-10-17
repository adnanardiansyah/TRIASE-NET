"use client";

import Link from "next/link";
import { ArrowUpRight, BarChart3, CheckCircle2, Clock3, X } from "lucide-react";
import type { SessionRole } from "@/lib/auth/jwt";
import type { TicketMetadata } from "@/lib/ticket-types";
import type { TicketFilters } from "@/lib/dashboard-view";
import { dailyTicketCounts } from "@/lib/dashboard-view";
import { buildCategoryDistribution, buildRiskDistribution, buildSlaSummary, buildStatusDistribution, formatRiskBand } from "@/lib/dashboard-aggregates";
import { dashboardTicketLink } from "@/lib/dashboard-routes";
import { ADUAN_CATEGORY } from "@/lib/domain/enums";
import { formatTicketCategory } from "@/lib/dashboard-aggregates";

const colors = { HIGH: "#db8080", MEDIUM: "#d3aa51", LOW: "#57ae88" };
export function DashboardAnalytics({ role, rows, now, filters, onFilter, onReset, loading }: {
  role: SessionRole; rows: TicketMetadata[]; now: number; filters: TicketFilters;
  onFilter: (key: keyof TicketFilters, value: string) => void; onReset: () => void; loading: boolean;
}) {
  if (loading && !rows.length) return <section className="dashboard-chart-panel dashboard-analytics-page" aria-busy="true"><p role="status" className="dashboard-analysis-note">Memuat analitik aduan...</p><div className="h-48 animate-pulse rounded-xl bg-emerald-50 motion-reduce:animate-none" /></section>;
  const days = Number(filters.period) || 7;
  const trend = dailyTicketCounts(rows, new Date(now), days);
  const categories = buildCategoryDistribution(rows);
  const risks = buildRiskDistribution(rows);
  const statuses = buildStatusDistribution(rows);
  const sla = buildSlaSummary(rows, new Date(now));
  const max = Math.max(1, ...trend.map(item => item.count));
  const high = (risks.find(item => item.key === "HIGH")?.count ?? 0) / Math.max(1, rows.length) * 360;
  const medium = high + (risks.find(item => item.key === "MEDIUM")?.count ?? 0) / Math.max(1, rows.length) * 360;
  const drill = (extra: Partial<TicketFilters>) => dashboardTicketLink(role, { ...filters, ...extra });
  return <div className="dashboard-analytics-page" aria-busy={loading}>
    <div className="dashboard-analysis-controls">
      <div><label className="ui-label" htmlFor="analysis-period">Waktu pengajuan</label><select id="analysis-period" className="ui-input" value={filters.period} onChange={e => onFilter("period", e.target.value)}><option value="">Seluruh waktu</option><option value="7">7 hari terakhir</option><option value="30">30 hari terakhir</option><option value="90">90 hari terakhir</option></select></div>
      <div><label className="ui-label" htmlFor="analysis-category">Kategori</label><select id="analysis-category" className="ui-input" value={filters.category} onChange={e => onFilter("category", e.target.value)}><option value="">Semua kategori</option>{ADUAN_CATEGORY.map(key => <option key={key} value={key}>{formatTicketCategory(key)}</option>)}</select></div>
      <div><label className="ui-label" htmlFor="analysis-risk">Risiko</label><select id="analysis-risk" className="ui-input" value={filters.risk} onChange={e => onFilter("risk", e.target.value)}><option value="">Semua risiko</option>{["HIGH", "MEDIUM", "LOW"].map(key => <option key={key} value={key}>{formatRiskBand(key)}</option>)}</select></div>
      <button type="button" onClick={onReset} className="ui-btn">Reset filter</button>
      <Link className="ui-btn" href={drill({})}>Lihat aduan terfilter<ArrowUpRight size={14} /></Link>
    </div>
    {filters.tab !== "all" && <div className="dashboard-active-filters"><button onClick={() => onFilter("tab", "all")}>Kelompok status terfilter<X size={12} /></button></div>}
    {filters.status && <div className="dashboard-active-filters"><button onClick={() => onFilter("status", "")}>Hapus filter status<X size={12} /></button></div>}
    {loading ? <p role="status" className="dashboard-analysis-note">Memperbarui analitik...</p> : <p className="dashboard-analysis-note">{rows.length} aduan sesuai filter. Ringkasan berdasarkan waktu pengajuan; pilih kategori atau status untuk membuka daftar terkait.</p>}
    {!loading && !rows.length && <div className="dashboard-empty"><BarChart3 size={26} /><h2>Belum ada data sesuai filter</h2><p>Ubah periode atau kategori untuk melihat pengajuan lain.</p></div>}
    <section className="dashboard-chart-panel" aria-labelledby="trend-heading"><div className="dashboard-panel-heading"><div><h2 id="trend-heading">Aktivitas pengajuan</h2><p>{days} hari terakhir / tanggal WIB</p></div><span className="ui-tag">{trend.reduce((sum, day) => sum + day.count, 0)} aduan</span></div><div className="dashboard-chart-scroll"><div className="dashboard-full-chart" style={{ minWidth: days > 7 ? days * 14 : undefined }}>{trend.map((item, index) => <div className="dashboard-chart-column" key={item.date} title={`${item.date}: ${item.count} aduan`}><span>{item.count || ""}</span><div role="img" aria-label={`${item.date}: ${item.count} aduan`} style={{ height: `${Math.max(2, item.count / max * 140)}px`, opacity: item.count ? 1 : 0.2 }} /><time dateTime={item.date}>{index % Math.ceil(days / 7) === 0 ? days > 7 ? item.date.slice(5) : item.label : ""}</time></div>)}</div></div></section>
    <div className="dashboard-analysis-grid">
      <section className="dashboard-chart-panel"><div className="dashboard-panel-heading"><h2>Profil risiko</h2><span className="ui-tag">{rows.length} aduan</span></div><div className="dashboard-risk-layout"><div role="img" aria-label={risks.map(item => `${item.label}: ${item.count}`).join(", ")} className="dashboard-risk-donut" style={{ background: rows.length ? `conic-gradient(${colors.HIGH} 0deg ${high}deg, ${colors.MEDIUM} ${high}deg ${medium}deg, ${colors.LOW} ${medium}deg 360deg)` : "#e5eee8" }}><span>{rows.length}<small>Total aduan</small></span></div><dl>{(["HIGH", "MEDIUM", "LOW"] as const).map(band => <div key={band}><dt><Link href={drill({ risk: band })}><span style={{ background: colors[band] }} />{formatRiskBand(band)}<ArrowUpRight size={12} /></Link></dt><dd>{risks.find(item => item.key === band)?.count ?? 0}</dd></div>)}</dl></div></section>
      <section className="dashboard-chart-panel"><div className="dashboard-panel-heading"><h2>Distribusi kategori</h2></div><div className="dashboard-distribution">{categories.length ? categories.map(item => <Link key={item.key} href={drill({ category: item.key })}><span><strong>{item.label}</strong><span>{item.count}<ArrowUpRight size={12} /></span></span><span className="dashboard-distribution-track"><span style={{ width: `${item.percent}%` }} /></span></Link>) : <p>Belum ada kategori.</p>}</div></section>
      <section className="dashboard-chart-panel"><div className="dashboard-panel-heading"><h2>Status penanganan</h2></div><div className="dashboard-status-list">{statuses.map(item => <Link key={item.key} href={drill({ status: item.key, tab: "all" })}><span>{item.label}</span><strong>{item.count}</strong><ArrowUpRight size={13} /></Link>)}</div></section>
      <section id="target-penanganan" className="dashboard-chart-panel scroll-mt-24"><div className="dashboard-panel-heading"><h2>Target penanganan</h2><CheckCircle2 size={19} className="text-emerald-700" /></div><p className="dashboard-sla-value">{sla.resolved ? `${sla.rate}%` : "-"}<span>selesai sesuai target</span></p><p className="dashboard-analysis-note">{sla.withinTarget} dari {sla.resolved} aduan selesai sesuai target pada data terfilter.</p>{role !== "MAHASISWA" && <Link href={drill({ tab: "overdue", sort: "deadline" })} className="dashboard-overdue-link"><Clock3 size={16} />{sla.overdueOpen} aduan aktif lewat target<ArrowUpRight size={14} /></Link>}</section>
    </div>
  </div>;
}
