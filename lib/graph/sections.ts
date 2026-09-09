/**
 * lib/graph/sections.ts
 *
 * The "Sections" list - the floor sections WITHIN an outlet (Section A, B,
 * ...). Each row belongs to one outlet via the Outlet lookup. Managed from
 * the Admin Center (add / edit / activate / deactivate / reorder / remove).
 *
 * `DisplayOrder` is doubly meaningful: it orders the buttons on the Input
 * Screen AND defines the rotation cycle (A -> B -> C -> D follows it). The
 * rotation-order rule itself lives in lib/rotation.ts.
 */
import "server-only";

import {
  type GraphListItem,
  graphGetAll,
  graphPost,
  graphPatch,
  graphDelete,
} from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";

export type Section = {
  /** SharePoint list item id. */
  id: string;
  name: string;
  /** Owning outlet's list item id (string form of the lookup id). */
  outletId: string;
  displayOrder: number;
  /**
   * One or more 1-based positions this section occupies in the rotation
   * sequence (a section can appear more than once, e.g. [1, 3]). Falls back to
   * [displayOrder] for legacy rows that predate the RotationOrder column.
   */
  orderPositions: number[];
  isActive: boolean;
};

type SectionFields = {
  Title: string;
  OutletLookupId?: string | number;
  DisplayOrder?: number;
  /** Comma-separated positions, e.g. "1,3". Empty/absent -> use DisplayOrder. */
  RotationOrder?: string;
  IsActive?: boolean;
};

/** Parse a "1,3" style value into sorted, de-duped, 1-based integers. */
export function parseRotationOrder(
  raw: string | undefined | null,
  fallback: number,
): number[] {
  if (raw) {
    const nums = raw
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1);
    if (nums.length > 0) {
      return Array.from(new Set(nums)).sort((a, b) => a - b);
    }
  }
  return [fallback];
}

function toSection(item: GraphListItem<SectionFields>): Section {
  const displayOrder = item.fields.DisplayOrder ?? 0;
  return {
    id: item.id,
    name: item.fields.Title,
    outletId:
      item.fields.OutletLookupId != null
        ? String(item.fields.OutletLookupId)
        : "",
    displayOrder,
    orderPositions: parseRotationOrder(item.fields.RotationOrder, displayOrder),
    isActive: item.fields.IsActive ?? false,
  };
}

function sortSections(sections: Section[]): Section[] {
  return sections.sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
}

/** All sections for one outlet, in rotation/display order. */
export async function listSectionsForOutlet(
  outletId: string,
): Promise<Section[]> {
  const { siteId, listId } = await listContext("sections");
  const items = await graphGetAll<GraphListItem<SectionFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=500`,
  );
  return sortSections(
    items.map(toSection).filter((s) => s.outletId === String(outletId)),
  );
}

/** Only the active sections for one outlet (those that rotate / are shown). */
export async function listActiveSectionsForOutlet(
  outletId: string,
): Promise<Section[]> {
  return (await listSectionsForOutlet(outletId)).filter((s) => s.isActive);
}

export async function createSection(input: {
  name: string;
  outletId: string;
  orderPositions: number[];
  isActive: boolean;
}): Promise<Section> {
  const { siteId, listId } = await listContext("sections");
  const created = await graphPost<GraphListItem<SectionFields>>(
    `/sites/${siteId}/lists/${listId}/items`,
    {
      fields: {
        Title: input.name,
        OutletLookupId: Number(input.outletId),
        // DisplayOrder is kept in sync with the first position so list sorting
        // and any legacy reads stay sensible.
        DisplayOrder: Math.min(...input.orderPositions),
        RotationOrder: input.orderPositions.join(","),
        IsActive: input.isActive,
      },
    },
  );
  return toSection(created);
}

export async function updateSection(
  itemId: string,
  input: Partial<{ name: string; orderPositions: number[]; isActive: boolean }>,
): Promise<void> {
  const { siteId, listId } = await listContext("sections");
  const fields: Partial<SectionFields> = {};
  if (input.name !== undefined) fields.Title = input.name;
  if (input.orderPositions !== undefined) {
    fields.DisplayOrder = Math.min(...input.orderPositions);
    fields.RotationOrder = input.orderPositions.join(",");
  }
  if (input.isActive !== undefined) fields.IsActive = input.isActive;
  await graphPatch(
    `/sites/${siteId}/lists/${listId}/items/${itemId}/fields`,
    fields,
  );
}

export async function deleteSection(itemId: string): Promise<void> {
  const { siteId, listId } = await listContext("sections");
  await graphDelete(`/sites/${siteId}/lists/${listId}/items/${itemId}`);
}
