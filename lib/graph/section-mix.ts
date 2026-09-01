/**
 * lib/graph/section-mix.ts
 *
 * The "SectionCommodityMix" list - the persistent "when this section is
 * rotated, how many of each commodity goes out" configuration. One row per
 * (Section, Commodity) pair. This is what a single Rotate press expands into:
 * one RotationHistory row per commodity, using these quantities.
 */
import "server-only";

import {
  type GraphListItem,
  graphGetAll,
  graphPost,
  graphPatch,
  NON_INDEXED_QUERY_HEADER,
} from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";

export type MixEntry = {
  id: string;
  sectionId: string;
  commodityId: string;
  quantity: number;
};

type MixFields = {
  Title?: string;
  SectionLookupId?: string | number;
  CommodityLookupId?: string | number;
  Quantity?: number;
};

function toMixEntry(item: GraphListItem<MixFields>): MixEntry {
  return {
    id: item.id,
    sectionId:
      item.fields.SectionLookupId != null
        ? String(item.fields.SectionLookupId)
        : "",
    commodityId:
      item.fields.CommodityLookupId != null
        ? String(item.fields.CommodityLookupId)
        : "",
    quantity: item.fields.Quantity ?? 0,
  };
}

async function listAllMix(): Promise<MixEntry[]> {
  const { siteId, listId } = await listContext("sectionCommodityMix");
  const items = await graphGetAll<GraphListItem<MixFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=2000`,
  );
  return items.map(toMixEntry);
}

/**
 * The mix rows for a single section (one per commodity that section rotates).
 * Filtered server-side by the Section lookup — this is on the hot rotation
 * path (every Rotate press calls it), so it must not fetch and scan the whole
 * mix list.
 */
export async function listMixForSection(
  sectionId: string,
): Promise<MixEntry[]> {
  const { siteId, listId } = await listContext("sectionCommodityMix");
  const items = await graphGetAll<GraphListItem<MixFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=2000&$filter=fields/SectionLookupId eq ${Number(
      sectionId,
    )}`,
    NON_INDEXED_QUERY_HEADER,
  );
  return items.map(toMixEntry).filter((m) => m.sectionId === String(sectionId));
}

/** All mix rows for a set of sections, keyed by sectionId -> commodityId -> qty. */
export async function getMixMap(
  sectionIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const wanted = new Set(sectionIds.map(String));
  const all = await listAllMix();
  const map = new Map<string, Map<string, number>>();
  for (const entry of all) {
    if (!wanted.has(entry.sectionId)) continue;
    let inner = map.get(entry.sectionId);
    if (!inner) {
      inner = new Map<string, number>();
      map.set(entry.sectionId, inner);
    }
    inner.set(entry.commodityId, entry.quantity);
  }
  return map;
}

/**
 * Set the quantity for one (section, commodity) pair. Updates the existing
 * row if there is one, otherwise creates it - so the Admin Center can edit a
 * mix grid without the caller tracking which cells already exist.
 */
export async function setMixQuantity(input: {
  sectionId: string;
  sectionName: string;
  commodityId: string;
  commodityName: string;
  quantity: number;
}): Promise<void> {
  const { siteId, listId } = await listContext("sectionCommodityMix");
  const existing = (await listMixForSection(input.sectionId)).find(
    (m) => m.commodityId === String(input.commodityId),
  );

  if (existing) {
    await graphPatch(
      `/sites/${siteId}/lists/${listId}/items/${existing.id}/fields`,
      { Quantity: input.quantity },
    );
    return;
  }

  await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
    fields: {
      Title: `${input.sectionName} — ${input.commodityName}`,
      SectionLookupId: Number(input.sectionId),
      CommodityLookupId: Number(input.commodityId),
      Quantity: input.quantity,
    },
  });
}

/** One commodity line in a section-mix save: its quantity before and after. */
export type MixLine = {
  commodityId: string;
  commodityName: string;
  from: number;
  to: number;
};

/**
 * Save a whole section's mix in one pass. Reads the section's existing rows
 * ONCE (the previous per-commodity setMixQuantity loop re-fetched the entire
 * mix list for every commodity), then patches only the rows whose quantity
 * actually changed and creates rows only for newly non-zero commodities. A
 * commodity that is zero and has no row is left absent (getMixMap reads a
 * missing row as 0), so we never create rows full of zeros.
 *
 * Returns one MixLine per entry (in the order given) with the before/after
 * quantity, so the caller can both tell whether anything changed and describe
 * the change per commodity.
 */
export async function setSectionMix(input: {
  sectionId: string;
  sectionName: string;
  entries: { commodityId: string; commodityName: string; quantity: number }[];
}): Promise<MixLine[]> {
  const { siteId, listId } = await listContext("sectionCommodityMix");
  const existing = await listMixForSection(input.sectionId);
  const byCommodity = new Map(existing.map((m) => [m.commodityId, m]));

  const lines: MixLine[] = [];
  for (const entry of input.entries) {
    const key = String(entry.commodityId);
    const current = byCommodity.get(key);
    const from = current?.quantity ?? 0;
    const to = entry.quantity;
    lines.push({
      commodityId: key,
      commodityName: entry.commodityName,
      from,
      to,
    });

    if (current) {
      if (from !== to) {
        await graphPatch(
          `/sites/${siteId}/lists/${listId}/items/${current.id}/fields`,
          { Quantity: to },
        );
      }
    } else if (to > 0) {
      await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
        fields: {
          Title: `${input.sectionName} — ${entry.commodityName}`,
          SectionLookupId: Number(input.sectionId),
          CommodityLookupId: Number(entry.commodityId),
          Quantity: to,
        },
      });
    }
  }
  return lines;
}
