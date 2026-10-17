import { describe, expect, it } from "vitest";
import { ticketDeadline, ticketSlaState } from "./ticket-sla";
import { filterTickets, INITIAL_FILTERS } from "./dashboard-view";
import type { TicketMetadata } from "./ticket-types";

const ticket: TicketMetadata = { ticketId: "TRX-2026-12345678", category: "FASILITAS", subject: "Masked", pseudonym: "PS-test", status: "DITERIMA", riskBand: "HIGH", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
describe("ticket deadlines", () => {
  it("uses existing risk-based calendar-day targets", () => {
    expect(ticketDeadline(ticket)).toBe("2026-10-04T00:00:00.000Z");
    expect(ticketDeadline({ ...ticket, riskBand: "MEDIUM" })).toBe("2026-10-08T00:00:00.000Z");
    expect(ticketDeadline({ ...ticket, riskBand: "LOW" })).toBe("2026-10-15T00:00:00.000Z");
    expect(ticketDeadline({ ...ticket, riskBand: "UNKNOWN" })).toBe("2026-10-08T00:00:00.000Z");
  });
  it("warns during the last 24 hours and breaches strictly after the deadline", () => {
    const due = Date.parse(ticketDeadline(ticket)!);
    expect(ticketSlaState(ticket, due - 86_400_001)).toBe("ON_TRACK");
    expect(ticketSlaState(ticket, due - 86_400_000)).toBe("DUE_SOON");
    expect(ticketSlaState(ticket, due)).toBe("DUE_SOON");
    expect(ticketSlaState(ticket, due + 1)).toBe("OVERDUE");
  });
  it("excludes terminal states and handles invalid dates", () => {
    for (const status of ["SELESAI", "DITUTUP", "DITOLAK"]) expect(ticketSlaState({ ...ticket, status }, Date.parse("2026-11-01"))).toBe("CLOSED");
    expect(ticketDeadline({ ...ticket, createdAt: "invalid" })).toBeNull();
    expect(ticketSlaState({ ...ticket, createdAt: "invalid" })).toBe("UNKNOWN");
  });
  it("filters only overdue tickets and orders active tickets by deadline", () => {
    const rows = [ticket, { ...ticket, ticketId: "low", riskBand: "LOW" }, { ...ticket, ticketId: "closed", status: "DITUTUP" as const }, { ...ticket, ticketId: "medium", riskBand: "MEDIUM" }];
    const now = Date.parse("2026-10-07T12:00:00Z");
    expect(filterTickets(rows, { ...INITIAL_FILTERS, tab: "overdue" }, now).map((r) => r.ticketId)).toEqual([ticket.ticketId]);
    expect(filterTickets(rows, { ...INITIAL_FILTERS, tab: "dueSoon" }, now).map((r) => r.ticketId)).toEqual(["medium"]);
    expect(filterTickets(rows, { ...INITIAL_FILTERS, sort: "deadline" }, now).map((r) => r.ticketId)).toEqual([ticket.ticketId, "medium", "low", "closed"]);
  });
});
