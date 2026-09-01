/**
 * lib/graph/rotation-history.ts
 *
 * The "RotationHistory" list - the core, append-only fact table. One row per
 * commodity per rotation. Rows are NEVER edited or deleted; a correction is a
 * new row (typically a Manual rotation). Everything the Live Dashboard shows
 * for a day (last-rotated section, freshness, goal progress) is derived from
 * these rows.
 */
import "server-only";

import {
  type GraphListItem,
  graphGetAll,
  graphPost,
  NON_INDEXED_QUERY_HEADER,
} from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";

export type RotationType = "Standard" | "Manual" | "Override";

export type RotationRow = {
  id: string;
  operatingDayId: string;
  outletId: string;
  sectionId: string;
  commodityId: string;
  quantity: number;
  rotationType: RotationType;
  performedByEmail: string | null;
  rotatedAt: string | null;
};

type RotationFields = {
  Title?: string;
  OperatingDayLookupId?: string | number;
  OutletLookupId?: string | number;
  SectionLookupId?: string | number;
  CommodityLookupId?: string | number;
  Quantity?: number;
  RotationType?: string;
  PerformedByEmail?: string;
  RotatedAt?: string;
};

function toRow(item: GraphListItem<RotationFields>): RotationRow {
  return {
    id: item.id,
    operatingDayId:
      item.fields.OperatingDayLookupId != null
        ? String(item.fields.OperatingDayLookupId)
        : "",
    outletId:
      item.fields.OutletLookupId != null
        ? String(item.fields.OutletLookupId)
        : "",
    sectionId:
      item.fields.SectionLookupId != null
        ? String(item.fields.SectionLookupId)
        : "",
    commodityId:
      item.fields.CommodityLookupId != null
        ? String(item.fields.CommodityLookupId)
        : "",
    quantity: item.fields.Quantity ?? 0,
    rotationType:
      item.fields.RotationType === "Manual"
        ? "Manual"
        : item.fields.RotationType === "Override"
          ? "Override"
          : "Standard",
    performedByEmail: item.fields.PerformedByEmail ?? null,
    rotatedAt: item.fields.RotatedAt ?? null,
  };
}

/**
 * All rotation rows for one operating day. Filtered by the OperatingDay
 * lookup so it stays cheap as the table grows; the non-indexed-query header
 * keeps it working even before that lookup column is indexed in SharePoint.
 */
export async function getRotationsForOperatingDay(
  operatingDayId: string,
): Promise<RotationRow[]> {
  const { siteId, listId } = await listContext("rotationHistory");
  const items = await graphGetAll<GraphListItem<RotationFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=2000&$filter=fields/OperatingDayLookupId eq ${Number(
      operatingDayId,
    )}`,
    NON_INDEXED_QUERY_HEADER,
  );
  return items.map(toRow);
}

/**
 * Append one rotation "press": one row per commodity in the section's mix,
 * all sharing the same RotatedAt / Section / OperatingDay / performer. Rows
 * are written sequentially so a throttled write surfaces as a clear error
 * rather than a silent gap.
 */
export async function appendRotation(input: {
  operatingDayId: string;
  outletId: string;
  sectionId: string;
  sectionName: string;
  rotationType: RotationType;
  performedByEmail: string;
  commodities: { commodityId: string; commodityName: string; quantity: number }[];
}): Promise<number> {
  const { siteId, listId } = await listContext("rotationHistory");
  const rotatedAt = new Date().toISOString();

  let written = 0;
  for (const c of input.commodities) {
    await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
      fields: {
        Title: `${input.sectionName} — ${c.commodityName} — ${rotatedAt}`,
        OperatingDayLookupId: Number(input.operatingDayId),
        OutletLookupId: Number(input.outletId),
        SectionLookupId: Number(input.sectionId),
        CommodityLookupId: Number(c.commodityId),
        Quantity: c.quantity,
        RotationType: input.rotationType,
        PerformedByEmail: input.performedByEmail,
        RotatedAt: rotatedAt,
      },
    });
    written += 1;
  }
  return written;
}

/**
 * Record an Override: the section was intentionally skipped. Writes a single
 * row (Quantity 0, no commodity) with RotationType=Override. It carries a
 * Section + RotatedAt so it advances the rotation cycle to the next section,
 * but its zero quantity means it never affects commodity goal totals, and the
 * dashboard excludes it from "last rotation" freshness. Power Automate watches
 * for these rows to send the override email.
 */
export async function appendOverride(input: {
  operatingDayId: string;
  outletId: string;
  sectionId: string;
  sectionName: string;
  performedByEmail: string;
}): Promise<void> {
  const { siteId, listId } = await listContext("rotationHistory");
  const rotatedAt = new Date().toISOString();
  await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
    fields: {
      Title: `OVERRIDE — ${input.sectionName} — ${rotatedAt}`,
      OperatingDayLookupId: Number(input.operatingDayId),
      OutletLookupId: Number(input.outletId),
      SectionLookupId: Number(input.sectionId),
      Quantity: 0,
      RotationType: "Override",
      PerformedByEmail: input.performedByEmail,
      RotatedAt: rotatedAt,
    },
  });
}

/** The id of the section rotated most recently in a day (null if none). */
export function lastRotatedSectionId(rows: RotationRow[]): string | null {
  let latest: RotationRow | null = null;
  for (const row of rows) {
    if (!row.rotatedAt) continue;
    if (!latest || row.rotatedAt > (latest.rotatedAt ?? "")) {
      latest = row;
    }
  }
  return latest?.sectionId ?? null;
}
