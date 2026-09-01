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
export async function graphRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
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

  const response = await fetch(url, {
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
    return path;
  }
  return `${GRAPH_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
