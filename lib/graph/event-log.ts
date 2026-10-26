/**
 * lib/graph/event-log.ts
 *
 * The Admin Event Log. Two sources, merged into one timeline:
 *
 *  1. REBUILT FROM EXISTING RECORDS (works immediately, includes history):
 *     - RotationHistory → every rotation, override (skip) and manual rotation,
 *       with who did it and when.
 *     - OperatingDays   → every Start Day / End Day, with who and when.
 *     - AdminUsers      → when each account was created, and its most recent
 *                         Admin Center sign-in (only the latest is stored).
 *     - AppControl      → the most recent maintenance-mode and kill-switch change.
 *     Nothing is written for these, and no existing list is changed.
 *
 *  2. RECORDED GOING FORWARD in a separate, new "EventLog" list (one row per
 *     event), for actions the existing data can't show: section/mix/goal/
 *     settings/user changes, admin sign-ins and failed attempts, undo, etc.
 *     The list is created automatically on first use if the app's SharePoint
 *     permission allows; otherwise an admin creates it once (see
 *     docs/event-log-setup.md). Until it exists, recording silently does
 *     nothing and the log shows source 1 only.
 *
 * Recording never slows down or breaks an action: logEvent() schedules the
 * write with Next's after() (it runs once the response has been sent) and
 * swallows every error.
 */
import "server-only";

import { after } from "next/server";

import {
  type GraphListItem,
  GraphApiError,
  allowDuringMaintenance,
  getSharePointSiteId,
  graphGetAll,
  graphPost,
  NON_INDEXED_QUERY_HEADER,
} from "@/lib/graph/client";
import { clearListCache, listContext } from "@/lib/graph/lists";
import { getSession } from "@/lib/auth/session";
import { getAdminSession } from "@/lib/auth/admin-session";
import { listOutlets } from "@/lib/graph/outlets";
import { listSectionsForOutlet } from "@/lib/graph/sections";
import { listCommodities } from "@/lib/graph/commodities";
import { listOperatingDaysForOutlet } from "@/lib/graph/operating-days";
import { getRotationsForOperatingDay } from "@/lib/graph/rotation-history";
import { listAdminUsers } from "@/lib/graph/admin-users";
import { readKillState } from "@/lib/graph/app-control";
import { formatReturnAt } from "@/lib/maintenance-message";
import { minutesBetween } from "@/lib/time";
import type { EventType, LogEvent } from "@/lib/event-types";

/* ------------------------------------------------------------------------- */
/* Recording                                                                 */
/* ------------------------------------------------------------------------- */

type EventData = {
  v: 1;
  type: string;
  outlet: string | null;
  actor: string | null;
  actorEmail: string | null;
  details: string;
  at: string;
  key?: string;
};

async function resolveActor(
  override?: string,
): Promise<{ name: string | null; email: string | null }> {
  try {
    const [session, admin] = await Promise.all([getSession(), getAdminSession()]);
    return {
      name: override ?? admin?.username ?? session?.name ?? null,
      email: session?.email ?? null,
    };
  } catch {
    return { name: override ?? null, email: null };
  }
}

/**
 * Record an event. Returns immediately; the write happens after the response
 * is sent and can never throw into the caller.
 *
 * @param e.actor  who did it, when it isn't the signed-in admin (e.g. the
 *                 username on a sign-in attempt)
 * @param e.key    lets a rebuilt copy of the same event be de-duplicated
 */
export function logEvent(e: {
  type: EventType;
  outlet?: string | null;
  details?: string;
  actor?: string;
  key?: string;
}): void {
  const at = new Date().toISOString();
  // Read who's acting NOW, while the request (and its cookies) is current.
  const actorPromise = resolveActor(e.actor);
  actorPromise.catch(() => undefined);

  try {
    after(async () => {
      try {
        const actor = await actorPromise;
        await allowDuringMaintenance(() =>
          writeEvent({
            v: 1,
            type: e.type,
            outlet: e.outlet ?? null,
            actor: actor.name,
            actorEmail: actor.email,
            details: (e.details ?? "").slice(0, 2000),
            at,
            ...(e.key ? { key: e.key } : {}),
          }),
        );
      } catch (err) {
        // Never log event contents (could include names); just that it failed.
        console.warn(
          "[event-log] event not recorded:",
          err instanceof GraphApiError ? `${err.status} ${err.code ?? ""}` : "error",
        );
      }
    });
  } catch {
    // Called outside a request — nothing to record against.
  }
}

