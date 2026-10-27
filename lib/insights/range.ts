/**
 * lib/insights/range.ts — the Insights page's date-range filter (pure).
 */
import { addDaysToDateString } from "@/lib/time";

export const RANGE_PRESETS = [
  { key: "ytd", label: "Year to date" },
  { key: "mtd", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "custom", label: "Custom range" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["key"];

export type InsightsRange = { preset: RangePreset; from: string; to: string; label: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 3 * 366;

export function parseInsightsRange(
  params: Record<string, string | undefined>,
  today: string,
): InsightsRange {
  const preset = (RANGE_PRESETS.some((p) => p.key === params.range) ? params.range : "ytd") as RangePreset;
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");

  switch (preset) {
    case "mtd":
      return { preset, from: `${y}-${pad(m)}-01`, to: today, label: "This month" };
    case "lastmonth": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      return { preset, from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(last)}`, label: "Last month" };
    }
    case "30d":
      return { preset, from: addDaysToDateString(today, -29), to: today, label: "Last 30 days" };
    case "90d":
      return { preset, from: addDaysToDateString(today, -89), to: today, label: "Last 90 days" };
    case "custom": {
      let from = DATE.test(params.from ?? "") ? params.from! : `${y}-01-01`;
      let to = DATE.test(params.to ?? "") ? params.to! : today;
      if (from > to) [from, to] = [to, from];
      if (to > today) to = today;
      if (from > to) from = to;
      const earliest = addDaysToDateString(to, -MAX_SPAN_DAYS);
      if (from < earliest) from = earliest;
      return { preset, from, to, label: "Custom range" };
    }
    default:
      return { preset: "ytd", from: `${y}-01-01`, to: today, label: "Year to date" };
  }
}
