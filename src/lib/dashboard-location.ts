import { ADUAN_CATEGORY, ADUAN_STATUS } from "./domain/enums";
import { INITIAL_FILTERS, type TicketFilters } from "./dashboard-view";

export type TicketView = "table" | "cards";
const choices: Record<Exclude<keyof TicketFilters, "query">, readonly string[]> = {
  status: ADUAN_STATUS, category: ADUAN_CATEGORY, risk: ["HIGH", "MEDIUM", "LOW"],
  period: ["7", "30", "90"], sort: ["newest", "oldest", "risk", "deadline"],
  tab: ["all", "active", "waiting", "closed", "dueSoon", "overdue"],
};
export function readDashboardLocation(params: URLSearchParams, staff: boolean): { filters: TicketFilters; view: TicketView } {
  const filters = { ...INITIAL_FILTERS };
  for (const key of Object.keys(choices) as Array<keyof typeof choices>) {
    const value = params.get(key);
    if (value && choices[key].includes(value)) filters[key] = value;
  }
  if (!staff && ["dueSoon", "overdue"].includes(filters.tab)) filters.tab = "all";
  return { filters, view: params.get("view") === "cards" ? "cards" : "table" };
}
/** Only share categorical filters. Search text may contain private metadata. */
export function writeDashboardLocation(params: URLSearchParams, filters: TicketFilters, view: TicketView): URLSearchParams {
  const result = new URLSearchParams(params);
  result.delete("query");
  for (const key of Object.keys(choices) as Array<keyof typeof choices>) {
    if (filters[key] !== INITIAL_FILTERS[key] && choices[key].includes(filters[key])) result.set(key, filters[key]);
    else result.delete(key);
  }
  if (view === "cards") result.set("view", "cards"); else result.delete("view");
  return result;
}