/** Don't retry creating the list more than once every 10 minutes. */
let createBlockedUntil = 0;

async function eventLogListContext(): Promise<{ siteId: string; listId: string }> {
  try {
    return await listContext("eventLog");
  } catch (err) {
    if (!(err instanceof GraphApiError && err.code === "list_not_found")) throw err;
    if (Date.now() < createBlockedUntil) throw err;
    createBlockedUntil = Date.now() + 10 * 60_000;

    // A brand-new list: Title (built in) + one plain multi-line text column.
    // Nothing about any existing list changes.
    const siteId = getSharePointSiteId();
    await graphPost(`/sites/${siteId}/lists`, {
      displayName: "EventLog",
      description: "Outlet Rotation App — Admin Event Log (written by the app).",
      list: { template: "genericList" },
      columns: [
        {
          name: "EventData",
          text: { allowMultipleLines: true, textType: "plain", linesForEditing: 6 },
        },
      ],
    });
    clearListCache();
    return await listContext("eventLog");
  }
}

async function writeEvent(data: EventData): Promise<void> {
  const { siteId, listId } = await eventLogListContext();
  const title = `${data.type}${data.outlet ? ` — ${data.outlet}` : ""}`.slice(0, 255);
  await graphPost(`/sites/${siteId}/lists/${listId}/items`, {
    fields: { Title: title, EventData: JSON.stringify(data) },
  });
}

/* ------------------------------------------------------------------------- */
/* Reading                                                                   */
/* ------------------------------------------------------------------------- */

type EventLogFields = { Title?: string; EventData?: string; Created?: string };

/** Recorded events between two instants. `available` is false if the list doesn't exist yet. */
async function readRecordedEvents(
  from: Date,
  to: Date,
): Promise<{ events: LogEvent[]; available: boolean }> {
  let ctx: { siteId: string; listId: string };
  try {
    ctx = await listContext("eventLog");
  } catch (err) {
    if (err instanceof GraphApiError && err.code === "list_not_found") {
      return { events: [], available: false };
    }
    throw err;
  }

  const base = `/sites/${ctx.siteId}/lists/${ctx.listId}/items?$expand=fields&$top=500`;
  const lo = new Date(from.getTime() - 5 * 60_000).toISOString();
  const hi = new Date(to.getTime() + 5 * 60_000).toISOString();
  let items: (GraphListItem<EventLogFields> & { createdDateTime?: string })[];
  try {
    items = await graphGetAll(
      `${base}&$filter=fields/Created ge '${lo}' and fields/Created le '${hi}'`,
      NON_INDEXED_QUERY_HEADER,
    );
  } catch (err) {
    // If SharePoint won't filter on Created, read the list and filter here.
    if (!(err instanceof GraphApiError && err.status === 400)) throw err;
    items = await graphGetAll(base, NON_INDEXED_QUERY_HEADER);
  }

  const events: LogEvent[] = [];
  for (const item of items) {
    let data: Partial<EventData> = {};
    try {
      data = JSON.parse(item.fields.EventData ?? "{}") as Partial<EventData>;
    } catch {
      // Unreadable row — fall back to its title and creation time.
    }
    const at = data.at ?? item.fields.Created ?? item.createdDateTime;
    if (!at) continue;
    const t = new Date(at).getTime();
    if (!(t >= from.getTime() && t <= to.getTime())) continue;
    events.push({
      id: `r-${item.id}`,
      at,
      type: data.type ?? (item.fields.Title ?? "Event").split(" — ")[0],
      outlet: data.outlet ?? null,
      actor: data.actor ?? data.actorEmail ?? null,
      details: data.details ?? "",
      source: "recorded",
      key: data.key,
    });
  }
  return { events, available: true };
}

