'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FilePlus2,
  Gauge,
  Inbox,
  ShieldCheck,
  Ticket as TicketIcon,
} from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { DistributionBars } from "@/components/dashboard/distribution";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MetaPill, RiskPill, StatusPill } from "@/components/dashboard/pill";
import { ListSkeleton, Skeleton, StatCardSkeleton } from "@/components/dashboard/skeleton";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  buildMahasiswaDashboard,
  buildRiskDistribution,
  type SummaryTicket,
} from "@/lib/dashboard-aggregates";

const STAT_ICON = [Inbox, Clock3, CheckCircle2, Gauge] as const;
const STAT_TONE = ["cyan", "amber", "emerald", "violet"] as const;

export default function MahasiswaDashboardPage() {
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
          setError(result.message ?? "Gagal memuat daftar aduan.");
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

  const { stats, tickets: rows } = buildMahasiswaDashboard(tickets);
  const risk = buildRiskDistribution(tickets);

  return (
    <DashboardShell
      role="MAHASISWA"
      title="Portal Layanan Aduan"
      subtitle="Pantau status aduan Anda, cek penanganan satgas, dan lihat riwayat komunikasi aman dengan sistem."
      actions={
        <Link
          href="/aduan/baru"
          className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
        >
          <FilePlus2 className="size-4" aria-hidden />
          Buat aduan
        </Link>
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

      <section aria-label="Ringkasan aduan" className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Aduan saya</h2>
              <p className="mt-1 text-sm text-slate-400">
                {loading ? "Memuat..." : `${rows.length} aduan tercatat`}
              </p>
            </div>
            <Link
              href="/aduan/lacak"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-400 hover:text-cyan-300"
            >
              Lacak tiket
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </div>

          {loading ? (
            <ListSkeleton rows={3} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={TicketIcon}
              title="Belum ada aduan"
              description="Aduan pertama Anda akan muncul di sini lengkap dengan status penanganan dari satuan tugas."
              action={
                <Link
                  href="/aduan/baru"
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                >
                  <FilePlus2 className="size-4" aria-hidden />
                  Buat aduan pertama
                </Link>
              }
            />
          ) : (
            <ul className="space-y-3">
              {rows.map((item) => (
                <li key={item.ticketId}>
                  <Link
                    href={`/aduan/${encodeURIComponent(item.ticketId)}`}
                    className="group block rounded-2xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-cyan-500/40 hover:bg-slate-950"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-cyan-400">{item.ticketId}</p>
                        <p className="mt-1 font-medium text-white group-hover:text-cyan-200">
                          {item.subject}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <StatusPill status={item.status} label={item.statusLabel} />
                        <RiskPill riskBand={item.riskBand} label={item.riskLabel} />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-400">
                      <MetaPill value={item.categoryLabel} title={item.category} />
                      <span>Diperbarui {item.updatedLabel}</span>
                      {!item.isOpen ? (
                        <span className="inline-flex items-center gap-1 text-emerald-300">
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          Ditutup
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-white">Sebaran risiko</h2>
            <p className="mt-1 mb-5 text-sm text-slate-400">
              Dihitung otomatis dari isi aduan, tidak bisa Anda tetapkan sendiri.
            </p>

            {loading ? (
              <div className="space-y-4">
                {["w-full", "w-2/3", "w-1/3"].map((width) => (
                  <div key={width}>
                    <Skeleton className={`h-3 ${width}`} />
                    <Skeleton className="mt-2 h-2 w-full" />
                  </div>
                ))}
              </div>
            ) : (
              <DistributionBars slices={risk} />
            )}
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 to-slate-900 p-5 sm:p-6">
            <span className="inline-flex items-center gap-2 rounded-lg bg-cyan-400/10 px-2 py-1 text-xs font-semibold tracking-[0.18em] text-cyan-300 uppercase ring-1 ring-inset ring-cyan-400/20">
              <ShieldCheck className="size-3.5" aria-hidden />
              Privasi
            </span>
            <h2 className="mt-3 text-lg font-bold text-white">Zero-knowledge by design</h2>
            <p className="mt-2.5 text-sm leading-6 text-slate-300">
              Isi aduan dienkripsi sebelum menyentuh basis data. Identitas Anda diganti
              pseudonim, sehingga isi tabel tidak dapat dipetakan kembali ke orangnya.
            </p>
            <p className="mt-4 rounded-xl border border-cyan-500/20 bg-slate-950/60 p-3.5 text-sm text-slate-300">
              Satuan tugas hanya melihat metadata. Isi aduan terbuka melalui proses
              dekripsi yang tercatat pada log audit.
            </p>
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}