import Link from "next/link";
import { ArrowUpRight, Clock3, Inbox } from "lucide-react";
import type { SessionRole } from "@/lib/auth/jwt";
import type { TicketMetadata } from "@/lib/ticket-types";
import { filterTickets, INITIAL_FILTERS } from "@/lib/dashboard-view";
import { dashboardPaths, dashboardTicketLink } from "@/lib/dashboard-routes";
import { formatRelativeTime, formatTicketStatus } from "@/lib/dashboard-aggregates";
import { StatusPill } from "./pill";
import { TicketDeadline } from "../ticket-deadline";

export function DashboardOverview({ role, rows, now, loading }: { role: SessionRole; rows: TicketMetadata[]; now: number; loading: boolean }) {
  const staff = role !== "MAHASISWA";
  const priority = filterTickets(rows, { ...INITIAL_FILTERS, tab: "active", sort: staff ? "deadline" : "newest" }, now).slice(0, 4);
  const recent = [...rows].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 5);
  return <section className="dashboard-overview-grid" aria-label="Ringkasan aduan" aria-busy={loading}>
    <div className="dashboard-chart-panel"><div className="dashboard-panel-heading"><div><h2>{staff ? "Prioritas penanganan" : "Aduan yang sedang berjalan"}</h2><p>{staff ? "Aduan aktif dengan tenggat terdekat" : "Ikuti penanganan aduan Anda"}</p></div><Clock3 size={20} className="text-emerald-700" /></div>{loading ? <p role="status" className="dashboard-analysis-note">Memuat ringkasan...</p> : priority.length ? <ul className="dashboard-summary-list">{priority.map(ticket => <li key={ticket.ticketId}><Link href={`/aduan/${ticket.ticketId}`}><div><span className="dashboard-summary-id">{ticket.ticketId}</span><h3>{ticket.subject}</h3><StatusPill status={ticket.status} label={formatTicketStatus(ticket.status)} /><TicketDeadline ticket={ticket} /></div><ArrowUpRight size={17} /></Link></li>)}</ul> : <div className="dashboard-empty"><Inbox size={24} /><h3>Tidak ada aduan aktif</h3><p>{rows.length ? "Semua aduan saat ini sudah tidak aktif." : "Aduan yang tersedia akan muncul di sini."}</p>{!staff && !rows.length && <Link href="/aduan/baru" className="ui-btn ui-btn-primary">Buat aduan pertama</Link>}</div>}<Link href={dashboardTicketLink(role, { tab: "active", sort: staff ? "deadline" : "newest" })} className="landing-text-link">Lihat semua aduan aktif<ArrowUpRight size={14} /></Link></div>
    <div className="dashboard-chart-panel"><div className="dashboard-panel-heading"><div><h2>Pembaruan tiket terbaru</h2><p>Berdasarkan perubahan terakhir pada tiket</p></div><Link href={dashboardPaths(role).tickets} className="landing-text-link">Semua<ArrowUpRight size={13} /></Link></div>{loading ? <p role="status" className="dashboard-analysis-note">Memuat pembaruan...</p> : recent.length ? <ol className="dashboard-recent-list">{recent.map(ticket => <li key={ticket.ticketId}><span className="dashboard-recent-dot" /><Link href={`/aduan/${ticket.ticketId}`}><span className="dashboard-summary-id">{ticket.ticketId}</span><h3>{ticket.subject}</h3><p>{formatTicketStatus(ticket.status)}</p><time dateTime={ticket.updatedAt}>{formatRelativeTime(ticket.updatedAt)}</time></Link></li>)}</ol> : <div className="dashboard-empty"><Inbox size={24} /><h3>Belum ada pembaruan</h3><p>Pembaruan tiket akan tampil setelah aduan tersedia.</p></div>}</div>
  </section>;
}
