"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRight, BarChart3, Clock3, Gauge, Layers3, ListChecks, ShieldAlert, X } from "lucide-react";
import type { SessionRole } from "@/lib/auth/jwt";
import type { TicketMetadata } from "@/lib/ticket-types";
import type { TicketFilters } from "@/lib/dashboard-view";
import { ticketActivitySeries } from "@/lib/dashboard-view";
import { buildCategoryDistribution, buildRiskDistribution, buildSlaSummary, buildStatusDistribution, formatRiskBand, formatTicketCategory } from "@/lib/dashboard-aggregates";
import { dashboardTicketLink } from "@/lib/dashboard-routes";
import { ADUAN_CATEGORY, PERSONAL_SAFETY_CATEGORIES } from "@/lib/domain/enums";
import { ActivityChart } from "./activity-chart";

const RISK_COLOR = { HIGH: "#e07a7a", MEDIUM: "#ddb057", LOW: "#4fae86" } as const;
const STATUS_COLOR: Record<string, string> = { DITERIMA: "#8b7cf6", DALAM_PENANGANAN: "#38bdf8", MENUNGGU_TINDAK_LANJUT: "#f5b83d", SELESAI: "#34c38f", DITUTUP: "#94a3b8", DITOLAK: "#f17a8b" };
const SENSITIVE = new Set<string>(PERSONAL_SAFETY_CATEGORIES);
const PERIODS = [{ value: "", label: "Semua waktu" }, { value: "7", label: "7 hari" }, { value: "30", label: "30 hari" }, { value: "90", label: "90 hari" }];
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const pct = (value: number) => `${Math.round(value)}%`;

function Panel({ icon, title, aside, children, id }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return <section id={id} className="dashboard-chart-panel analytics-card scroll-mt-24">
    <div className="dashboard-panel-heading"><div className="panel-title-with-icon"><span className="panel-icon" aria-hidden="true">{icon}</span><h2>{title}</h2></div>{aside}</div>
    {children}
  </section>;
}

