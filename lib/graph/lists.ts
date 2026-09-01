/**
 * lib/graph/lists.ts
 *
 * Resolves SharePoint list display names to their internal list IDs, so the
 * rest of the data layer can refer to lists by the human names created in
 * SharePoint ("Sections", "RotationHistory", ...) instead of copying ten
 * GUIDs into environment config.
 *
 * The site's lists are fetched once and cached for the lifetime of the
 * server process. Lists are created once during setup and effectively never
 * change identity, so a long-lived cache is safe; a manual cache-buster is
 * exported for completeness.
 */
import "server-only";

import {
  GraphApiError,
  getSharePointSiteId,
  graphGetAll,
} from "@/lib/graph/client";

/**
 * The exact SharePoint list display names this app depends on. Kept here as
 * the single source of truth so a rename in SharePoint has exactly one place
 * to update, and so typos surface as type errors instead of runtime 404s.
 */
export const LIST = {
  outlets: "Outlets",
  sections: "Sections",
  commodities: "Commodities",
  sectionCommodityMix: "SectionCommodityMix",
  commodityDailyGoals: "CommodityDailyGoals",
  outletSettings: "OutletSettings",
  operatingDays: "OperatingDays",
  operatingDayGoals: "OperatingDayGoals",
  rotationHistory: "RotationHistory",
  adminUsers: "AdminUsers",
  mixChangeLog: "MixChangeLog",
  endOfDayLog: "EndOfDayLog",
  configChangeLog: "ConfigChangeLog",
  notificationSettings: "NotificationSettings",
} as const;

export type ListKey = keyof typeof LIST;

type ListSummary = { id: string; displayName: string; name: string };

let cache: Map<string, string> | null = null;

async function loadListMap(): Promise<Map<string, string>> {
  if (cache) return cache;

  const siteId = getSharePointSiteId();
  const lists = await graphGetAll<ListSummary>(
    `/sites/${siteId}/lists?$select=id,displayName,name&$top=200`,
  );

  const map = new Map<string, string>();
  for (const list of lists) {
    // Index by both displayName and the URL-safe internal name, lower-cased,
    // so resolution is tolerant of which one SharePoint reports.
    if (list.displayName) map.set(list.displayName.toLowerCase(), list.id);
    if (list.name) map.set(list.name.toLowerCase(), list.id);
  }

  cache = map;
  return map;
}

/** Resolve one of the app's known lists to its SharePoint list id. */
export async function resolveListId(key: ListKey): Promise<string> {
  const displayName = LIST[key];
  const map = await loadListMap();
  const id = map.get(displayName.toLowerCase());

  if (!id) {
    throw new GraphApiError(
      `SharePoint list "${displayName}" was not found on the configured site.`,
      404,
      "list_not_found",
    );
  }

  return id;
}

/** Convenience: site id + resolved list id together, since every call needs both. */
export async function listContext(key: ListKey): Promise<{
  siteId: string;
  listId: string;
}> {
  const siteId = getSharePointSiteId();
  const listId = await resolveListId(key);
  return { siteId, listId };
}

/** Clear the cached name→id map (e.g. if lists are recreated). */
export function clearListCache(): void {
  cache = null;
}
