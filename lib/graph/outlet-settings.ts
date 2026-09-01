/**
 * lib/graph/outlet-settings.ts
 *
 * The "OutletSettings" list - one row per outlet holding operating hours,
 * freshness thresholds, and the misc amount. These are the LIVE settings;
 * Start Day snapshots the hour/threshold values onto the OperatingDays row so
 * a later edit never changes how an in-progress day is calculated.
 *
 * OperatingHoursStart/End are stored in "Date and Time" columns (SharePoint
 * has no standalone Time column type). Only the time-of-day portion is
 * meaningful; lib/time.ts parses it tolerantly (ISO datetime OR "HH:MM" OR
 * "8:00 AM"), so the app works regardless of exactly how the value was
 * entered.
 */
import "server-only";

import {
  type GraphListItem,
  graphGetAll,
  graphPost,
  graphPatch,
} from "@/lib/graph/client";
import { listContext } from "@/lib/graph/lists";

export type OutletSettings = {
  /** SharePoint list item id of the settings row, or null if none yet. */
  id: string | null;
  outletId: string;
  /** Raw stored values - parse the hours with lib/time.parseTimeOfDay(). */
  operatingHoursStart: string | null;
  operatingHoursEnd: string | null;
  greenThresholdMinutes: number;
  yellowThresholdMinutes: number;
  miscAmount: number;
  updatedByEmail: string | null;
  updatedAt: string | null;
};

type SettingsFields = {
  Title?: string;
  OutletLookupId?: string | number;
  OperatingHoursStart?: string;
  OperatingHoursEnd?: string;
  GreenThresholdMinutes?: number;
  YellowThresholdMinutes?: number;
  MiscAmount?: number;
  UpdatedByEmail?: string;
  UpdatedAt?: string;
};

// Sensible defaults so the app still renders coherently before an outlet's
// settings row has been filled in.
const DEFAULT_GREEN_MINUTES = 60;
const DEFAULT_YELLOW_MINUTES = 120;

function toSettings(
  outletId: string,
  item: GraphListItem<SettingsFields> | null,
): OutletSettings {
  return {
    id: item?.id ?? null,
    outletId: String(outletId),
    operatingHoursStart: item?.fields.OperatingHoursStart ?? null,
    operatingHoursEnd: item?.fields.OperatingHoursEnd ?? null,
    greenThresholdMinutes:
      item?.fields.GreenThresholdMinutes ?? DEFAULT_GREEN_MINUTES,
    yellowThresholdMinutes:
      item?.fields.YellowThresholdMinutes ?? DEFAULT_YELLOW_MINUTES,
    miscAmount: item?.fields.MiscAmount ?? 0,
    updatedByEmail: item?.fields.UpdatedByEmail ?? null,
    updatedAt: item?.fields.UpdatedAt ?? null,
  };
}

async function findSettingsItem(
  outletId: string,
): Promise<GraphListItem<SettingsFields> | null> {
  const { siteId, listId } = await listContext("outletSettings");
  const items = await graphGetAll<GraphListItem<SettingsFields>>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=200`,
  );
  return (
    items.find(
      (i) => String(i.fields.OutletLookupId ?? "") === String(outletId),
    ) ?? null
  );
}

/** Settings for one outlet, filled with defaults if no row exists yet. */
export async function getOutletSettings(
  outletId: string,
): Promise<OutletSettings> {
  return toSettings(outletId, await findSettingsItem(outletId));
}

/**
 * Upsert an outlet's settings. Any field left undefined is unchanged.
 * Always stamps UpdatedByEmail / UpdatedAt.
 */
export async function saveOutletSettings(input: {
  outletId: string;
  outletName: string;
  updatedByEmail: string;
  operatingHoursStart?: string;
  operatingHoursEnd?: string;
  greenThresholdMinutes?: number;
  yellowThresholdMinutes?: number;
  miscAmount?: number;
}): Promise<void> {
  const { siteId, listId } = await listContext("outletSettings");
  const existing = await findSettingsItem(input.outletId);

  const fields: SettingsFields = {
    UpdatedByEmail: input.updatedByEmail,
    UpdatedAt: new Date().toISOString(),
  };
  if (input.operatingHoursStart !== undefined)
    fields.OperatingHoursStart = input.operatingHoursStart;
  if (input.operatingHoursEnd !== undefined)
    fields.OperatingHoursEnd = input.operatingHoursEnd;
  if (input.greenThresholdMinutes !== undefined)
    fields.GreenThresholdMinutes = input.greenThresholdMinutes;
  if (input.yellowThresholdMinutes !== undefined)
    fields.YellowThresholdMinutes = input.yellowThresholdMinutes;
  if (input.miscAmount !== undefined) fields.MiscAmount = input.miscAmount;

  if (existing) {
    await graphPatch(
      `/sites/${siteId}/lists/${listId}/items/${existing.id}/fields`,
      fields,
    );
    return;
  }

  await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
    fields: {
      Title: input.outletName,
      OutletLookupId: Number(input.outletId),
      ...fields,
    },
  });
}
