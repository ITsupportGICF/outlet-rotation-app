/**
 * lib/graph/client.ts
 *
 * Server-side Microsoft Graph client for the Outlet Rotation App.
 *
 * Security model:
 *  - AUTHORIZATION happens HERE, on the data layer. Every Graph call first
 *    requires a valid app session AND that the session passes
 *    hasPortalAccess(). This is the single choke point: no route, page, or
 *    server action can touch SharePoint without an authorized signed-in
 *    user, even by mistake.
 *  - The Graph token itself is APP-ONLY (client credentials, Sites.Selected).
 *    The app reads/writes SharePoint as itself, scoped to one site. The
 *    signed-in user's identity gates WHETHER we make the call; it is not
 *    what Graph authenticates as.
 *  - Write operations (graphPost/graphPatch/graphDelete) are exposed here
 *    for the per-list helper modules. Callers that perform admin-only writes
 *    are expected to ALSO check requireAdminSession() (see the server
 *    actions in lib/actions). This file enforces "is this an authenticated,
 *    authorized app user" - it does not know which actions are admin-only.
 */
import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { acquireAppGraphToken } from "@/lib/auth/msal";
import { env } from "@/lib/env";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

type GraphErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class GraphApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "GraphApiError";
    this.status = status;
    this.code = code;
  }
}

/** A SharePoint list item as returned by Graph with `$expand=fields`. */
export type GraphListItem<TFields> = {
  id: string;
  fields: TFields;
};

/**
 * Guard for a SharePoint list-item id before it is interpolated into a Graph
 * URL path (e.g. `/items/${id}`). SharePoint item ids are always positive
 * integers; rejecting anything else stops a crafted id (e.g.
 * "1/../../<otherList>/items/9") from redirecting a write to a different
 * resource. Throws a clean, non-leaky error the callers already handle.
 */
export function requireNumericId(id: string): void {
  if (!/^\d+$/.test(id)) {
    throw new GraphApiError("Invalid list item id.", 400, "invalid_item_id");
  }
}

/**
 * Get the configured SharePoint site ID, or throw a clear, non-secret error
 * that the pages catch and turn into a "not connected yet" notice.
 */
export function getSharePointSiteId(): string {
  if (!env.SHAREPOINT_SITE_ID) {
    throw new GraphApiError(
      "SHAREPOINT_SITE_ID is not configured.",
      503,
      "sharepoint_not_configured",
    );
  }
  return env.SHAREPOINT_SITE_ID;
}

/**
 * Execute a request against Microsoft Graph.
 *
 * Authorization (session + portal access) is enforced before any token is
 * acquired or any network call is made.
 */
/**
 * Request-scoped carve-out for maintenance mode.
 *
 * Maintenance blocks every data call, but two reads MUST still work while it
 * is on, or IT could never switch it back off: the Admin Center password
 * check, and the AdminUsers lookup that proves someone is IT. Those callers
 * wrap themselves in this helper. It is deliberately narrow and request-
 * scoped (AsyncLocalStorage), so it can never leak into another request.
 */
const maintenanceBypass = new AsyncLocalStorage<true>();

export function allowDuringMaintenance<T>(fn: () => Promise<T>): Promise<T> {
  return maintenanceBypass.run(true, fn);
}

