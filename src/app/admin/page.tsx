'use client';

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Gauge,
  ShieldCheck,
  Siren,
  TrendingUp,
} from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { DistributionBars } from "@/components/dashboard/distribution";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MetaPill, RiskPill, StatusPill } from "@/components/dashboard/pill";
import { ListSkeleton, Skeleton, StatCardSkeleton } from "@/components/dashboard/skeleton";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  buildAdminSummary,
  buildCategoryDistribution,
  buildRiskDistribution,
  buildStatusDistribution,
  formatRelativeTime,
  formatRiskBand,
  formatTicketCategory,
  formatTicketStatus,
  type SummaryTicket,
} from "@/lib/dashboard-aggregates";

/**
 * Status kontrol keamanan.
 *
* PENTING: nilai-nilai ini konfigurasi yang ditulis tetap di kode, bukan
 * telemetri dari database atau sistem operasi. Menampilkannya sebagai fakta
 * yang terukur akan membuat dasbor berbohong, jadi panel ini harus dibaca
 * sebagai "kontrol yang dikonfigurasi", bukan "kontrol yang terverifikasi".
 * Menyambungkannya ke sumber nyata adalah pekerjaan tersendiri dan tidak
 * dicoba di sini.
 */
const CONTROL_STATUS: Readonly<{ label: string; value: string; tone: string }[]> = [
  { label: "Row Level Security", value: "Aktif", tone: "text-emerald-300" },
  { label: "Rantai hash audit", value: "Utuh", tone: "text-emerald-300" },
  { label: "Sesi decrypt", value: "Terbatas ke staf", tone: "text-cyan-300" },
];

const STAT_ICON = [ClipboardList, Siren, TrendingUp, Gauge] as const;
const STAT_TONE = ["cyan", "rose", "violet", "emerald"] as const;

export default function AdminDashboardPage() {
  const [tickets, setTickets] = useState<SummaryTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch("/api/aduan");
        const result = (await response.json()) as { items?: SummaryTicket[]; message?: string };

        if (!active) return;

        if (!response.ok) {
          setError(result.message ?? "Gagal memuat data operasional.");
          return;
        }

        setTickets(result.items ?? []);
      } catch {
        if (active) {
          setError("Tidak dapat menghubungi server.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  const { stats, tasks } = buildAdminSummary(tickets);
  const risk = buildRiskDistribution(tickets);
  const status = buildStatusDistribution(tickets);
  const category = buildCategoryDistribution(tickets);

  return (
    <DashboardShell
      role="ADMIN"
      title="Panel Operasional"
      subtitle="Ringkasan volume aduan, sebaran risiko, dan status kontrol keamanan."
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

      <section aria-label="KPI operasional" className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }, (_, index) => <StatCardSkeleton key={index} />)
          : stats.map((item, index) => (
              <StatCard
                key={item.label}
                label={item.label}
                value={item.value}
                icon={STAT_ICON[index] ?? ClipboardList}
                tone={STAT_TONE[index] ?? "cyan"}
              />
            ))}
      </section>

      <section className="mb-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-base font-semibold text-white">Sebaran risiko</h2>
          <p className="mt-1 mb-5 text-sm text-slate-400">Dihitung otomatis oleh mesin risiko.</p>
          {loading ? <ListSkeleton rows={2} /> : <DistributionBars slices={risk} />}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-base font-semibold text-white">Sebaran status</h2>
          <p className="mt-1 mb-5 text-sm text-slate-400">Seluruh tiket yang tercatat.</p>
          {loading ? <ListSkeleton rows={2} /> : <DistributionBars slices={status} />}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-base font-semibold text-white">Kategori aduan</h2>
          <p className="mt-1 mb-5 text-sm text-slate-400">Dari yang paling banyak.</p>
          {loading ? <ListSkeleton rows={3} /> : <DistributionBars slices={category} />}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
          <h2 className="mb-5 text-lg font-semibold text-white">Aduan terbaru</h2>

          {loading ? (
            <ListSkeleton rows={3} />
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Belum ada aduan"
              description="Belum ada aduan yang masuk ke sistem. Volume dan sebaran akan muncul di sini begitu tiket pertama tercatat."
            />
          ) : (
            <ul className="space-y-3">
              {tasks.map((task) => {
                const ticket = tickets.find((item) => item.subject === task.name);

                return (
                  <li
                    key={task.name}
                    className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-white">{task.name}</p>
                        <p className="mt-1 font-mono text-xs text-slate-500">
                          {ticket?.ticketId ?? task.owner}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {ticket ? (
                          <>
                            <StatusPill status={ticket.status} label={formatTicketStatus(ticket.status)} />
                            <RiskPill riskBand={ticket.riskBand} label={formatRiskBand(ticket.riskBand)} />
                          </>
                        ) : (
                          <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300">
                            {task.eta}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-400">
                      {ticket ? (
                        <>
                          <MetaPill
                            value={formatTicketCategory(ticket.category)}
                            title={ticket.category}
                          />
                          <span>{formatRelativeTime(ticket.createdAt)}</span>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-slate-900 p-5 sm:p-6">
          <span className="inline-flex items-center gap-2 rounded-lg bg-violet-400/10 px-2 py-1 text-xs font-semibold tracking-[0.18em] text-violet-300 uppercase ring-1 ring-inset ring-violet-400/20">
            <ShieldCheck className="size-3.5" aria-hidden />
            Kontrol
          </span>
          <h2 className="mt-3 text-lg font-bold text-white">Status governance</h2>

          <ul className="mt-5 space-y-2.5">
            {loading
              ? Array.from({ length: CONTROL_STATUS.length }, (_, index) => (
                  <li
                    key={index}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-3"
                  >
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3.5 w-20" />
                  </li>
                ))
              : CONTROL_STATUS.map((control) => (
                  <li
                    key={control.label}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-3"
                  >
                    <span className="text-sm text-slate-300">{control.label}</span>
                    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${control.tone}`}>
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {control.value}
                    </span>
                  </li>
                ))}
          </ul>

          <p className="mt-5 text-sm leading-6 text-slate-400">
            Antrean satuan tugas berada di area terpisah dan hanya bisa dibuka
            oleh akun dengan peran Satuan Tugas.
          </p>

          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-3 text-xs leading-5 text-amber-200/80">
            Nilai di atas adalah konfigurasi yang tertulis di kode, bukan hasil
            pembacaan dari database. Jangan diperlakukan sebagai verifikasi.
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}