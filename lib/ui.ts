/**
 * lib/ui.ts
 *
 * Shared, framework-free UI constants (colors, status palettes). Pure - safe
 * to import from server or client components. Keeps the white / light-blue /
 * dark-blue + gold theme consistent across every page.
 */
import type { PaceStatus } from "@/lib/time";

export const COLORS = {
  navy: "#ffffff",
  navyMid: "rgba(226,235,245,0.72)",
  blue: "#f5c451",
  slate: "rgba(226,235,245,0.72)",
  slateSoft: "rgba(226,235,245,0.50)",
  gold: "#f5c451",
  goldSoft: "#f5c451",
  bg: "#eef4fb",
  panel: "#ffffff",
} as const;

export type StatusStyle = {
  bg: string;
  text: string;
  solid: string;
  label: string;
};

const STATUS_STYLES: Record<PaceStatus, StatusStyle> = {
  green: { bg: "#dff3e6", text: "#1c7a44", solid: "#1c7a44", label: "On pace" },
  yellow: { bg: "#fdf3d9", text: "#8a6d0b", solid: "#d9a406", label: "Slightly behind" },
  red: { bg: "#fdecec", text: "#c23b3b", solid: "#c23b3b", label: "Behind" },
};

const NEUTRAL: StatusStyle = {
  bg: "#e8f0fa",
  text: "rgba(226,235,245,0.72)",
  solid: "rgba(226,235,245,0.50)",
  label: "—",
};

export function statusStyle(status: PaceStatus | "none"): StatusStyle {
  return status === "none" ? NEUTRAL : STATUS_STYLES[status];
}

/** Freshness label from a section's status (distinct wording from pacing). */
export function freshnessLabel(status: PaceStatus | "none"): string {
  switch (status) {
    case "green":
      return "Fresh";
    case "yellow":
      return "Getting stale";
    case "red":
      return "Needs rotation";
    default:
      return "Not rotated yet";
  }
}
