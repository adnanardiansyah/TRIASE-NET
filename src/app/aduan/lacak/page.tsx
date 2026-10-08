'use client';

import { FormEvent, useState } from "react";
import Link from "next/link";

import { DashboardShell } from "@/components/dashboard-shell";
import { formatTicketStatus } from "@/lib/dashboard-aggregates";

interface TrackedTicket {
  ticketId: string;
  subject: string;
  category: string;
  riskBand: string;
  pseudonym: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

type LookupResult = {
  ok?: boolean;
  scope?: string;
  ticket?: TrackedTicket;
  message?: string;
};

function formatTimestamp(isoValue: string): string {
  const date = new Date(isoValue);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

const STATUS_STYLE: Readonly<Record<string, string>> = {
  DALAM_PENANGANAN: "bg-cyan-500/10 text-cyan-300",
  MENUNGGU_TINDAK_LANJUT: "bg-amber-500/10 text-amber-300",
  SELESAI: "bg-emerald-500/10 text-emerald-300",
};

export default function LacakAduanPage() {
  const [ticket, setTicket] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = ticket.trim();

    if (!trimmed) {
      setError("Masukkan nomor ticket terlebih dahulu.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch(`/api/aduan/${encodeURIComponent(trimmed)}`);
      const data = (await response.json()) as LookupResult;

      if (!response.ok || !data.ok) {
        setError(data.message ?? "Ticket tidak ditemukan.");
        return;
      }

      setResult(data);
    } catch {
      setError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  const found = result?.ticket;

  return (
    <DashboardShell
      role="MAHASISWA"
      title="Lacak Status Aduan"
      subtitle="Masukkan nomor ticket yang Anda terima saat mengirim aduan. Hanya tiket milik Anda yang dapat dibuka."
    >
      <form
        onSubmit={handleSubmit}
        className="rounded-3xl border border-slate-800 bg-slate-900 p-6"
      >
        <label className="block text-sm font-medium text-slate-300">
          Nomor ticket
          <input
            value={ticket}
            onChange={(event) => setTicket(event.target.value.toUpperCase())}
            placeholder="TR-XXXXXXXXXX"
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-slate-100 outline-none transition focus:border-cyan-500"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="mt-4 rounded-xl bg-cyan-500 px-5 py-2.5 font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Mencari..." : "Lacak status"}
        </button>
      </form>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-3xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200"
        >
          {error}
        </p>
      ) : null}

      {found ? (
        <section className="mt-6 rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-cyan-400 uppercase">
                Detail tiket
              </p>
              <h2 className="mt-2 font-mono text-xl text-white">{found.ticketId}</h2>
              <p className="mt-1 text-slate-300">{found.subject}</p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                STATUS_STYLE[found.status] ?? "bg-slate-800 text-slate-300"
              }`}
            >
              {formatTicketStatus(found.status)}
            </span>
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <dt className="text-xs tracking-wide text-slate-400 uppercase">Kategori</dt>
              <dd className="mt-2 text-slate-100">{found.category}</dd>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <dt className="text-xs tracking-wide text-slate-400 uppercase">Band risiko</dt>
              <dd className="mt-2 text-slate-100">{found.riskBand}</dd>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <dt className="text-xs tracking-wide text-slate-400 uppercase">Pseudonim</dt>
              <dd className="mt-2 font-mono text-sm text-cyan-300">{found.pseudonym}</dd>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <dt className="text-xs tracking-wide text-slate-400 uppercase">Diperbarui</dt>
              <dd className="mt-2 text-sm text-slate-100">{formatTimestamp(found.updatedAt)}</dd>
            </div>
          </dl>

          <Link
            href={`/aduan/${encodeURIComponent(found.ticketId)}`}
            className="mt-6 inline-flex rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-500/60"
          >
            Lihat isi aduan
          </Link>
        </section>
      ) : null}
    </DashboardShell>
  );
}