/**
 * lib/graph/operating-day-goals.ts
 *
 * The "OperatingDayGoals" list - a snapshot of each commodity's goal taken at
 * Start Day. The Live Dashboard paces against THESE, not the live
 * CommodityDailyGoals, so editing a goal mid-day (or the next day) never
 * rewrites how a day already under way is measured.
 */
import "server-only";

import {
  type GraphListItem,
  graphGetAll,
  graphPost,
  graphPatch,
} from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";

export type OperatingDayGoal = {
  id: string;
  operatingDayId: string;
  commodityId: string;
  goalQuantity: number;
};

type DayGoalFields = {
  Title?: string;
  OperatingDayLookupId?: string | number;
  CommodityLookupId?: string | number;
  GoalQuantity?: number;
};

function toDayGoal(item: GraphListItem<DayGoalFields>): OperatingDayGoal {
  return {
    id: item.id,
    operatingDayId:
      item.fields.OperatingDayLookupId != null
        ? String(item.fields.OperatingDayLookupId)
        : "",
    commodityId:
      item.fields.CommodityLookupId != null
        ? String(item.fields.CommodityLookupId)
        : "",
    goalQuantity: item.fields.GoalQuantity ?? 0,
  };
}

/** The snapshotted goals for one operating day, keyed by commodityId -> goal. */
export async function getDayGoals(
  operatingDayId: string,
): Promise<Map<string, number>> {
  const { siteId, listId } = await listContext("operatingDayGoals");
  const items = await graphGetAll<GraphListItem<DayGoalFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=2000`,
  );
  const map = new Map<string, number>();
  for (const raw of items) {
    const g = toDayGoal(raw);
    if (g.operatingDayId === String(operatingDayId)) {
      map.set(g.commodityId, g.goalQuantity);
    }
  }
  return map;
}

/** The snapshotted goal rows (with ids) for one operating day. */
async function listDayGoalRows(
  operatingDayId: string,
): Promise<OperatingDayGoal[]> {
  const { siteId, listId } = await listContext("operatingDayGoals");
  const items = await graphGetAll<GraphListItem<DayGoalFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=2000`,
  );
  return items
    .map(toDayGoal)
    .filter((g) => g.operatingDayId === String(operatingDayId));
}

/**
 * Re-apply goal quantities onto an already-open operating day's snapshot.
 * Start Day snapshots goals once; this lets an admin explicitly push a later
 * goal edit onto today's open day (the dashboard reads THIS snapshot). Reads
 * the day's existing rows once, then patches only changed rows and creates rows
 * only for newly non-zero goals.
 */
export async function setDayGoals(input: {
  operatingDayId: string;
  titlePrefix: string;
  entries: { commodityId: string; commodityName: string; goalQuantity: number }[];
}): Promise<void> {
  const { siteId, listId } = await listContext("operatingDayGoals");
  const existing = await listDayGoalRows(input.operatingDayId);
  const byCommodity = new Map(existing.map((g) => [g.commodityId, g]));

  for (const entry of input.entries) {
    const current = byCommodity.get(String(entry.commodityId));
    if (current) {
      if (current.goalQuantity !== entry.goalQuantity) {
        await graphPatch(
          `/sites/${siteId}/lists/${listId}/items/${current.id}/fields`,
          { GoalQuantity: entry.goalQuantity },
        );
      }
    } else if (entry.goalQuantity > 0) {
      await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
        fields: {
          Title: `${input.titlePrefix} — ${entry.commodityName}`,
          OperatingDayLookupId: Number(input.operatingDayId),
          CommodityLookupId: Number(entry.commodityId),
          GoalQuantity: entry.goalQuantity,
        },
      });
    }
  }
}

/** Write one snapshotted goal row (called once per commodity at Start Day). */
export async function createDayGoal(input: {
  operatingDayId: string;
  title: string;
  commodityId: string;
  goalQuantity: number;
}): Promise<void> {
  const { siteId, listId } = await listContext("operatingDayGoals");
  await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
    fields: {
      Title: input.title,
      OperatingDayLookupId: Number(input.operatingDayId),
      CommodityLookupId: Number(input.commodityId),
      GoalQuantity: input.goalQuantity,
    },
  });
}