export function DashboardAnalytics({ role, rows, now, filters, onFilter, onReset, loading }: {
  role: SessionRole; rows: TicketMetadata[]; now: number; filters: TicketFilters;
  onFilter: (key: keyof TicketFilters, value: string) => void; onReset: () => void; loading: boolean;
}) {
  if (loading && !rows.length) return <section className="dashboard-chart-panel dashboard-analytics-page" aria-busy="true"><p role="status" className="dashboard-analysis-note">Memuat analitik aduan...</p><div className="h-48 animate-pulse rounded-xl bg-emerald-50 motion-reduce:animate-none" /></section>;
  const series = ticketActivitySeries(rows, new Date(now), filters.period);
  const categories = buildCategoryDistribution(rows);
  const risks = buildRiskDistribution(rows);
  const statuses = buildStatusDistribution(rows);
  const sla = buildSlaSummary(rows, new Date(now));
  const drill = (extra: Partial<TicketFilters>) => dashboardTicketLink(role, { ...filters, ...extra });
  const total = Math.max(1, rows.length);

  // Segmen donat risiko: dash per segmen, dengan celah kecil bila lebih dari satu.
  const bands = (["HIGH", "MEDIUM", "LOW"] as const).map((band) => ({ band, count: risks.find((item) => item.key === band)?.count ?? 0 }));
  const gap = bands.filter((item) => item.count).length > 1 ? 3 : 0;
  let offset = 0;
  const segments = bands.filter((item) => item.count).map((item) => {
    const length = item.count / total * CIRCUMFERENCE;
    const segment = { ...item, dash: `${Math.max(0, length - gap)} ${CIRCUMFERENCE}`, offset: -offset };
    offset += length;
    return segment;
  });
  const slaRate = sla.resolved ? sla.rate : 0;
  const slaTone = !sla.resolved ? "#c9d8cf" : slaRate >= 80 ? "#34c38f" : slaRate >= 50 ? "#f5b83d" : "#f17a8b";

  return <div className="dashboard-analytics-page" aria-busy={loading}>
    <div className="dashboard-analysis-controls">
      <div className="analysis-period"><span className="ui-label" id="analysis-period-label">Waktu pengajuan</span>
        <div className="segmented" role="group" aria-labelledby="analysis-period-label">{PERIODS.map((period) => <button key={period.value} type="button" aria-pressed={filters.period === period.value} onClick={() => onFilter("period", period.value)}>{period.label}</button>)}</div>
      </div>
      <div><label className="ui-label" htmlFor="analysis-category">Kategori</label><select id="analysis-category" className="ui-input" value={filters.category} onChange={e => onFilter("category", e.target.value)}><option value="">Semua kategori</option>{ADUAN_CATEGORY.map(key => <option key={key} value={key}>{formatTicketCategory(key)}</option>)}</select></div>
      <div><label className="ui-label" htmlFor="analysis-risk">Risiko</label><select id="analysis-risk" className="ui-input" value={filters.risk} onChange={e => onFilter("risk", e.target.value)}><option value="">Semua risiko</option>{["HIGH", "MEDIUM", "LOW"].map(key => <option key={key} value={key}>{formatRiskBand(key)}</option>)}</select></div>
      <div className="analysis-actions"><button type="button" onClick={onReset} className="ui-btn">Reset</button><Link className="ui-btn ui-btn-primary" href={drill({})}>Lihat aduan<ArrowUpRight size={14} /></Link></div>
    </div>
    {filters.tab !== "all" && <div className="dashboard-active-filters"><button onClick={() => onFilter("tab", "all")}>Kelompok status terfilter<X size={12} /></button></div>}
    {filters.status && <div className="dashboard-active-filters"><button onClick={() => onFilter("status", "")}>Hapus filter status<X size={12} /></button></div>}
    {loading ? <p role="status" className="dashboard-analysis-note">Memperbarui analitik...</p> : <p className="dashboard-analysis-note">{rows.length} aduan sesuai filter. Pilih kategori, risiko, atau status untuk membuka daftar terkait.</p>}
    {!loading && !rows.length && <div className="dashboard-empty"><BarChart3 size={26} /><h2>Belum ada data sesuai filter</h2><p>Ubah periode atau kategori untuk melihat pengajuan lain.</p></div>}

    <ActivityChart series={series} />

    <div className="dashboard-analysis-grid">
      <Panel icon={<ShieldAlert size={17} />} title="Profil risiko" aside={<span className="ui-tag">{rows.length} aduan</span>}>
        <div className="risk-layout">
          <svg className="risk-donut" viewBox="0 0 132 132" role="img" aria-label={bands.map((item) => `${formatRiskBand(item.band)}: ${item.count}`).join(", ")}>
            <circle cx="66" cy="66" r={RADIUS} className="ring-track" />
            {segments.map((segment) => <circle key={segment.band} cx="66" cy="66" r={RADIUS} className="ring-segment" stroke={RISK_COLOR[segment.band]} strokeDasharray={segment.dash} strokeDashoffset={segment.offset} />)}
            <text x="66" y="64" className="ring-value">{rows.length}</text><text x="66" y="82" className="ring-caption">total aduan</text>
          </svg>
          <ul className="risk-legend">{bands.map((item) => <li key={item.band}><Link href={drill({ risk: item.band })}>
            <span className="legend-name"><span className="legend-dot" style={{ background: RISK_COLOR[item.band] }} />{formatRiskBand(item.band)}</span>
            <span className="legend-pct">{pct(item.count / total * 100)}</span><strong>{item.count}</strong><ArrowUpRight size={13} aria-hidden="true" />
          </Link></li>)}</ul>
        </div>
      </Panel>

      <Panel icon={<Layers3 size={17} />} title="Distribusi kategori" aside={<span className="ui-tag">{categories.length} kategori</span>}>
        {categories.length ? <ol className="rank-list">{categories.map((item, index) => <li key={item.key}><Link href={drill({ category: item.key })}>
          <span className="rank-no">{String(index + 1).padStart(2, "0")}</span>
          <span className="rank-body"><span className="rank-head"><strong>{item.label}</strong><span>{item.count} · {pct(item.percent)}</span></span>
            <span className="meter"><span style={{ "--w": `${item.percent}%`, "--c": SENSITIVE.has(item.key) ? "#7b93b3" : "#4fae86" } as CSSProperties} /></span></span>
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link></li>)}</ol> : <p className="dashboard-analysis-note">Belum ada kategori.</p>}
      </Panel>

      <Panel icon={<ListChecks size={17} />} title="Status penanganan">
        {statuses.length ? <ul className="status-meters">{statuses.map((item) => <li key={item.key}><Link href={drill({ status: item.key, tab: "all" })}>
          <span className="rank-head"><span className="legend-name"><span className="legend-dot" style={{ background: STATUS_COLOR[item.key] ?? "#94a3b8" }} />{item.label}</span><span><strong>{item.count}</strong> · {pct(item.percent)}</span></span>
          <span className="meter"><span style={{ "--w": `${item.percent}%`, "--c": STATUS_COLOR[item.key] ?? "#94a3b8" } as CSSProperties} /></span>
        </Link></li>)}</ul> : <p className="dashboard-analysis-note">Belum ada status.</p>}
      </Panel>

      <Panel id="target-penanganan" icon={<Gauge size={17} />} title="Target penanganan">
        <div className="sla-layout">
          <svg className="sla-gauge" viewBox="0 0 132 132" role="img" aria-label={sla.resolved ? `${sla.rate}% selesai sesuai target` : "Belum ada aduan selesai"}>
            <circle cx="66" cy="66" r={RADIUS} className="ring-track" />
            {sla.resolved > 0 && <circle cx="66" cy="66" r={RADIUS} className="ring-segment" stroke={slaTone} strokeDasharray={`${slaRate / 100 * CIRCUMFERENCE} ${CIRCUMFERENCE}`} />}
            <text x="66" y="66" className="ring-value">{sla.resolved ? `${sla.rate}%` : "–"}</text><text x="66" y="84" className="ring-caption">tepat waktu</text>
          </svg>
          <dl className="sla-facts">
            <div><dt>Selesai sesuai target</dt><dd>{sla.withinTarget}</dd></div>
            <div><dt>Selesai melewati target</dt><dd>{Math.max(0, sla.resolved - sla.withinTarget)}</dd></div>
            <div><dt>Total selesai</dt><dd>{sla.resolved}</dd></div>
          </dl>
        </div>
        {role !== "MAHASISWA" && <Link href={drill({ tab: "overdue", sort: "deadline" })} className="dashboard-overdue-link" data-clear={sla.overdueOpen === 0 || undefined}><Clock3 size={16} />{sla.overdueOpen ? `${sla.overdueOpen} aduan aktif lewat target` : "Tidak ada aduan aktif yang lewat target"}<ArrowUpRight size={14} /></Link>}
      </Panel>
    </div>
  </div>;
}