const inRange = (iso: string | null | undefined, from: Date, to: Date): iso is string => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime();
};

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/** Events rebuilt from the app's existing data. Each source fails on its own. */
async function readEventsFromRecords(
  from: Date,
  to: Date,
  now: Date,
): Promise<{ events: LogEvent[]; warnings: string[] }> {
  const events: LogEvent[] = [];
  const warnings: string[] = [];

  // --- Rotations + operating days, per store ---
  try {
    const [outlets, commodities] = await Promise.all([listOutlets(), listCommodities()]);
    const commodityName = new Map(commodities.map((c) => [c.id, c.name]));

    await Promise.all(
      outlets.map(async (outlet) => {
        const [days, sections] = await Promise.all([
          listOperatingDaysForOutlet(outlet.id),
          listSectionsForOutlet(outlet.id),
        ]);
        const sectionName = new Map(sections.map((s) => [s.id, s.name]));

        for (const d of days) {
          if (inRange(d.startedAt, from, to)) {
            events.push({
              id: `ds-${d.id}`,
              at: d.startedAt,
              type: "Day Started",
              outlet: outlet.name,
              actor: d.startedByEmail,
              details: "Operating day opened",
              source: "records",
            });
          }
          if (d.status === "Closed" && inRange(d.endedAt, from, to)) {
            const open =
              d.startedAt && d.endedAt
                ? ` — open ${durationLabel(minutesBetween(new Date(d.startedAt), new Date(d.endedAt)))}`
                : "";
            events.push({
              id: `de-${d.id}`,
              at: d.endedAt,
              type: "Day Ended",
              outlet: outlet.name,
              actor: d.endedByEmail,
              details: `Operating day closed${open}`,
              source: "records",
            });
          }
        }

        // Rotations: only days that overlap the requested range.
        const relevant = days.filter((d) => {
          const start = d.startedAt ? new Date(d.startedAt).getTime() : NaN;
          const end = d.endedAt ? new Date(d.endedAt).getTime() : now.getTime();
          return Number.isFinite(start) && start <= to.getTime() && end >= from.getTime();
        });
        const rowsByDay = await Promise.all(
          relevant.map((d) => getRotationsForOperatingDay(d.id)),
        );

        for (const rows of rowsByDay) {
          // One press = every row sharing section + timestamp + type.
          const presses = new Map<
            string,
            { sectionId: string; at: string; type: string; by: string | null; parts: Map<string, number>; firstId: string }
          >();
          for (const r of rows) {
            if (!r.rotatedAt || !inRange(r.rotatedAt, from, to)) continue;
            const k = `${r.sectionId}@${r.rotatedAt}@${r.rotationType}`;
            let p = presses.get(k);
            if (!p) {
              p = { sectionId: r.sectionId, at: r.rotatedAt, type: r.rotationType, by: r.performedByEmail, parts: new Map(), firstId: r.id };
              presses.set(k, p);
            }
            if (r.quantity > 0) {
              p.parts.set(r.commodityId, (p.parts.get(r.commodityId) ?? 0) + r.quantity);
            }
          }

          for (const p of presses.values()) {
            const section = sectionName.get(p.sectionId) ?? "Section";
            const total = [...p.parts.values()].reduce((a, b) => a + b, 0);
            const breakdown = [...p.parts.entries()]
              .map(([cid, q]) => `${commodityName.get(cid) ?? "Commodity"} ${q}`)
              .join(", ");
            const isSkip = p.type === "Override";
            events.push({
              id: `rot-${p.firstId}`,
              at: p.at,
              type: isSkip
                ? "Section Skipped (Override)"
                : p.type === "Manual"
                  ? "Manual Rotation"
                  : "Section Rotated",
              outlet: outlet.name,
              actor: p.by,
              details: isSkip
                ? `${section} — skipped`
                : `${section} — ${total} table${total === 1 ? "" : "s"}${breakdown ? ` (${breakdown})` : ""}`,
              source: "records",
            });
          }
        }
      }),
    );
  } catch {
    warnings.push("Rotations and operating days couldn't be loaded right now.");
  }

  // --- Admin accounts: created, and most recent sign-in ---
  try {
    const users = await allowDuringMaintenance(() => listAdminUsers());
    for (const u of users) {
      const who = u.displayName || u.username;
      if (inRange(u.createdAt, from, to)) {
        events.push({
          id: `uc-${u.itemId}`,
          at: u.createdAt,
          type: "Account Created",
          outlet: null,
          actor: null,
          details: `${who}${u.email ? ` (${u.email})` : ""} — ${u.permissionLevel}`,
          source: "records",
          key: `account:${(u.email || u.username).toLowerCase()}`,
        });
      }
      if (inRange(u.lastLoginAt, from, to)) {
        events.push({
          id: `ul-${u.itemId}`,
          at: u.lastLoginAt,
          type: "Admin Sign-in",
          outlet: null,
          actor: u.username,
          details: `${who} signed in to the Admin Center (most recent sign-in for this account)`,
          source: "records",
          key: `signin:${u.username.toLowerCase()}`,
        });
      }
    }
  } catch {
    warnings.push("Admin account activity couldn't be loaded right now.");
  }

  // --- Most recent maintenance-mode and kill-switch change ---
  try {
    const state = await readKillState();
    const m = state.maintenance;
    if (inRange(m.at, from, to)) {
      events.push({
        id: `mt-${m.at}`,
        at: m.at,
        type: m.on ? "Maintenance Mode On" : "Maintenance Mode Off",
        outlet: null,
        actor: m.byName ?? m.by,
        details: m.on
          ? `Expected back ${formatReturnAt(m.returnAt) ?? "—"}`
          : "Maintenance mode turned off",
        source: "records",
        key: "maintenance",
      });
    }
    if (inRange(state.updatedAt, from, to)) {
      events.push({
        id: `ks-${state.updatedAt}`,
        at: state.updatedAt,
        type: state.killed ? "Kill Switch Engaged" : "Kill Switch Released",
        outlet: null,
        actor: null,
        details: state.note ?? (state.killed ? "App disabled" : "App re-enabled"),
        source: "records",
      });
    }
  } catch {
    // Fails open elsewhere too; just leave these out.
  }

  return { events, warnings };
}

