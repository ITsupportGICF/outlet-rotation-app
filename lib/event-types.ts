/**
 * lib/event-types.ts
 *
 * Every kind of event the Admin Event Log can show, grouped for the "Action"
 * filter. Pure data (no I/O), so both the server and the page can use it.
 */

export const EVENT_GROUPS = [
  {
    group: "Rotations",
    types: ["Section Rotated", "Section Skipped (Override)", "Manual Rotation", "Rotation Undone"],
  },
  { group: "Operating Day", types: ["Day Started", "Day Ended"] },
  {
    group: "Admin Access",
    types: ["Admin Sign-in", "Admin Sign-in Failed", "Admin Sign-out"],
  },
  {
    group: "Sections",
    types: [
      "Section Added",
      "Section Updated",
      "Section Activated",
      "Section Deactivated",
      "Section Removed",
      "Rotation Order Changed",
    ],
  },
  {
    group: "Mix & Goals",
    types: ["Section Mix Changed", "Daily Goals Saved", "Goals Applied to Today"],
  },
  { group: "Settings", types: ["Store Settings Saved", "Notification Settings Saved"] },
  { group: "Locations", types: ["Location Added", "Location Activated", "Location Deactivated"] },
  {
    group: "Users",
    types: [
      "Account Created",
      "Account Setup Completed",
      "Permission Level Changed",
      "Account Activated",
      "Account Deactivated",
      "Account Deleted",
      "Password Set",
      "Username Changed",
      "Invite Resent",
    ],
  },
  {
    group: "System",
    types: [
      "Maintenance Mode On",
      "Maintenance Time Updated",
      "Maintenance Mode Off",
      "Kill Switch Engaged",
      "Kill Switch Released",
    ],
  },
] as const;

export type EventType = (typeof EVENT_GROUPS)[number]["types"][number];

const GROUP_OF = new Map<string, string>();
for (const g of EVENT_GROUPS) for (const t of g.types) GROUP_OF.set(t, g.group);

/** The filter group an event type belongs to ("Other" for unknown types). */
export function eventGroup(type: string): string {
  return GROUP_OF.get(type) ?? "Other";
}

/** One row in the Event Log. */
export type LogEvent = {
  /** Stable id for React keys. */
  id: string;
  /** ISO timestamp of when it happened. */
  at: string;
  type: string;
  /** Store name, when the event belongs to one. */
  outlet: string | null;
  /** Who did it (name, admin username or email), when known. */
  actor: string | null;
  details: string;
  /**
   * "recorded": written to the EventLog list when it happened.
   * "records": rebuilt from the app's existing data (rotations, days, …).
   */
  source: "recorded" | "records";
  /** Used to drop a rebuilt event when the same event was also recorded. */
  key?: string;
};
