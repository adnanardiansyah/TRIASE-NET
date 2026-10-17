import { describe, expect, it } from "vitest";
import { readDashboardLocation, writeDashboardLocation } from "./dashboard-location";
import { INITIAL_FILTERS } from "./dashboard-view";

describe("dashboard shareable filters", () => {
  it("roundtrips combined categorical filters and view", () => {
    const filters = { ...INITIAL_FILTERS, tab: "active", category: "FASILITAS", risk: "HIGH", period: "7", sort: "deadline" };
    expect(readDashboardLocation(writeDashboardLocation(new URLSearchParams(), filters, "cards"), true)).toEqual({ filters, view: "cards" });
  });
  it("does not serialize search text or reuse it from an incoming URL", () => {
    const params = writeDashboardLocation(new URLSearchParams("query=private&other=retained"), { ...INITIAL_FILTERS, query: "PS-private" }, "table");
    expect(params.has("query")).toBe(false);
    expect(params.get("other")).toBe("retained");
    expect(readDashboardLocation(new URLSearchParams("query=private"), true).filters.query).toBe("");
  });
  it("ignores invalid filters and staff-only tabs for students", () => {
    expect(readDashboardLocation(new URLSearchParams("tab=overdue&sort=invalid&status=bad&view=invalid"), false)).toEqual({ filters: INITIAL_FILTERS, view: "table" });
  });
  it("removes default filters without removing unrelated parameters", () => {
    expect(writeDashboardLocation(new URLSearchParams("tab=active&view=cards&foo=bar"), INITIAL_FILTERS, "table").toString()).toBe("foo=bar");
  });
});
