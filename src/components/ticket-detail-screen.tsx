"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, Clock3, Fingerprint, Loader2 } from "lucide-react";
import type { TicketDetail } from "@/lib/db/tickets";
import type { AduanStatus, AppRole } from "@/lib/domain/enums";
import { ADUAN_CLOSED_STATUS } from "@/lib/domain/enums";
import { formatRiskBand, formatTicketCategory, formatTicketStatus } from "@/lib/dashboard-aggregates";
import { STATUS_TRANSITIONS } from "@/lib/ticket-workflow";
import { DashboardShell } from "./dashboard-shell";
import { RiskPill, StatusPill } from "./dashboard/pill";
import { StaffDecryptPanel } from "./staff-decrypt-panel";
import { TicketDeadline } from "./ticket-deadline";
import { dashboardPaths } from "@/lib/dashboard-routes";
import { TicketConversation } from "./ticket-conversation";

export function TicketDetailView({ initial, role }: { initial: TicketDetail; role: AppRole }) {
  const isStaff = role !== "MAHASISWA";
  const [detail, setDetail] = useState(initial);
  const [selected, setSelected] = useState<AduanStatus | "">("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const ticket = detail.ticket;
  async function changeStatus() {
    if (!selected || pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      const url = `/api/aduan/${ticket.ticketId}`;
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: selected, expectedVersion: ticket.rowVersion }) });
      const data = await response.json();
      if (!response.ok) setError(data.message ?? "Status belum dapat diperbarui.");
      else { window.dispatchEvent(new Event("triase:ticket-updated")); setSelected(""); setNotice("Status diperbarui."); }
      if (response.ok || response.status === 409) {
        const fresh = await fetch(url, { cache: "no-store" });
        if (fresh.ok) setDetail(await fresh.json());
      }
    } catch { setError("Perubahan belum terkonfirmasi. Muat ulang sebelum mencoba lagi."); }
    finally { setPending(false); }
  }
  const transitions = STATUS_TRANSITIONS[ticket.status];
  const home = dashboardPaths(role).tickets;
  return <DashboardShell role={role} title="Detail aduan" subtitle={ticket.ticketId} actions={<Link href={home} className="ui-btn"><ArrowLeft size={14} />Kembali ke daftar aduan</Link>}>
    <header className="border-y border-zinc-200 bg-white px-5 py-6"><div className="flex flex-wrap items-center gap-2"><StatusPill status={ticket.status} label={formatTicketStatus(ticket.status)} /><RiskPill riskBand={ticket.riskBand} label={`Risiko ${formatRiskBand(ticket.riskBand).toLowerCase()}`} /><span className="ui-tag">{formatTicketCategory(ticket.category)}</span></div><h2 className="mt-4 break-words text-xl font-semibold text-zinc-800">{ticket.subject}</h2><p className="mt-3 flex items-center gap-2 text-[10px] text-zinc-400"><Clock3 size={12} />Diajukan {new Date(ticket.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</p><TicketDeadline ticket={ticket} /></header>
    <div className="grid gap-9 py-7 lg:grid-cols-[minmax(0,1fr)_270px]">
      <div className="min-w-0"><section aria-labelledby="body-heading"><h2 id="body-heading" className="ui-section-title mb-4">Isi pengaduan</h2>{isStaff ? <StaffDecryptPanel ticketId={ticket.ticketId} /> : <p className="whitespace-pre-wrap break-words text-[13px] leading-8 text-zinc-600">{detail.body}</p>}</section><TicketConversation ticketId={ticket.ticketId} isStaff={isStaff} closed={ADUAN_CLOSED_STATUS.includes(ticket.status)} /></div>
      <aside className="min-w-0 border-t border-zinc-200 pt-6 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0"><div className="flex items-center gap-2"><Fingerprint size={15} className="text-emerald-700" /><h2 className="ui-section-title">Pelapor</h2></div><p className="mt-3 break-all font-mono text-xs text-emerald-700">{ticket.pseudonym}</p>
        {isStaff && transitions.length > 0 && <div className="mt-6 border-y border-zinc-200 py-5"><label htmlFor="next-status" className="ui-label">Perbarui penanganan</label><select id="next-status" value={selected} onChange={(event) => setSelected(event.target.value as AduanStatus | "")} disabled={pending} className="ui-input"><option value="">Pilih status berikutnya</option>{transitions.map((status) => <option key={status} value={status}>{formatTicketStatus(status)}</option>)}</select><button onClick={() => void changeStatus()} disabled={!selected || pending} className="ui-btn ui-btn-primary mt-3 w-full">{pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Simpan perubahan</button></div>}
        {error && <p role="alert" className="mt-3 text-xs leading-6 text-rose-600">{error}</p>}{notice && <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p>}
        <h2 className="ui-section-title mt-7">Riwayat penanganan</h2><ol className="mt-5 space-y-5 border-l border-emerald-100 pl-4">{detail.timeline.map((event) => <li key={event.id}><p className="text-xs font-medium text-zinc-700">{event.fromStatus ? formatTicketStatus(event.toStatus) : "Aduan diterima"}</p><p className="mt-1 text-[10px] text-zinc-400">{event.actorRole === "MAHASISWA" ? "Pelapor" : "Petugas"}</p><time dateTime={event.createdAt} className="mt-1 block text-[10px] text-zinc-400">{new Date(event.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</time></li>)}</ol>
      </aside>
    </div>
  </DashboardShell>;
}
