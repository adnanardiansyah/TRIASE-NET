'use client';

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Gauge,
  Inbox,
  RefreshCw,
  ShieldAlert,
  Timer,
} from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { DistributionBars } from "@/components/dashboard/distribution";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MetaPill, RiskPill, StatusPill } from "@/components/dashboard/pill";
import { StatCardSkeleton, TableSkeleton } from "@/components/dashboard/skeleton";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  buildSatgasSummary,
  formatRiskBand,
  formatTicketCategory,
  formatTicketStatus,
  SLA_TARGET_DAYS,
  type SummaryTicket,
} from "@/lib/dashboard-aggregates";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/ticket-types";

/**
 * Bentuk baris antrean.
 *
 * Tidak ada `email` dan tidak ada `body` di sini, dan itu disengaja: `/api/aduan`
 * mengembalikan metadata saja untuk role staf. Isi aduan hanya bisa dibaca
 * lewat `POST /api/satgas/decrypt`, yang mencatat setiap aksesnya.
 */
type QueueRow = SummaryTicket;

const STAT_ICON = [Inbox, Clock3, Timer, Gauge] as const;
const STAT_TONE = ["cyan", "amber", "violet", "emerald"] as const;

export default function SatuanTugasDashboardPage() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingTicket, setPendingTicket] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/aduan");
      const result = (await response.json()) as { items?: QueueRow[]; message?: string };

      if (!response.ok) {
        setError(result.message ?? "Gagal memuat antrean.");
        return;
      }

      setRows(result.items ?? []);
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleStatusChange(ticketId: string, status: string) {
    const previous = rows;
    setPendingTicket(ticketId);
    setError("");
    setNotice("");

    // Pembaruan optimistis: status langsung terlihat berubah, lalu dikembalikan
    // ke nilai server bila permintaan ditolak.
    setRows((current) =>
      current.map((row) =>
        row.ticketId === ticketId ? { ...row, status: status as TicketStatus } : row,
      ),
    );

    try {
      const response = await fetch(`/api/aduan/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      const result = (await response.json()) as { status?: TicketStatus; message?: string };

      if (!response.ok || !result.status) {
        setRows(previous);
        setError(result.message ?? "Status gagal diperbarui.");
        return;
      }

      setRows((current) =>
        current.map((row) =>
          row.ticketId === ticketId ? { ...row, status: result.status! } : row,
        ),
      );
      setNotice(`Status ${ticketId} diperbarui menjadi ${formatTicketStatus(result.status)}.`);
    } catch {
      setRows(previous);
      setError("Tidak dapat menghubungi server. Status dikembalikan.");
    } finally {
      setPendingTicket("");
    }
  }

  const { stats, risk, status, category, sla, oldestOpenLabel } = buildSatgasSummary(rows);

  return (
    <DashboardShell
      role="SATGAS"
      title="Antrean & Dekripsi"
      subtitle="Antrean menampilkan metadata saja. Isi aduan dibuka satu per satu lewat endpoint dekripsi yang tercatat di audit."
      actions={
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-cyan-500/60 hover:text-white disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
          {loading ? "Memuat" : "Muat ulang"}
        </button>
      }
    >
      {error ? (
        <p
          role="alert"
          className="mb-6 flex items-center gap-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="mb-6 flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          {notice}
        </p>
      ) : null}

      <section aria-label="KPI antrean" className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }, (_, index) => <StatCardSkeleton key={index} />)
          : stats.map((item, index) => (
              <StatCard
                key={item.label}
                label={item.label}
                value={item.value}
                hint={item.hint}
                icon={STAT_ICON[index] ?? Inbox}
                tone={STAT_TONE[index] ?? "cyan"}
              />
            ))}
      </section>

      <section className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-base font-semibold text-white">Sebaran risiko</h2>
          <p className="mt-1 mb-5 text-sm text-slate-400">Tertentu oleh mesin ZTNA, bukan oleh staf.</p>
          {loading ? <TableSkeleton rows={3} columns={1} /> : <DistributionBars slices={risk} />}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-base font-semibold text-white">Sebaran status</h2>
          <p className="mt-1 mb-5 text-sm text-slate-400">Posisi antrean saat ini.</p>
          {loading ? <TableSkeleton rows={3} columns={1} /> : <DistributionBars slices={status} />}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-base font-semibold text-white">Kategori aduan</h2>
          <p className="mt-1 mb-5 text-sm text-slate-400">Dari yang paling banyak.</p>
          {loading ? <TableSkeleton rows={4} columns={1} /> : <DistributionBars slices={category} />}
        </div>
      </section>

      <section className="mb-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-amber-500/10 to-slate-900 p-5">
          <div className="flex items-center gap-2 text-amber-300">
            <ShieldAlert className="size-4" aria-hidden />
            <h2 className="text-base font-semibold">Kepatuhan SLA</h2>
          </div>

          <p className="mt-4 text-3xl font-bold tracking-tight text-white tabular-nums">
            {loading ? "-" : `${sla.rate}%`}
          </p>

          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"
            role="img"
            aria-label={`Kepatuhan SLA ${sla.rate} persen dari ${sla.resolved} tiket selesai`}
          >
            <div
              className="h-full rounded-full bg-amber-400 transition-[width] duration-500"
              style={{ width: `${sla.rate}%` }}
            />
          </div>

          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Tepat waktu</dt>
              <dd className="font-medium text-emerald-300 tabular-nums">{sla.withinTarget}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Lewat ambang</dt>
              <dd className="font-medium text-rose-300 tabular-nums">{sla.breached}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Terlambat dan masih terbuka</dt>
              <dd
                className={`font-medium tabular-nums ${sla.overdueOpen > 0 ? "text-rose-300" : "text-slate-200"}`}
              >
                {sla.overdueOpen}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Ambang risiko tinggi</dt>
              <dd className="font-medium text-slate-200 tabular-nums">
                {SLA_TARGET_DAYS.HIGH} hari
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-400">Tiket terbuka tertua</dt>
              <dd className="font-medium text-slate-200 tabular-nums">{oldestOpenLabel}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-base font-semibold text-white">Ambang SLA per band</h2>
          <p className="mt-1 text-sm text-slate-400">
            Makin tinggi risiko, makin cepat tiket harus selesai.
          </p>

          <ul className="mt-4 space-y-2.5">
            {(["HIGH", "MEDIUM", "LOW"] as const).map((band) => (
              <li
                key={band}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <RiskPill riskBand={band} label={formatRiskBand(band)} />
                </div>
                <span className="shrink-0 text-sm font-medium text-slate-200 tabular-nums">
                  {SLA_TARGET_DAYS[band]} hari
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Daftar antrean</h2>
          <p className="text-sm text-slate-400">
            {loading ? "Memuat..." : `${rows.length} tiket`}
          </p>
        </div>

        {loading ? (
          <TableSkeleton rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Antrean kosong"
            description="Tidak ada aduan yang menunggu penanganan. Muat ulang bila ada kiriman baru."
            action={
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-cyan-500/60 hover:text-white"
              >
                <RefreshCw className="size-4" aria-hidden />
                Muat ulang
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-slate-300">
              <caption className="sr-only">
                Daftar tiket antrean satuan tugas dengan metadata dan pengubah status
              </caption>
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Ticket
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Judul
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Kategori
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Risiko
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Ubah status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.ticketId}
                    className="border-b border-slate-800/70 align-middle transition-colors last:border-0 hover:bg-slate-950/50"
                  >
                    <td className="px-3 py-3">
                      <Link
                        href={`/aduan/${encodeURIComponent(row.ticketId)}`}
                        className="font-mono text-xs text-cyan-400 hover:text-cyan-300 hover:underline"
                      >
                        {row.ticketId}
                      </Link>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                        {row.pseudonym}
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-3">{row.subject}</td>
                    <td className="px-3 py-3">
                      <MetaPill value={formatTicketCategory(row.category)} title={row.category} />
                    </td>
                    <td className="px-3 py-3">
                      <RiskPill riskBand={row.riskBand} label={formatRiskBand(row.riskBand)} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={row.status} label={formatTicketStatus(row.status)} />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={row.status}
                        disabled={pendingTicket === row.ticketId}
                        aria-label={`Status untuk ${row.ticketId}`}
                        onChange={(event) =>
                          void handleStatusChange(row.ticketId, event.target.value)
                        }
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-100 outline-none transition focus:border-cyan-500 disabled:opacity-60"
                      >
                        {TICKET_STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {formatTicketStatus(value)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}