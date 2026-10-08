'use client';

import { FormEvent, useState } from "react";
import Link from "next/link";

import { DashboardShell } from "@/components/dashboard-shell";
import { ADUAN_CATEGORY, type AduanCategory } from "@/lib/domain/enums";

type SubmitResult = {
  ok?: boolean;
  ticketId?: string;
  pseudonym?: string;
  riskBand?: string;
  message?: string;
};

const CATEGORY_LABEL: Readonly<Record<AduanCategory, string>> = {
  AKADEMIK: "Akademik",
  KEUANGAN: "Keuangan",
  FASILITAS: "Fasilitas",
  KEAMANAS_INFORMASI: "Keamanan Informasi",
  KESEHATAN: "Kesehatan",
  KEBERSAMAAN: "Kebersamaan",
  TEKNOLOGI: "Teknologi",
  LAINNYA: "Lainnya",
};

export default function NewAduanPage() {
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      subject: String(form.get("subject") ?? ""),
      category: String(form.get("category") ?? "LAINNYA"),
      body: String(form.get("body") ?? ""),
    };

    try {
      const response = await fetch("/api/aduan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as SubmitResult;

      if (!data.ok) {
        setError(data.message ?? "Aduan gagal dikirim.");
        return;
      }

      setResult(data);
      event.currentTarget.reset();
    } catch {
      setError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardShell
      role="MAHASISWA"
      title="Buat Aduan Baru"
      subtitle="Isi aduan dienkripsi sebelum disimpan. Server menentukan tingkat risiko dari kategori, bukan dari pilihan Anda."
    >
      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-3xl border border-slate-800 bg-slate-900 p-6"
        >
          <label className="block text-sm font-medium text-slate-300">
            Kategori
            <select
              name="category"
              defaultValue="FASILITAS"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none transition focus:border-cyan-500"
            >
              {ADUAN_CATEGORY.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABEL[category]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-300">
            Judul
            <input
              name="subject"
              type="text"
              maxLength={200}
              placeholder="Ringkasan singkat"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none transition focus:border-cyan-500"
              required
            />
          </label>

          <label className="block text-sm font-medium text-slate-300">
            Isi aduan
            <textarea
              name="body"
              rows={8}
              maxLength={8000}
              placeholder="Ceritakan kronologi, waktu, dan pihak yang terlibat."
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none transition focus:border-cyan-500"
              required
            />
          </label>

          <p className="text-xs text-slate-500">
            Maksimal 200 karakter untuk judul dan 8000 untuk isi aduan.
          </p>

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-cyan-500 px-5 py-3 font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Mengirim..." : "Kirim aduan"}
          </button>
        </form>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-slate-900 p-5">
            <h2 className="text-sm font-semibold tracking-[0.2em] text-cyan-400 uppercase">
              Yang terjadi setelah kirim
            </h2>
            <ol className="mt-4 space-y-4 text-sm text-slate-300">
              <li className="flex gap-3">
                <span className="font-mono text-cyan-400">01</span>
                Isi aduan dienkripsi dan hanya ciphertext yang menyentuh basis data.
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-cyan-400">02</span>
                Identitas Anda diganti pseudonim, sehingga isi tabel tidak memetakan tiket ke
                orangnya.
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-cyan-400">03</span>
                Satuan tugas hanya melihat metadata. Isi aduan baru terbuka
                melalui proses dekripsi yang tercatat di audit.
              </li>
            </ol>
          </div>

          {result?.ok ? (
            <div className="rounded-3xl border border-emerald-500/40 bg-emerald-500/10 p-5">
              <h2 className="font-semibold text-emerald-200">Aduan diterima</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Ticket</dt>
                  <dd className="font-mono text-emerald-200">{result.ticketId}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Pseudonim</dt>
                  <dd className="font-mono text-emerald-200">{result.pseudonym}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">Band risiko</dt>
                  <dd className="text-emerald-200">{result.riskBand}</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-emerald-100/80">
                Simpan nomor ticket untuk melacak penanganan.
              </p>
              <Link
                href="/aduan/lacak"
                className="mt-4 inline-flex rounded-xl border border-emerald-400/40 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-400/10"
              >
                Lacak tiket
              </Link>
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-3xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200"
            >
              {error}
            </p>
          ) : null}
        </aside>
      </div>
    </DashboardShell>
  );
}