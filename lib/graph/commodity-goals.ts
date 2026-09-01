/**
 * lib/graph/commodity-goals.ts
 *
 * The "CommodityDailyGoals" list - the persistent per-outlet, per-commodity
 * daily target ("Textiles: 6/day"). Set once in the Admin Center and reused
 * every day until changed. At Start Day these are snapshotted onto
 * OperatingDayGoals so a later edit never rewrites a day already in progress.
 */
import "server-only";

import {
  type GraphListItem,
  graphGetAll,
  graphPost,
  graphPatch,
} from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";

export type CommodityGoal = {
  id: string;
  outletId: string;
  commodityId: string;
  dailyGoal: number;
};

type GoalFields = {
  Title?: string;
  OutletLookupId?: string | number;
  CommodityLookupId?: string | number;
  DailyGoal?: number;
};

function toGoal(item: GraphListItem<GoalFields>): CommodityGoal {
  return {
    id: item.id,
    outletId:
      item.fields.OutletLookupId != null
        ? String(item.fields.OutletLookupId)
        : "",
    commodityId:
      item.fields.CommodityLookupId != null
        ? String(item.fields.CommodityLookupId)
        : "",
    dailyGoal: item.fields.DailyGoal ?? 0,
  };
}

async function listAllGoals(): Promise<CommodityGoal[]> {
  const { siteId, listId } = await listContext("commodityDailyGoals");
  const items = await graphGetAll<GraphListItem<GoalFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=2000`,
  );
  return items.map(toGoal);
}

/** The daily commodity goals configured for one outlet. */
export async function listGoalsForOutlet(
  outletId: string,
): Promise<CommodityGoal[]> {
  return (await listAllGoals()).filter((g) => g.outletId === String(outletId));
}

/**
 * Upsert one (outlet, commodity) daily goal - patches the existing row or
 * creates it, so the Admin Center can edit a goals grid freely.
 */
export async function setCommodityGoal(input: {
  outletId: string;
  outletName: string;
  commodityId: string;
  commodityName: string;
  dailyGoal: number;
}): Promise<void> {
  const { siteId, listId } = await listContext("commodityDailyGoals");
  const existing = (await listGoalsForOutlet(input.outletId)).find(
    (g) => g.commodityId === String(input.commodityId),
  );

  if (existing) {
    await graphPatch(
      `/sites/${siteId}/lists/${listId}/items/${existing.id}/fields`,
      { DailyGoal: input.dailyGoal },
    );
    return;
  }

  await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
    fields: {
      Title: `${input.outletName} — ${input.commodityName}`,
      OutletLookupId: Number(input.outletId),
      CommodityLookupId: Number(input.commodityId),
      DailyGoal: input.dailyGoal,
    },
  });
}

/**
 * Save all of an outlet's daily goals in one pass. Reads the outlet's existing
 * goal rows ONCE (the previous per-commodity setCommodityGoal loop re-fetched
 * the whole goals list for every commodity), then patches only changed rows and
 * creates rows only for newly non-zero goals.
 */
export async function setOutletGoals(input: {
  outletId: string;
  outletName: string;
  entries: { commodityId: string; commodityName: string; dailyGoal: number }[];
}): Promise<void> {
  const { siteId, listId } = await listContext("commodityDailyGoals");
  const existing = await listGoalsForOutlet(input.outletId);
  const byCommodity = new Map(existing.map((g) => [g.commodityId, g]));

  for (const entry of input.entries) {
    const current = byCommodity.get(String(entry.commodityId));
    if (current) {
      if (current.dailyGoal !== entry.dailyGoal) {
        await graphPatch(
          `/sites/${siteId}/lists/${listId}/items/${current.id}/fields`,
          { DailyGoal: entry.dailyGoal },
        );
      }
    } else if (entry.dailyGoal > 0) {
      await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
        fields: {
          Title: `${input.outletName} — ${entry.commodityName}`,
          OutletLookupId: Number(input.outletId),
          CommodityLookupId: Number(entry.commodityId),
          DailyGoal: entry.dailyGoal,
        },
      });
    }
  }
}
