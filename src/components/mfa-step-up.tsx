"use client";

import { useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

export function MfaStepUp({ onVerified }: { onVerified: () => void }) {
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/step-up", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ otp }) });
      const result = await response.json();
      if (!response.ok) { setError(result.message ?? "Verifikasi gagal."); return; }
      setOtp("");
      onVerified();
    } catch { setError("Tidak dapat menghubungi server."); }
    finally { setPending(false); }
  }
  return (
    <form onSubmit={submit} className="my-3 flex flex-wrap items-end gap-3 border-l-2 border-amber-400 py-2 pl-3">
      <label className="text-sm text-zinc-600">
        Verifikasi autentikator
        <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} className="mt-1 block w-36 rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900" />
      </label>
      <button disabled={pending || otp.length !== 6} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Verifikasi
      </button>
      {error && <p role="alert" className="w-full text-sm text-rose-600">{error}</p>}
    </form>
  );
}
