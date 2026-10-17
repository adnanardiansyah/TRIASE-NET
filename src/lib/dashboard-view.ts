import { ADUAN_CLOSED_STATUS, type AduanStatus } from "./domain/enums";
import { ticketDeadline, ticketSlaState } from "./ticket-sla";
import type { TicketMetadata } from "./ticket-types";

export function isTicketClosed(status: string): boolean { return ADUAN_CLOSED_STATUS.includes(status as AduanStatus); }
export type TicketFilters = { query: string; status: string; category: string; risk: string; period: string; sort: string; tab: string };
export const INITIAL_FILTERS: TicketFilters = { query: "", status: "", category: "", risk: "", period: "", sort: "newest", tab: "all" };
export function filterTickets(tickets: TicketMetadata[], filters: TicketFilters, now = Date.now()): TicketMetadata[] {
  const query = filters.query.trim().toLocaleLowerCase("id-ID");
  const weight: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return tickets.filter((ticket) => {
    if (query && ![ticket.ticketId, ticket.subject, ticket.pseudonym].some((value) => value.toLocaleLowerCase("id-ID").includes(query))) return false;
    if (filters.tab === "overdue" && ticketSlaState(ticket, now) !== "OVERDUE") return false;
    if (filters.tab === "dueSoon" && ticketSlaState(ticket, now) !== "DUE_SOON") return false;
    if (filters.tab === "active" && isTicketClosed(ticket.status)) return false;
    if (filters.tab === "waiting" && ticket.status !== "MENUNGGU_TINDAK_LANJUT") return false;
    if (filters.tab === "closed" && !isTicketClosed(ticket.status)) return false;
    if (filters.status && filters.status !== ticket.status) return false;
    if (filters.category && filters.category !== ticket.category) return false;
    if (filters.risk && filters.risk !== ticket.riskBand) return false;
    if (filters.period && new Date(ticket.createdAt).getTime() < Math.floor((now + 7 * 3600000) / 86400000) * 86400000 - 7 * 3600000 - (Number(filters.period) - 1) * 86400000) return false;
    return true;
  }).sort((a, b) => filters.sort === "oldest" ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
    : filters.sort === "deadline" ? Number(isTicketClosed(a.status)) - Number(isTicketClosed(b.status)) || Date.parse(ticketDeadline(a) ?? "9999-01-01") - Date.parse(ticketDeadline(b) ?? "9999-01-01") || a.ticketId.localeCompare(b.ticketId)
    : filters.sort === "risk" ? (weight[b.riskBand] ?? 0) - (weight[a.riskBand] ?? 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt)
    : Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function ticketCsv(tickets: TicketMetadata[]): string {
  const escape = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  return "\uFEFF" + [["Tiket", "Judul tersamar", "Kategori", "Status", "Risiko", "Dibuat", "Diperbarui"], ...tickets.map((ticket) => [ticket.ticketId, ticket.subject, ticket.category, ticket.status, ticket.riskBand, ticket.createdAt, ticket.updatedAt])].map((row) => row.map(escape).join(",")).join("\r\n");
}

export function dailyTicketCounts(tickets: TicketMetadata[], now = new Date(), days = 7) {
  const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" });
  const dayFormat = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "short" });
  const key = (date: Date) => dateFormat.format(date);
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    const date = new Date(ticket.createdAt);
    if (!Number.isFinite(date.getTime())) continue;
    const dateKey = key(date);
    counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(now.getTime() - (days - 1 - index) * 86400000);
    return { label: dayFormat.format(day), date: key(day), count: counts.get(key(day)) ?? 0 };
  });
}