export async function graphRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // 0. Kill switch: if the app has been disabled, no data call proceeds.
  // Lazy import avoids a static import cycle (app-control imports this file);
  // isAppKilled is cached, so this stays cheap.
  const { isAppKilled } = await import("@/lib/graph/app-control");
  if (await isAppKilled()) {
    throw new GraphApiError("Application is disabled.", 503, "app_disabled");
  }

  // 0b. Maintenance mode: everyone except IT is blocked, here at the single
  // point every page, server action and API route reaches data through — so a
  // typed URL, a client-side navigation and a hand-crafted request are all
  // refused identically. Skipped for the carve-out above (and cheap: the
  // state is cached for 15s and fails open).
  if (!maintenanceBypass.getStore()) {
    const { isMaintenanceBlocked } = await import("@/lib/auth/maintenance");
    if (await isMaintenanceBlocked()) {
      throw new GraphApiError(
        "The app is currently in maintenance mode.",
        503,
        "maintenance",
      );
    }
  }

  // 1. Must be signed in.
  const session = await getSession();
  if (!session) {
    throw new GraphApiError("Authentication required.", 401);
  }

  // 2. Must be authorized for the app (tenant + group rules).
  if (!hasPortalAccess(session)) {
    throw new GraphApiError("Not authorized to access this resource.", 403);
  }

  // 3. Act as the application (Sites.Selected, one site only).
  const accessToken = await acquireAppGraphToken();

  const url = graphUrl(path);
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetchWithRetry(url, {
    ...options,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let errorBody: GraphErrorResponse | null = null;
    try {
      errorBody = (await response.json()) as GraphErrorResponse;
    } catch {
      // Ignore malformed / non-JSON error responses.
    }

    const message =
      errorBody?.error?.message ??
      `Microsoft Graph request failed with status ${response.status}.`;
    const code = errorBody?.error?.code;

    throw new GraphApiError(message, response.status, code);
  }

  // 204 No Content (e.g. PATCH/DELETE) and 202 Accepted (e.g. sendMail) carry
  // no JSON body.
  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function graphGet<T>(
  path: string,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  return graphRequest<T>(path, { method: "GET", headers: extraHeaders });
}

export async function graphPost<T>(path: string, body: unknown): Promise<T> {
  return graphRequest<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export async function graphPatch<T>(path: string, body: unknown): Promise<T> {
  return graphRequest<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export async function graphDelete(path: string): Promise<void> {
  await graphRequest<void>(path, { method: "DELETE" });
}

type GraphCollection<T> = {
  value: T[];
  "@odata.nextLink"?: string;
};

/**
 * GET a Graph collection, following @odata.nextLink until every page is
 * fetched. Used for lists that can grow unbounded (e.g. RotationHistory);
 * callers should always narrow with a $filter so this stays cheap.
 *
 * A hard page cap guards against a runaway loop if a filter is ever dropped.
 */
export async function graphGetAll<T>(
  path: string,
  extraHeaders?: Record<string, string>,
  maxPages = 50,
): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = path;
  let pages = 0;

  while (next && pages < maxPages) {
    const page: GraphCollection<T> = await graphGet<GraphCollection<T>>(
      next,
      extraHeaders,
    );
    items.push(...page.value);
    next = page["@odata.nextLink"] ?? null;
    pages += 1;
  }

  return items;
}

/**
 * Header that lets Graph run $filter/$orderby against columns that aren't
 * indexed in SharePoint. Without it, filtering a large list on a non-indexed
 * column returns an error. With it, the query still works (just less
 * efficiently) - so the app keeps working even before an admin indexes the
 * lookup columns. Indexing OperatingDay/Outlet later is a pure speed-up.
 */
export const NON_INDEXED_QUERY_HEADER = {
  Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly",
} as const;

/**
 * Build a Graph URL relative to v1.0.
 */
export function graphUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    // Only Graph's own @odata.nextLink URLs arrive here. Never send the app
    // token anywhere else.
    if (!path.startsWith(`${GRAPH_BASE_URL}/`)) {
      throw new GraphApiError("Refused a non-Graph URL.", 400, "invalid_path");
    }
    assertSafeGraphPath(path.slice(GRAPH_BASE_URL.length));
    return path;
  }
  const rel = path.startsWith("/") ? path : `/${path}`;
  assertSafeGraphPath(rel);
  return `${GRAPH_BASE_URL}${rel}`;
}

/**
 * Defence in depth for every Graph call, whatever built the path.
 *
 * Item ids are interpolated into URL paths in many places. A crafted id such
 * as "1/../../AdminUsers/items/7" would otherwise be normalised by fetch into
 * a request against a DIFFERENT list. So, in the path part only (never the
 * query string):
 *  - no "." / ".." segments, backslashes, control characters, or
 *    percent-encoded dots/slashes/backslashes;
 *  - the segment after "items" must be a plain numeric SharePoint item id.
 * Every legitimate path the app builds already satisfies this.
 */
function assertSafeGraphPath(pathAndQuery: string): void {
  const path = pathAndQuery.split("?")[0];
  const bad = () => {
    throw new GraphApiError("Invalid request path.", 400, "invalid_path");
  };
  if (/[\x00-\x1f\x7f\\]/.test(path)) bad();
  if (/%(2e|2f|5c|00)/i.test(path)) bad();
  const segments = path.split("/");
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === "." || seg === "..") bad();
    if (seg === "items" && i + 1 < segments.length && !/^\d+$/.test(segments[i + 1])) {
      bad();
    }
  }
}

/** Per-attempt time limit, so a stalled Graph call can't hang a request. */
const GRAPH_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelayMs(response: Response | null, attempt: number): number {
  const header = response?.headers.get("Retry-After");
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5_000);
  return 1_000 * 2 ** attempt; // 1s, 2s
}

/**
 * fetch with a timeout and a small, safe retry policy for Graph throttling:
 *  - 429 (throttled): retried for ANY method. Graph did not run the request,
 *    so a retried write can't be applied twice.
 *  - 503 / 504, timeouts and network errors: retried for GET only. A write
 *    might have been applied, so it is never repeated.
 * At most 2 retries, waiting Retry-After (capped at 5s) or 1s/2s.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const isRead = method === "GET";

  for (let attempt = 0; ; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
    } catch (err) {
      if (isRead && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(null, attempt));
        continue;
      }
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new GraphApiError(
        timedOut
          ? "Microsoft Graph did not respond in time."
          : "Could not reach Microsoft Graph.",
        504,
        timedOut ? "timeout" : "network_error",
      );
    }

    const retryable =
      response.status === 429 ||
      (isRead && (response.status === 503 || response.status === 504));
    if (!retryable || attempt >= MAX_RETRIES) return response;

    await sleep(retryDelayMs(response, attempt));
  }
}
