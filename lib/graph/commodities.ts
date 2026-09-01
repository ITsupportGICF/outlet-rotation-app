/**
 * lib/graph/commodities.ts
 *
 * The "Commodities" list - the standard commodity categories (Textiles,
 * Wares, Shoes, Accessories, Books & Media). Shared across all outlets. Kept
 * as data (not hard-coded) so a sixth can be added later without a code
 * change.
 */
import "server-only";

import { type GraphListItem, graphGetAll } from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";

export type Commodity = {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
};

type CommodityFields = {
  Title: string;
  DisplayOrder?: number;
  IsActive?: boolean;
};

function toCommodity(item: GraphListItem<CommodityFields>): Commodity {
  return {
    id: item.id,
    name: item.fields.Title,
    displayOrder: item.fields.DisplayOrder ?? 0,
    isActive: item.fields.IsActive ?? false,
  };
}

/** All commodities in display order. */
export async function listCommodities(): Promise<Commodity[]> {
  const { siteId, listId } = await listContext("commodities");
  const items = await graphGetAll<GraphListItem<CommodityFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=200`,
  );
  return items
    .map(toCommodity)
    .sort(
      (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    );
}

export async function listActiveCommodities(): Promise<Commodity[]> {
  return (await listCommodities()).filter((c) => c.isActive);
}
