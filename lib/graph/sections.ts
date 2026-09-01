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
  isActive: boolean;
};

type SectionFields = {
  Title: string;
  OutletLookupId?: string | number;
  DisplayOrder?: number;
  IsActive?: boolean;
};

function toSection(item: GraphListItem<SectionFields>): Section {
  return {
    id: item.id,
    name: item.fields.Title,
    outletId:
      item.fields.OutletLookupId != null
        ? String(item.fields.OutletLookupId)
        : "",
    displayOrder: item.fields.DisplayOrder ?? 0,
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
  displayOrder: number;
  isActive: boolean;
}): Promise<Section> {
  const { siteId, listId } = await listContext("sections");
  const created = await graphPost<GraphListItem<SectionFields>>(
    `/sites/${siteId}/lists/${listId}/items`,
    {
      fields: {
        Title: input.name,
        OutletLookupId: Number(input.outletId),
        DisplayOrder: input.displayOrder,
        IsActive: input.isActive,
      },
    },
  );
  return toSection(created);
}

export async function updateSection(
  itemId: string,
  input: Partial<{ name: string; displayOrder: number; isActive: boolean }>,
): Promise<void> {
  const { siteId, listId } = await listContext("sections");
  const fields: Partial<SectionFields> = {};
  if (input.name !== undefined) fields.Title = input.name;
  if (input.displayOrder !== undefined) fields.DisplayOrder = input.displayOrder;
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
