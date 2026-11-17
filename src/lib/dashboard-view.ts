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

export type ActivityGranularity = "day" | "week" | "month";
export interface ActivityBucket { key: string; label: string; title: string; count: number }
export interface ActivitySeries { granularity: ActivityGranularity; buckets: ActivityBucket[]; total: number; peak: ActivityBucket | null; average: number; rangeLabel: string }

const WIB_OFFSET = 7 * 3600000;
const DAY_MS = 86400000;
/** Indeks hari kalender WIB; `new Date(index * DAY_MS)` dibaca dengan zona UTC. */
const wibDay = (ms: number) => Math.floor((ms + WIB_OFFSET) / DAY_MS);
const weekStart = (day: number) => day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);
const utcFormat = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", ...options });
const fmtDay = utcFormat({ day: "numeric", month: "short" });
const fmtDayYear = utcFormat({ day: "numeric", month: "short", year: "numeric" });
const fmtWeekday = utcFormat({ weekday: "short" });
const fmtWeekdayFull = utcFormat({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtMonth = utcFormat({ month: "short", year: "2-digit" });
const fmtMonthFull = utcFormat({ month: "long", year: "numeric" });
const isoDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * Deret aktivitas pengajuan untuk grafik analitik (tanggal WIB).
 *
 * Periode 7/30/90 memakai bucket harian. "Seluruh waktu" (period kosong)
 * dimulai dari aduan pertama, dengan satuan yang menyesuaikan rentang:
 * harian sampai 31 hari, mingguan (Senin) sampai ~6 bulan, lalu bulanan.
 */
export function ticketActivitySeries(tickets: TicketMetadata[], now = new Date(), period = ""): ActivitySeries {
  const today = wibDay(now.getTime());
  const days = tickets.map((ticket) => Date.parse(ticket.createdAt)).filter(Number.isFinite).map(wibDay).filter((day) => day <= today);
  const fixed = Number(period);
  const earliest = days.length ? Math.min(...days) : today;
  let granularity: ActivityGranularity = "day";
  let start = today - 6;
  if (fixed > 0) start = today - fixed + 1;
  else if (days.length) {
    const span = today - earliest + 1;
    granularity = span <= 31 ? "day" : span <= 183 ? "week" : "month";
    start = granularity === "day" ? Math.min(earliest, today - 6) : earliest;
  }

  const buckets: ActivityBucket[] = [];
  const index = new Map<number, number>();
  if (granularity === "day") {
    const short = today - start + 1 <= 7;
    for (let day = start; day <= today; day++) {
      const date = new Date(day * DAY_MS);
      index.set(day, buckets.length);
      buckets.push({ key: isoDay(day), label: short ? fmtWeekday.format(date) : fmtDay.format(date), title: fmtWeekdayFull.format(date), count: 0 });
    }
  } else if (granularity === "week") {
    for (let day = weekStart(start); day <= weekStart(today); day += 7) {
      index.set(day, buckets.length);
      buckets.push({ key: isoDay(day), label: fmtDay.format(new Date(day * DAY_MS)), title: `${fmtDay.format(new Date(day * DAY_MS))} – ${fmtDayYear.format(new Date((day + 6) * DAY_MS))}`, count: 0 });
    }
  } else {
    const first = new Date(start * DAY_MS);
    const last = new Date(today * DAY_MS);
    for (let y = first.getUTCFullYear(), m = first.getUTCMonth(); y < last.getUTCFullYear() || (y === last.getUTCFullYear() && m <= last.getUTCMonth()); m === 11 ? (y++, m = 0) : m++) {
      const date = new Date(Date.UTC(y, m, 1));
      index.set(y * 12 + m, buckets.length);
      buckets.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, label: fmtMonth.format(date), title: fmtMonthFull.format(date), count: 0 });
    }
  }

  let total = 0;
  for (const day of days) {
    if (day < start) continue;
    const date = new Date(day * DAY_MS);
    const slot = granularity === "day" ? index.get(day) : granularity === "week" ? index.get(weekStart(day)) : index.get(date.getUTCFullYear() * 12 + date.getUTCMonth());
    if (slot === undefined) continue;
    buckets[slot]!.count++;
    total++;
  }
  const peak = buckets.reduce<ActivityBucket | null>((best, bucket) => bucket.count > (best?.count ?? 0) ? bucket : best, null);
  const unit = granularity === "day" ? "hari" : granularity === "week" ? "minggu" : "bulan";
  const rangeLabel = fixed > 0 ? `${fixed} hari terakhir · per hari` : days.length ? `Sejak ${fmtDayYear.format(new Date(earliest * DAY_MS))} · per ${unit}` : "7 hari terakhir · per hari";
  return { granularity, buckets, total, peak, average: buckets.length ? total / buckets.length : 0, rangeLabel };
}
