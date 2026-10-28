"use client";

import { useState } from "react";
import { Download, Loader2, Paperclip } from "lucide-react";
import { complaintDetailRows, type ComplaintDetails, type EvidenceDescriptor } from "@/lib/complaint-payload";
import { MfaStepUp } from "./mfa-step-up";

export function ComplaintContent({ body, details, attachments = [], ticketId }: { body: string; details?: ComplaintDetails; attachments?: EvidenceDescriptor[]; ticketId: string }) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [stepUp, setStepUp] = useState(false);
  const rows = complaintDetailRows(details);
  async function download(file: EvidenceDescriptor) {
    if (pending) return;
    setPending(file.id); setError("");
    try {
      const response = await fetch(`/api/aduan/${encodeURIComponent(ticketId)}/attachments/${file.id}`, { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json(); setStepUp(data.code === "STEP_UP_REQUIRED");
        setError(data.message ?? "Lampiran belum dapat diunduh."); return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStepUp(false);
    } catch { setError("Lampiran belum dapat diunduh. Coba lagi."); }
    finally { setPending(""); }
  }
  return <div className="space-y-6">
    <div><h3 className="mb-2 text-xs font-semibold text-emerald-800">Kronologi kejadian</h3><p className="whitespace-pre-wrap break-words text-[13px] leading-8 text-zinc-600">{body}</p></div>
    {rows.length > 0 && <dl className="grid gap-5 border-y border-zinc-200 py-5 sm:grid-cols-2">{rows.map((row) => <div key={row.label} className="min-w-0"><dt className="text-xs font-semibold text-zinc-700">{row.label}</dt><dd className="mt-2 whitespace-pre-wrap break-words text-xs leading-7 text-zinc-600">{row.value}</dd></div>)}</dl>}
    {attachments.length > 0 && <section aria-label="Bukti pendukung"><h3 className="mb-3 flex items-center gap-2 text-xs font-semibold text-emerald-800"><Paperclip size={15} />Bukti pendukung</h3><ul className="space-y-2">{attachments.map((file) => <li key={file.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3"><div className="min-w-0"><p className="break-words text-xs font-medium text-zinc-700">{file.name}</p><p className="mt-1 text-[10px] text-zinc-500">{Math.ceil(file.size / 1024)} KB · {file.mimeType === "application/pdf" ? "PDF" : "Gambar"}</p></div><button type="button" className="ui-btn shrink-0" disabled={!!pending || stepUp} onClick={() => void download(file)} aria-label={`Unduh ${file.name}`}>{pending === file.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Unduh</button></li>)}</ul></section>}
    {error && <p role="alert" className="text-xs leading-6 text-rose-700">{error}</p>}
    {stepUp && <MfaStepUp onVerified={() => { setStepUp(false); setError(""); }} />}
  </div>;
}
