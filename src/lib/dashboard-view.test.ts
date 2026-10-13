import { describe, expect, it } from "vitest";
import { dailyTicketCounts, filterTickets, INITIAL_FILTERS, ticketCsv } from "./dashboard-view";
import { buildSlaSummary } from "./dashboard-aggregates";
import type { TicketMetadata } from "./ticket-types";

const ticket = (overrides: Partial<TicketMetadata> = {}): TicketMetadata => ({ ticketId: "TRX-2026-01234567", pseudonym: "PS-123", subject: "Aduan fasilitas", category: "FASILITAS", status: "DITERIMA", riskBand: "LOW", createdAt: "2026-10-13T20:00:00Z", updatedAt: "2026-10-13T20:00:00Z", ...overrides });
describe("dashboard workflows", () => {
  it("combines role-scoped metadata filters without mutating source data", () => {
    const rows = [ticket(), ticket({ ticketId: "TRX-2026-ABCDABCD", category: "KEUANGAN", status: "SELESAI", riskBand: "HIGH" })];
    expect(filterTickets(rows, { ...INITIAL_FILTERS, tab: "active" }).map((r) => r.ticketId)).toEqual([rows[0]!.ticketId]);
    expect(filterTickets(rows, { ...INITIAL_FILTERS, query: "abcd", risk: "HIGH", category: "KEUANGAN" })).toHaveLength(1);
    expect(filterTickets(rows, { ...INITIAL_FILTERS, query: "missing" })).toHaveLength(0);
    expect(rows[0]!.status).toBe("DITERIMA");
  });
  it("uses Jakarta dates across the UTC midnight boundary", () => {
    const counts = dailyTicketCounts([ticket(), ticket({ createdAt: "invalid" })], new Date("2026-10-14T02:00:00Z"));
    expect(counts).toHaveLength(7);
    expect(counts.at(-1)?.count).toBe(1);
    expect(counts.reduce((sum, day) => sum + day.count, 0)).toBe(1);
  });
  it("escapes CSV fields and neutralizes spreadsheet formulas", () => {
    const csv = ticketCsv([ticket({ subject: '=HYPERLINK("https://example.test")' })]);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(csv).not.toContain("PS-123");
  });
  it("excludes terminal tickets from overdue counts and uses the closure timestamp", () => {
    const data = [ticket({ status: "DITUTUP", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z", closedAt: "2026-09-02T00:00:00Z" }), ticket({ status: "DITOLAK", createdAt: "2026-09-01T00:00:00Z" })];
    const summary = buildSlaSummary(data, new Date("2026-10-14T02:00:00Z"));
    expect(summary.overdueOpen).toBe(0);
    expect(summary.resolved).toBe(1);
    expect(summary.withinTarget).toBe(1);
  });
});
