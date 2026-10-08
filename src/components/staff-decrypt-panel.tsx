"use client";

import { useState } from "react";
import { Eye, Loader2, ShieldAlert } from "lucide-react";

/**
 * Panel dekripsi untuk satuan tugas.
 *
 * Isi aduan sengaja tidak dirender dari server untuk staf. Permintaan dekripsi
 * dikirim ke `/api/satgas/decrypt`, yang memverifikasi sesi, mengambil ciphertext
 * dari penyimpanan server, lalu mencatat aksesnya di log audit. Staff tidak
 * pernah memilih ciphertext-nya sendiri.
 */
export function StaffDecryptPanel({ ticketId }: { ticketId: string }) {
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [audit, setAudit] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function handleDecrypt() {
    setLoading(true);
    setError("");
    setAudit("");

    try {
      const response = await fetch("/api/satgas/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: ticketId }),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        decryptedPreview?: string;
        audit?: { seq: number; at: string; hash: string };
      };

      if (!response.ok || !result.ok) {
        setError(result.message ?? "Dekripsi gagal.");
        return;
      }

      setPreview(result.decryptedPreview ?? "");
      setAudit(
        result.audit
          ? `Audit #${result.audit.seq} pada ${new Date(result.audit.at).toLocaleString("id-ID")} (${result.audit.hash.slice(0, 12)}...)`
          : "",
      );
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-cyan-200">
        <ShieldAlert className="size-4" aria-hidden />
        Isi aduan terenkripsi
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        Isi aduan tidak ikut dirender di halaman ini. Buka lewat endpoint dekripsi
        agar akses tercatat di log audit.
      </p>

      <button
        type="button"
        onClick={handleDecrypt}
        disabled={loading}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
        {loading ? "Membuka..." : "Buka isi aduan"}
      </button>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-300">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-4">
          <p className="text-sm leading-7 whitespace-pre-wrap text-slate-200">{preview}</p>
          {audit ? <p className="mt-3 text-xs text-slate-400">{audit}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
