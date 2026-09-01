/**
 * lib/graph/operating-days.ts
 *
 * The "OperatingDays" list - one row created every time Start Day is pressed
 * for an outlet. Everything for a given day (rotations, goal progress) hangs
 * off this row, and its snapshotted hours/thresholds are what the Live
 * Dashboard's pace and freshness calculations use - never the live
 * OutletSettings, which may have been edited mid-day.
 */
import "server-only";

import {
  type GraphListItem,
  graphGetAll,
  graphGet,
  graphPost,
  graphPatch,
  NON_INDEXED_QUERY_HEADER,
} from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";

export type OperatingDayStatus = "Open" | "Closed";

export type OperatingDay = {
  id: string;
  outletId: string;
  operatingDate: string | null;
  status: OperatingDayStatus;
  startedAt: string | null;
  startedByEmail: string | null;
  endedAt: string | null;
  endedByEmail: string | null;
  operatingHoursStart: string | null;
  operatingHoursEnd: string | null;
  greenThresholdMinutes: number;
  yellowThresholdMinutes: number;
};

type OperatingDayFields = {
  Title?: string;
  OutletLookupId?: string | number;
  OperatingDate?: string;
  Status?: string;
  StartedAt?: string;
  StartedByEmail?: string;
  EndedAt?: string;
  EndedByEmail?: string;
  OperatingHoursStart?: string;
  OperatingHoursEnd?: string;
  GreenThresholdMinutes?: number;
  YellowThresholdMinutes?: number;
};

function toOperatingDay(item: GraphListItem<OperatingDayFields>): OperatingDay {
  return {
    id: item.id,
    outletId:
      item.fields.OutletLookupId != null
        ? String(item.fields.OutletLookupId)
        : "",
    operatingDate: item.fields.OperatingDate ?? null,
    status: item.fields.Status === "Closed" ? "Closed" : "Open",
    startedAt: item.fields.StartedAt ?? null,
    startedByEmail: item.fields.StartedByEmail ?? null,
    endedAt: item.fields.EndedAt ?? null,
    endedByEmail: item.fields.EndedByEmail ?? null,
    operatingHoursStart: item.fields.OperatingHoursStart ?? null,
    operatingHoursEnd: item.fields.OperatingHoursEnd ?? null,
    greenThresholdMinutes: item.fields.GreenThresholdMinutes ?? 60,
    yellowThresholdMinutes: item.fields.YellowThresholdMinutes ?? 120,
  };
}

/**
 * The outlet's currently-open operating day, or null if the day hasn't been
 * started (or was already ended). If more than one is somehow Open, the most
 * recently started wins.
 */
export async function getOpenOperatingDay(
  outletId: string,
): Promise<OperatingDay | null> {
  const outletKey = Number(outletId);
  if (!Number.isFinite(outletKey)) return null;

  const { siteId, listId } = await listContext("operatingDays");
  // Filter to just this outlet's operating days (grows only ~1/day/outlet) so
  // the open day is always in the result no matter how large the list gets -
  // an unfiltered scan would eventually push the open day past the page cap.
  const items = await graphGetAll<GraphListItem<OperatingDayFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=500&$filter=fields/OutletLookupId eq ${outletKey}`,
    NON_INDEXED_QUERY_HEADER,
  );
  const open = items
    .map(toOperatingDay)
    .filter((d) => d.status === "Open")
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return open[0] ?? null;
}

export async function getOperatingDayById(
  itemId: string,
): Promise<OperatingDay | null> {
  const { siteId, listId } = await listContext("operatingDays");
  try {
    const item = await graphGet<GraphListItem<OperatingDayFields>>(
      `/sites/${siteId}/lists/${listId}/items/${itemId}?$expand=fields`,
    );
    return toOperatingDay(item);
  } catch {
    return null;
  }
}

/** Create the operating day (Start Day). Caller supplies the snapshot values. */
export async function createOperatingDay(input: {
  outletId: string;
  title: string;
  operatingDate: string;
  startedByEmail: string;
  operatingHoursStart: string | null;
  operatingHoursEnd: string | null;
  greenThresholdMinutes: number;
  yellowThresholdMinutes: number;
}): Promise<OperatingDay> {
  const { siteId, listId } = await listContext("operatingDays");
  const fields: OperatingDayFields = {
    Title: input.title,
    OutletLookupId: Number(input.outletId),
    OperatingDate: input.operatingDate,
    Status: "Open",
    StartedAt: new Date().toISOString(),
    StartedByEmail: input.startedByEmail,
    GreenThresholdMinutes: input.greenThresholdMinutes,
    YellowThresholdMinutes: input.yellowThresholdMinutes,
  };
  if (input.operatingHoursStart)
    fields.OperatingHoursStart = input.operatingHoursStart;
  if (input.operatingHoursEnd)
    fields.OperatingHoursEnd = input.operatingHoursEnd;

  const created = await graphPost<GraphListItem<OperatingDayFields>>(
    `/sites/${siteId}/lists/${listId}/items`,
    { fields },
  );
  return toOperatingDay(created);
}

/** Close the operating day (End Day). */
export async function closeOperatingDay(
  itemId: string,
  endedByEmail: string,
): Promise<void> {
  const { siteId, listId } = await listContext("operatingDays");
  await graphPatch(
    `/sites/${siteId}/lists/${listId}/items/${itemId}/fields`,
    {
      Status: "Closed",
      EndedAt: new Date().toISOString(),
      EndedByEmail: endedByEmail,
    },
  );
}
