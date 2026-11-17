import type { CSSProperties } from "react";
import { TrendingUp } from "lucide-react";
import type { ActivitySeries } from "@/lib/dashboard-view";

const UNIT = { day: "hari", week: "minggu", month: "bulan" } as const;

/** Batas atas sumbu yang "bulat" agar garis bantu jatuh di angka mudah dibaca. */
function axis(max: number) {
  const step = Math.max(1, Math.ceil(max / 4));
  const top = Math.max(step, Math.ceil(max / step) * step);
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => top - i * step) };
}

export function ActivityChart({ series, title = "Aktivitas pengajuan", compact = false }: { series: ActivitySeries; title?: string; compact?: boolean }) {
  const { buckets, total, peak, average, granularity } = series;
  const { top, ticks } = axis(Math.max(0, ...buckets.map((bucket) => bucket.count)));
  const every = Math.max(1, Math.ceil(buckets.length / (compact ? 8 : 12)));
  const wide = buckets.length > 40;

  return <section className={`dashboard-chart-panel activity-panel${compact ? " is-compact" : ""}`} aria-labelledby="activity-heading">
    <div className="dashboard-panel-heading">
      <div className="panel-title-with-icon"><span className="panel-icon" aria-hidden="true"><TrendingUp size={17} /></span><div><h2 id="activity-heading">{title}</h2><p>{series.rangeLabel}</p></div></div>
      {compact && <span className="ui-tag">{total} aduan</span>}
    </div>
    {!compact && <dl className="activity-stats">
      <div><dt>Total</dt><dd>{total}<span> aduan</span></dd></div>
      <div><dt>Puncak</dt><dd>{peak ? peak.count : 0}<span>{peak ? ` · ${peak.title}` : " · belum ada"}</span></dd></div>
      <div><dt>Rata-rata</dt><dd>{average.toLocaleString("id-ID", { maximumFractionDigits: 1 })}<span> / {UNIT[granularity]}</span></dd></div>
    </dl>}
    <div className="activity-scroll">
      <div className="activity-plot" style={{ minWidth: wide ? buckets.length * 18 : undefined }}>
        <div className="activity-grid" aria-hidden="true">{ticks.map((tick) => <div key={tick}><span>{tick}</span></div>)}</div>
        <ol className="activity-bars" aria-label={`${title}, ${series.rangeLabel}`}>
          {buckets.map((bucket, index) => <li key={bucket.key} tabIndex={0} aria-label={`${bucket.title}: ${bucket.count} aduan`} data-empty={bucket.count === 0 || undefined}
            style={{ "--h": bucket.count / top, "--i": Math.min(index, 40) } as CSSProperties}>
            <span className="activity-bar" aria-hidden="true" />
            <span className="activity-tip" aria-hidden="true"><strong>{bucket.count} aduan</strong>{bucket.title}</span>
            <span className="activity-label" aria-hidden="true">{index % every === 0 || index === buckets.length - 1 ? bucket.label : ""}</span>
          </li>)}
        </ol>
      </div>
    </div>
  </section>;
}