export type EventLogResult = {
  events: LogEvent[];
  /** False until the EventLog list exists (admin changes aren't being recorded). */
  recordingAvailable: boolean;
  warnings: string[];
};

/**
 * Every event between two instants, from both sources, oldest first.
 * A rebuilt event is dropped when the same event was also recorded.
 */
export async function getEventLog(from: Date, to: Date): Promise<EventLogResult> {
  const now = new Date();
  const [recorded, rebuilt] = await Promise.all([
    readRecordedEvents(from, to).catch(() => ({ events: [] as LogEvent[], available: true, failed: true })),
    readEventsFromRecords(from, to, now),
  ]);

  const warnings = [...rebuilt.warnings];
  if ("failed" in recorded) warnings.push("Recorded admin activity couldn't be loaded right now.");

  const DUP_WINDOW = 5 * 60_000;
  const isDuplicate = (e: LogEvent) =>
    Boolean(e.key) &&
    recorded.events.some(
      (r) =>
        // Keys are specific to one kind of event (signin:…, account:…,
        // maintenance), so the key alone identifies "the same event".
        r.key === e.key &&
        Math.abs(new Date(r.at).getTime() - new Date(e.at).getTime()) <= DUP_WINDOW,
    );

  const events = [...recorded.events, ...rebuilt.events.filter((e) => !isDuplicate(e))].sort(
    (a, b) =>
      new Date(a.at).getTime() - new Date(b.at).getTime() || a.id.localeCompare(b.id),
  );

  return { events, recordingAvailable: recorded.available, warnings };
}
