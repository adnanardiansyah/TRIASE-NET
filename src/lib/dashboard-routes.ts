import type { SessionRole } from "./auth/jwt";
import type { TicketFilters } from "./dashboard-view";
import { INITIAL_FILTERS } from "./dashboard-view";
import { writeDashboardLocation } from "./dashboard-location";

export type DashboardSection = "overview" | "tickets" | "analytics";
export function dashboardPaths(role: SessionRole) {
  const home = role === "MAHASISWA" ? "/mahasiswa" : role === "SATGAS" ? "/satgas" : "/admin";
  return { overview: home, tickets: `${home}/aduan`, analytics: `${home}/analitik` };
}
export function dashboardTicketLink(role: SessionRole, filters: Partial<TicketFilters> = {}) {
  const params = writeDashboardLocation(new URLSearchParams(), { ...INITIAL_FILTERS, ...filters }, "table").toString();
  return dashboardPaths(role).tickets + (params ? `?${params}` : "");
}
export function legacyDashboardDestination(role: SessionRole, hash: string, search: string): string | null {
  const paths = dashboardPaths(role);
  if (hash === "#analitik") return paths.analytics + search;
  if (hash === "#aduan" || [...new URLSearchParams(search).keys()].some(key => ["status", "category", "risk", "period", "sort", "tab", "view"].includes(key))) return paths.tickets + search;
  return null;
}
