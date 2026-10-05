/**
 * lib/graph/app-control.ts
 *
 * The kill switch's server-side state, stored in a single-row SharePoint list
 * "AppControl". When Killed is true the whole app is disabled (see the root
 * layout and the graphRequest guard).
 *
 * IMPORTANT: this module deliberately does NOT use lib/graph/client's
 * graphRequest. graphRequest requires a signed-in portal session and is
 * itself blocked while the app is killed — but the kill switch must work
 * WITHOUT a Microsoft sign-in and precisely WHEN the app is killed (to revive
 * it). So this talks to Microsoft Graph with the app-only token directly.
 * Its only capability is reading/flipping one boolean; it can touch no other
 * data.
 */
import "server-only";

import { acquireAppGraphToken } from "@/lib/auth/msal";
import { maintenanceForcedOff } from "@/lib/env";
import { getSharePointSiteId, type GraphListItem } from "@/lib/graph/client";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const APP_CONTROL_LIST = "AppControl";
const STATE_CACHE_MS = 15_000;

type AppControlFields = {
  Title?: string;
  Killed?: boolean;
  Note?: string;
  UpdatedAt?: string;
  /** Maintenance mode (separate from the kill switch). */
  MaintenanceOn?: boolean;
  /** Expected return, stored EXACTLY as typed: "YYYY-MM-DDTHH:MM" in ET. */
  MaintenanceReturnAt?: string;
  MaintenanceBy?: string;
  MaintenanceByName?: string;
  MaintenanceAt?: string;
};

export type MaintenanceState = {
  on: boolean;
  /** "YYYY-MM-DDTHH:MM" local wall-clock in the outlet time zone, or null. */
  returnAt: string | null;
  by: string | null;
  byName: string | null;
  at: string | null;
};

const MAINTENANCE_OFF: MaintenanceState = {
  on: false,
  returnAt: null,
  by: null,
  byName: null,
  at: null,
};

export type KillState = {
  killed: boolean;
  note: string | null;
  updatedAt: string | null;
  /** Maintenance mode travels on the same row and the same cache. */
  maintenance: MaintenanceState;
};

/** Low-level app-only Graph call — no portal session, no kill-state guard. */
async function appGraph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await acquireAppGraphToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${GRAPH_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`AppControl Graph call failed with status ${res.status}`);
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  return (await res.json()) as T;
}

let listIdCache: string | null = null;

async function appControlListId(): Promise<string> {
  if (listIdCache) return listIdCache;
  const siteId = getSharePointSiteId();
  const data = await appGraph<{ value: { id: string; displayName?: string; name?: string }[] }>(
    `/sites/${siteId}/lists?$select=id,displayName,name&$top=200`,
  );
  const match = data.value.find(
    (l) =>
      l.displayName?.toLowerCase() === APP_CONTROL_LIST.toLowerCase() ||
      l.name?.toLowerCase() === APP_CONTROL_LIST.toLowerCase(),
  );
  if (!match) {
    throw new Error(`SharePoint list "${APP_CONTROL_LIST}" not found`);
  }
  listIdCache = match.id;
  return listIdCache;
}

/** The single AppControl row (creating logic lives in setKillState). */
async function readRow(): Promise<{ id: string; fields: AppControlFields } | null> {
  const siteId = getSharePointSiteId();
  const listId = await appControlListId();
  const data = await appGraph<{ value: GraphListItem<AppControlFields>[] }>(
    `/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=1`,
  );
  return data.value[0] ?? null;
}

let stateCache: { at: number; state: KillState } | null = null;

/**
 * Current kill state, cached briefly so the per-request check in the layout
 * and graphRequest is cheap. Fails OPEN (returns live) on any error or during
 * the build phase, so a transient Graph blip or a build can never take the
 * app down on its own — only a real, readable Killed=true does.
 */
