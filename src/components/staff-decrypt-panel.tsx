"use client";

import { useState } from "react";
import { Eye, Loader2, ShieldAlert } from "lucide-react";
import { MfaStepUp } from "./mfa-step-up";

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
  const [stepUp, setStepUp] = useState(false);
  const [subject, setSubject] = useState("");

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
        code?: string;
        subject?: string;
        decryptedPreview?: string;
        audit?: { id: string; at: string };
      };

      if (!response.ok || !result.ok) {
        setStepUp(result.code === "STEP_UP_REQUIRED");
        setError(result.message ?? "Dekripsi gagal.");
        return;
      }

      setPreview(result.decryptedPreview ?? "");
      setSubject(result.subject ?? "");
      setStepUp(false);
      setAudit(
        result.audit
          ? `Audit ${result.audit.id.slice(0, 8)} pada ${new Date(result.audit.at).toLocaleString("id-ID")}`
          : "",
      );
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
        <ShieldAlert className="size-4" aria-hidden />
        Isi aduan terenkripsi
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        Isi pengaduan hanya dapat dibuka oleh petugas berwenang.
      </p>

      <button
        type="button"
        onClick={handleDecrypt}
        disabled={loading || stepUp}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
        {loading ? "Membuka..." : "Buka isi aduan"}
      </button>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {error}
        </p>
      ) : null}

      {stepUp && <MfaStepUp onVerified={() => { setStepUp(false); void handleDecrypt(); }} />}

      {preview ? (
        <div className="mt-4 animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none" role="status">
          {subject && <h3 className="mb-2 break-words text-sm font-semibold text-zinc-900">{subject}</h3>}
          <p className="break-words text-sm leading-7 whitespace-pre-wrap text-zinc-700">{preview}</p>
          {audit ? <p className="mt-3 text-xs text-zinc-500">{audit}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
