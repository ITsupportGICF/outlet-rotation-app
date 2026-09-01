/**
 * lib/graph/outlets.ts
 *
 * The "Outlets" list - the physical store locations (Taft, Pine Hills, ...).
 * Every other operational list is scoped to an outlet by lookup, so adding a
 * store later is just adding a row here.
 */
import "server-only";

import {
  type GraphListItem,
  graphGetAll,
  graphPost,
  graphPatch,
} from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";

export type Outlet = {
  /** SharePoint list item id. */
  id: string;
  name: string;
  isActive: boolean;
};

type OutletFields = {
  Title: string;
  IsActive?: boolean;
};

function toOutlet(item: GraphListItem<OutletFields>): Outlet {
  return {
    id: item.id,
    name: item.fields.Title,
    isActive: item.fields.IsActive ?? false,
  };
}

/** All outlets, active first then by name. */
export async function listOutlets(): Promise<Outlet[]> {
  const { siteId, listId } = await listContext("outlets");
  const items = await graphGetAll<GraphListItem<OutletFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=200`,
  );
  return items
    .map(toOutlet)
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name),
    );
}

export async function listActiveOutlets(): Promise<Outlet[]> {
  return (await listOutlets()).filter((o) => o.isActive);
}

/** A single outlet by id, or null if it doesn't exist / isn't readable. */
export async function getOutlet(outletId: string): Promise<Outlet | null> {
  const outlets = await listOutlets();
  return outlets.find((o) => o.id === outletId) ?? null;
}

export async function createOutlet(input: {
  name: string;
  isActive: boolean;
}): Promise<Outlet> {
  const { siteId, listId } = await listContext("outlets");
  const created = await graphPost<GraphListItem<OutletFields>>(
    `/sites/${siteId}/lists/${listId}/items`,
    { fields: { Title: input.name, IsActive: input.isActive } },
  );
  return toOutlet(created);
}

export async function updateOutlet(
  itemId: string,
  input: Partial<{ name: string; isActive: boolean }>,
): Promise<void> {
  const { siteId, listId } = await listContext("outlets");
  const fields: Partial<OutletFields> = {};
  if (input.name !== undefined) fields.Title = input.name;
  if (input.isActive !== undefined) fields.IsActive = input.isActive;
  await graphPatch(
    `/sites/${siteId}/lists/${listId}/items/${itemId}/fields`,
    fields,
  );
}
