import { ADUAN_CLOSED_STATUS, type AduanStatus } from "./domain/enums";

/** Existing operational targets: calendar days, measured from submission. */
export const SLA_TARGET_DAYS: Readonly<Record<string, number>> = { HIGH: 3, MEDIUM: 7, LOW: 14 };
export type SlaTicket = { createdAt: string; riskBand: string; status: string };
export type SlaState = "ON_TRACK" | "DUE_SOON" | "OVERDUE" | "CLOSED" | "UNKNOWN";

export function ticketDeadline(ticket: Pick<SlaTicket, "createdAt" | "riskBand">): string | null {
  const created = Date.parse(ticket.createdAt);
  return Number.isFinite(created) ? new Date(created + (SLA_TARGET_DAYS[ticket.riskBand] ?? 7) * 86_400_000).toISOString() : null;
}

export function ticketSlaState(ticket: SlaTicket, now = Date.now()): SlaState {
  if (ADUAN_CLOSED_STATUS.includes(ticket.status as AduanStatus)) return "CLOSED";
  const due = ticketDeadline(ticket);
  if (!due || !Number.isFinite(now)) return "UNKNOWN";
  const remaining = Date.parse(due) - now;
  return remaining < 0 ? "OVERDUE" : remaining <= 86_400_000 ? "DUE_SOON" : "ON_TRACK";
}