export async function readKillState(): Promise<KillState> {
  const now = Date.now();
  if (stateCache && now - stateCache.at < STATE_CACHE_MS) {
    return stateCache.state;
  }

  const live: KillState = {
    killed: false,
    note: null,
    updatedAt: null,
    maintenance: MAINTENANCE_OFF,
  };

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return live;
  }

  try {
    const row = await readRow();
    const state: KillState = row
      ? {
          killed: row.fields.Killed === true,
          note: row.fields.Note ?? null,
          updatedAt: row.fields.UpdatedAt ?? null,
          maintenance: {
            on: row.fields.MaintenanceOn === true,
            returnAt: row.fields.MaintenanceReturnAt ?? null,
            by: row.fields.MaintenanceBy ?? null,
            byName: row.fields.MaintenanceByName ?? null,
            at: row.fields.MaintenanceAt ?? null,
          },
        }
      : live;
    stateCache = { at: now, state };
    return state;
  } catch {
    // Fail open: never disable the app because of a read error.
    stateCache = { at: now, state: live };
    return live;
  }
}

/** Convenience boolean used by the layout / graphRequest guard. */
export async function isAppKilled(): Promise<boolean> {
  return (await readKillState()).killed;
}

/**
 * Flip the kill state. Creates the single row if it doesn't exist yet.
 * Called only by the kill-switch API route after a valid code.
 */
export async function setKillState(killed: boolean, note: string): Promise<void> {
  const siteId = getSharePointSiteId();
  const listId = await appControlListId();
  const row = await readRow();

  const fields: AppControlFields = {
    Killed: killed,
    Note: note.slice(0, 255),
    UpdatedAt: new Date().toISOString(),
  };

  if (row) {
    await appGraph(`/sites/${siteId}/lists/${listId}/items/${row.id}/fields`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
  } else {
    await appGraph(`/sites/${siteId}/lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify({ fields: { Title: "app-control", ...fields } }),
    });
  }

  // Reflect the change immediately instead of waiting for the cache to expire.
  stateCache = {
    at: Date.now(),
    state: {
      killed,
      note: fields.Note ?? null,
      updatedAt: fields.UpdatedAt ?? null,
      maintenance: row
        ? {
            on: row.fields.MaintenanceOn === true,
            returnAt: row.fields.MaintenanceReturnAt ?? null,
            by: row.fields.MaintenanceBy ?? null,
            byName: row.fields.MaintenanceByName ?? null,
            at: row.fields.MaintenanceAt ?? null,
          }
        : MAINTENANCE_OFF,
    },
  };
}

/**
 * Current maintenance state.
 *
 * Reads through the same briefly-cached, FAIL-OPEN path as the kill switch:
 * if the row can't be read for any reason the answer is "maintenance is off",
 * so a SharePoint hiccup can never lock everyone out. The emergency
 * MAINTENANCE_FORCE_OFF override short-circuits before any read happens.
 */
export async function readMaintenanceState(): Promise<MaintenanceState> {
  if (maintenanceForcedOff) return MAINTENANCE_OFF;
  try {
    return (await readKillState()).maintenance;
  } catch {
    return MAINTENANCE_OFF;
  }
}

/**
 * Turn maintenance on/off, or update the expected return time. Creates the
 * single AppControl row if it doesn't exist yet, and never touches the kill
 * switch's own fields.
 */
export async function setMaintenanceState(input: {
  on: boolean;
  returnAt: string | null;
  by: string;
  byName: string;
}): Promise<void> {
  const siteId = getSharePointSiteId();
  const listId = await appControlListId();
  const row = await readRow();

  const maintenance: MaintenanceState = {
    on: input.on,
    returnAt: input.returnAt,
    by: input.by.slice(0, 255),
    byName: input.byName.slice(0, 255),
    at: new Date().toISOString(),
  };

  const fields: AppControlFields = {
    MaintenanceOn: maintenance.on,
    MaintenanceReturnAt: maintenance.returnAt ?? "",
    MaintenanceBy: maintenance.by ?? "",
    MaintenanceByName: maintenance.byName ?? "",
    MaintenanceAt: maintenance.at ?? "",
  };

  if (row) {
    await appGraph(`/sites/${siteId}/lists/${listId}/items/${row.id}/fields`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
  } else {
    await appGraph(`/sites/${siteId}/lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify({ fields: { Title: "app-control", Killed: false, ...fields } }),
    });
  }

  // Bust the cache so the new state is visible on the very next request.
  stateCache = {
    at: Date.now(),
    state: {
      killed: row?.fields.Killed === true,
      note: row?.fields.Note ?? null,
      updatedAt: row?.fields.UpdatedAt ?? null,
      maintenance,
    },
  };
}
