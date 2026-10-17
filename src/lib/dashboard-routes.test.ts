import { describe, expect, it } from "vitest";
import { dashboardPaths, dashboardTicketLink, legacyDashboardDestination } from "./dashboard-routes";
import { isAllowedForRole } from "./auth/guard";
import type { SessionRole } from "./auth/jwt";

describe("dedicated dashboard pages", () => {
  const roles: SessionRole[] = ["MAHASISWA", "SATGAS", "ADMIN"];
  it("keeps every new page protected by its role", () => {
    for (const role of roles) for (const path of Object.values(dashboardPaths(role))) {
      expect(isAllowedForRole(path, role)).toBe(true);
      for (const other of roles.filter(r => r !== role)) expect(isAllowedForRole(path, other)).toBe(false);
    }
  });
  it("drills into a real list route without leaking the search text", () => {
    const url = dashboardTicketLink("SATGAS", { category: "FASILITAS", risk: "HIGH", query: "private" });
    expect(url).toBe("/satgas/aduan?category=FASILITAS&risk=HIGH");
  });
  it("migrates old hashes and saved filtered overview URLs", () => {
    expect(legacyDashboardDestination("ADMIN", "#analitik", "?period=30")).toBe("/admin/analitik?period=30");
    expect(legacyDashboardDestination("SATGAS", "#aduan", "?tab=active")).toBe("/satgas/aduan?tab=active");
    expect(legacyDashboardDestination("MAHASISWA", "", "?view=cards")).toBe("/mahasiswa/aduan?view=cards");
    expect(legacyDashboardDestination("SATGAS", "", "")).toBeNull();
  });
});
