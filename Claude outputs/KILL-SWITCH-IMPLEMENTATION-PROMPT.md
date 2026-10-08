# Implement an Emergency Kill Switch in This Project

> **To Claude:** You are being asked to add an emergency kill switch to the project you are currently working in. This document describes a kill switch that already runs in production in another app (a Next.js 16 / React 19 / TypeScript app on Azure, using SharePoint as its data store). Your job is to **reproduce the same behaviour and the same security properties in this project, adapted to this project's stack and conventions.** The code at the bottom is a **reference implementation**, not a drop-in: read it to understand the mechanism, then build the equivalent here.
>
> Follow the process in "How to implement it" exactly. In particular: **inspect this project before writing any code**, and **do not change or replace this project's existing authentication, authorization, data flow, or UI** beyond what the kill switch strictly needs.

---

## 1. What the kill switch is

A hidden, emergency lever that takes the **entire application offline for everyone** — or brings it back — **without signing in.**

It exists for one scenario: when the app's normal sign-in or data access may be compromised or misbehaving, and the owner needs to shut it down immediately from any browser, even without a working login.

### How the owner uses it

1. On the public sign-in page, **click the empty page background 8 times within 4 seconds.** (Clicks on buttons, links and inputs don't count, so normal use never triggers it.)
2. A small "Application control" box appears asking for a **6-digit code**.
3. The owner types the current code from an authenticator app (Microsoft/Google Authenticator). The code changes every 30 seconds.
4. The server verifies the code. If correct, the app goes offline and **every route** shows a "Temporarily unavailable" screen.
5. To bring it back: on that unavailable screen, the same 8-click gesture opens the same box, now offering **Re-enable app**. Same code. The app returns.

### What it is NOT

- It is **not** role-based and has **no in-app settings page.** It does not use the app's users, roles, or permissions at all — that independence is the point.
- It is **not** maintenance mode. It blocks *everyone*, including admins. Nobody is exempt.
- It does **not** touch, delete or modify any of the app's data. It flips one boolean. Turning it off restores the app exactly as it was.

---

## 2. Required behaviour and security properties

These are non-negotiable. Each one exists for a reason; the reason is given so you can preserve it when adapting.

**Behaviour**

1. When ON, **every page and every route** shows the disabled screen — including direct URLs, refreshes and deep links. No app content or data is rendered.
2. When ON, **every data operation is refused on the server**, not just hidden in the UI. A hand-crafted request to any API, server action or endpoint must fail. *Reason: frontend-only blocking is bypassable.*
3. The state **persists** across refreshes, new sessions, browser restarts and server restarts until it is turned off. *Reason: it must stay off until deliberately revived.*
4. The state is **shared**: every server instance and every user sees the same value. *Reason: an in-memory or per-user flag would leave some users or instances live.*
5. Turning it OFF restores normal operation with **no data loss and no other side effects.**

**Security**

6. **The code is verified only on the server.** The browser only collects digits and displays the result. Never check the code client-side, and never send the secret to the browser.
7. **TOTP, RFC 6238:** HMAC-SHA1, 30-second step, 6 digits, base32 secret — the standard every authenticator app speaks. Accept the current step **±1** (90 seconds total) for clock skew, and nothing wider.
8. **Constant-time comparison**, and evaluate *every* candidate step without returning early, so response timing reveals nothing.
9. **Rate limiting:** at most **5 failed attempts per client IP** and **20 failed attempts total** per **15-minute** window. Return HTTP 429 when exceeded. *Reason: a 6-digit code is brute-forceable without it.*
10. **Never log the code or the secret.** Log only that an attempt failed, with a count.
11. **Require a JSON content type** on the endpoint that flips the switch. *Reason: a cross-site HTML form can't set it, which blunts CSRF; the rotating code remains the real gate.*
12. **The secret lives in a server-side environment variable** (`KILL_SWITCH_SECRET`). It is **optional**: when unset, the switch is inert (no code ever verifies) and the app boots normally.

**Resilience**

13. **Fail OPEN.** If the stored state cannot be read (storage down, not configured, permissions error, network blip), treat the app as **LIVE**. *Reason: a storage hiccup must never take the whole app offline on its own. Only a real, successfully-read "killed = true" disables it.*
14. During the **build** phase, always treat the app as live. *Reason: builds must never read live state or fail because storage is unreachable.*
15. **Cache the state per server instance for ~15 seconds** so every request doesn't hit storage. When the switch is flipped, **update the cache immediately** so the instance that flipped it reflects the change at once.

**Critical design rule — read this carefully**

16. **The code that reads and writes the kill state must NOT go through the app's normal authenticated data path.** The normal path requires a signed-in user *and* is itself blocked when the app is killed. The kill switch must work **without sign-in** and **precisely while the app is killed** (to revive it). So the state store is accessed through its own small, separate, privileged path whose *only* capability is reading and writing that one flag. In the reference app this means talking to SharePoint with the app-only token directly, rather than through `graphRequest()`.

---

## 3. Architecture — the six pieces

| # | Piece | Responsibility | Reference file |
|---|---|---|---|
| 1 | **Code verifier** | TOTP generation + constant-time verification against `KILL_SWITCH_SECRET`. Pure, server-only. | `lib/security/kill-code.ts` |
| 2 | **State store** | Read/write one shared `killed` flag (+ note, timestamp). Separate privileged path, 15s cache, fail-open, creates its single record on first write. | `lib/graph/app-control.ts` |
| 3 | **Kill-switch endpoint** | `POST {action: "kill" \| "revive", code}` → verify, rate-limit, flip. `GET` → report current state. No sign-in required. | `app/api/kill-switch/route.ts` |
| 4 | **Page-level enforcement** | The root layout (or equivalent global wrapper) renders the disabled screen *instead of* the app on every route when killed. | `app/layout.tsx` |
| 5 | **Data-level enforcement** | The single function every data read/write passes through refuses all calls when killed. | `graphRequest()` in `lib/graph/client.ts` |
| 6 | **UI** | Hidden 8-click trigger + code prompt (mounted on the sign-in page *and* the disabled screen), and the disabled screen itself. | `KillSwitchPanel.tsx`, `AppDisabledScreen.tsx` |

**Why both 4 and 5?** Piece 4 stops anyone *seeing* the app. Piece 5 stops anyone *using* it — API routes, server actions and hand-crafted requests never touch the layout, so without piece 5 they would still work.

### Data flow

```
Owner clicks background 8x ─▶ KillSwitchPanel opens
       │
       ├─ GET  /api/kill-switch ─────────▶ readKillState()  ─▶ shows "Disable" or "Re-enable"
       │
       └─ POST /api/kill-switch {action, code}
                 │
                 ├─ content-type must be JSON          (else 400)
                 ├─ rate limit per-IP + global          (else 429)
                 ├─ verifyKillCode(code)                (else 401, count the failure)
                 └─ setKillState(killed)  ─▶ shared store  ─▶ cache updated instantly
                                                   │
Every request ─▶ root layout ─▶ isAppKilled() ◀────┤ (15s cache, fail-open)
                     └─ killed? render AppDisabledScreen instead of the app
Every data call ─▶ choke point ─▶ isAppKilled() ◀──┘
                     └─ killed? throw 503 "app_disabled" before any work
```

---

## 4. How to implement it

Work through these steps in order. **Do not skip step 1.**

### Step 1 — Inspect this project first

Before writing anything, find and report:

- **Stack:** framework, language, runtime, how it's deployed.
- **The global wrapper:** the one place that renders around every page (root layout, app shell, `_app`, master page, base template).
- **The data choke point:** the single function/module that every data read and write goes through. If there isn't one, identify every data-access entry point — you will need to guard each of them, and you should say so.
- **Server-only boundary:** how this project keeps code off the client (e.g. `import "server-only"`, a server directory, API-only modules).
- **Environment variables:** where they are declared and validated.
- **Where persistent shared state can live:** what storage the app already uses (SQL, SharePoint list, Dataverse, Cosmos, Redis, a KV store, a settings table), and whether the app has **write** access to it.
- **A privileged path to that storage that does NOT require a signed-in user** (see requirement 16). If none exists, say how you'll create one.
- **The public sign-in / landing page**, where the trigger will be mounted.

### Step 2 — Map each of the six pieces onto this project

Write a short plan: for each piece in section 3, which file you'll create or change, and how it fits this project's conventions. Prefer **extending this project's existing patterns** over introducing new ones. Keep the new files as close to the reference as the stack allows.

### Step 3 — Ask before you build, if anything is unclear

Ask the owner **only** about things you genuinely can't determine from the code. Typically:

- **Where to store the state**, if more than one reasonable option exists. Recommend one.
- **Whether the app has write access** to that storage, if you can't tell from the code.
- **Whether another app shares the same storage** — if two apps read the same record, killing one kills both. Give them a uniquely named store.

### Step 4 — Implement

Build the six pieces. Rules:

- Keep everything that verifies codes or touches the state **server-only**.
- The state store must **fail open**, **cache ~15s**, **update its cache on write**, **skip reads during the build**, and **create its single record on first write** if it doesn't exist.
- Guard the data choke point **as its very first step**, before session or permission checks, and avoid circular imports (the reference uses a lazy dynamic import).
- The disabled screen must reveal **no app data** — a notice only, plus the hidden trigger.
- Mount the trigger on **both** the public sign-in page and the disabled screen.
- Use the **reference values** unless there's a stated reason to change them: 8 clicks / 4 seconds; 5 per IP and 20 global per 15 minutes; ±1 step; 15-second cache.
- **Do not modify** unrelated authentication, authorization, routing, data flow or styling.

### Step 5 — Test, and prove it

Verify each of these, and report how you verified it:

1. App builds and runs with `KILL_SWITCH_SECRET` **unset** — switch is inert, app works normally.
2. Gesture: 7 background clicks do nothing; 8 within 4 seconds open the prompt; clicks on buttons/links/inputs never count.
3. A wrong code is rejected; nothing changes.
4. The current code is accepted and the app goes offline.
5. While offline, **every** page shows the disabled screen — try direct URLs and refresh.
6. While offline, **data calls are refused on the server** — call an API/endpoint directly, not through the UI.
7. The state survives a page refresh, a new browser session, and a server restart.
8. The code from **the previous and next** 30-second steps is accepted; codes **two or more** steps away are rejected.
9. A code generated from a **different secret** is rejected.
10. After 5 wrong codes from one IP, further attempts return 429 for 15 minutes.
11. With the storage made unreachable, the app stays **live** (fail-open).
12. Re-enabling restores the app fully, with all data intact.
13. The code and the secret never appear in logs, responses, or client bundles.

Where you can, unit-test the verifier against an **independent** TOTP implementation rather than against itself, so you're proving it agrees with a real authenticator app.

### Step 6 — Report back

Give the owner:

- The list of files you **created** and **changed**.
- **Exact setup steps** for this project: the storage to create (with exact names and column/field types), any permission that must be granted, and the environment variable.
- A short **manual test plan** they can follow.

---

## 5. Adapting to a different stack

The reference is Next.js + SharePoint, but the mechanism is stack-independent. Keep the *properties* in section 2; change only the *mechanics*.

| Concern | Reference app | Equivalents elsewhere |
|---|---|---|
| Shared state | Single-row SharePoint list `AppControl` (`Killed` yes/no, `Note` text, `UpdatedAt` text) | One row in a SQL `app_settings` table; a Dataverse row; a Redis/KV key; a Cosmos document. Never memory, never a cookie, never local files on a multi-instance host. |
| Privileged state access | App-only Graph token, bypassing `graphRequest()` | A separate DB connection or service credential used only by the state module. |
| Page enforcement | Root `layout.tsx` | `_app.tsx` (Next pages router), app shell component, Express/ASP.NET middleware, base template, router guard on the server. |
| Data enforcement | Step 0 of `graphRequest()` | Repository/base data class, ORM middleware, API middleware applied to every route, request pipeline filter. |
| Endpoint | Next.js route handler | Any HTTP endpoint that does **not** require auth. |
| Rate limiting | In-memory per-process buckets | Fine for one instance. **If the app runs multiple instances, move the counters into the shared store** (or Redis) so the limit is enforced globally. |
| TOTP | Node `crypto` (HMAC-SHA1) | Any HMAC-SHA1 implementation. Keep RFC 6238 exactly so authenticator apps agree. |

**Power Apps / low-code note:** there is no server-side code path to protect in the same way. The closest equivalent is a single settings record checked in the app's `OnStart` / `App.StartScreen` *and* enforced at the data source (e.g. a Dataverse/SharePoint permission change or a Power Automate check), because client-side formulas alone can be bypassed. Say so explicitly rather than pretending a client-side check is equivalent.

---

## 6. Owner setup — template

Adapt the names to this project, then give these to the owner.

### Generate the secret

PowerShell:

```powershell
$b = New-Object byte[] 20; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; $bits = ""; $b | ForEach-Object { $bits += [Convert]::ToString($_,2).PadLeft(8,"0") }
-join (0..([Math]::Floor($bits.Length/5)-1) | ForEach-Object { $a[[Convert]::ToInt32($bits.Substring($_*5,5),2)] })
```

Or Node:

```bash
node -e "const a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',b=require('crypto').randomBytes(20);let s='',v=0,n=0;for(const x of b){v=(v<<8)|x;n+=8;while(n>=5){s+=a[(v>>>(n-5))&31];n-=5}}console.log(s)"
```

Either prints a 32-character base32 secret.

### Register it

1. **Authenticator app:** Add account → *Enter a setup key* → paste the secret → **Time-based**.
2. **Server:** set `KILL_SWITCH_SECRET` to the same value in the host's configuration (e.g. Azure App Service → Configuration), and in the local env file for testing.
3. Store the secret in a password manager. Anyone holding it can take the app offline. **Never commit it.**

### Recovery if locked out

Document a manual fallback: set the stored `killed` flag back to false directly in the storage (e.g. untick `Killed` in the SharePoint list). Because of the 15-second cache, the app returns within about 15 seconds.

---

## 7. Reference implementation

This is the exact production code from the reference app. **Read it for the mechanism; do not copy blindly.** Import paths, the storage calls in `app-control.ts`, the app name in the disabled screen, and the enforcement hooks will all need adapting to this project.

### Reference: `lib/security/kill-code.ts`

Pure TOTP verifier. Portable to any Node/TypeScript server almost unchanged.

```ts
/**
 * lib/security/kill-code.ts
 *
 * Time-based one-time code (RFC 6238 TOTP) for the emergency kill switch.
 *
 * The kill switch lets the app OWNER disable or re-enable the whole app
 * WITHOUT a Microsoft 365 sign-in — a manual lever for when the normal auth
 * path itself might be compromised. The only thing a correct code can do is
 * flip the app between "live" and "disabled" (see lib/graph/app-control.ts);
 * it can never read or change any data, so it is fail-closed.
 *
 * Security properties:
 *  - The secret is a server-side environment variable (KILL_SWITCH_SECRET),
 *    base32-encoded, never sent to the browser.
 *  - The 6-digit code is derived fresh on every verification and never
 *    stored or logged.
 *  - Standard TOTP (HMAC-SHA1, 30s period, 6 digits) so the owner can hold
 *    the secret in any authenticator app (Google Authenticator / Authy).
 *  - Verification allows the current 30s step ±1 (90s total) for clock skew.
 *  - Comparison is constant-time.
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const SKEW_STEPS = 1; // accept current step and one on each side

/** Decode an RFC 4648 base32 string (no padding required) to bytes. */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/,"").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue; // skip anything not in the alphabet
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** One HOTP value for a given counter (RFC 4226). */
function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter. Bitwise ops are 32-bit, so split hi/lo.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/**
 * Verify a supplied code against the current time window. Returns true only
 * if it matches the current 30s step or an adjacent one. Constant-time.
 */
export function verifyKillCode(supplied: string): boolean {
  const secret = env.KILL_SWITCH_SECRET;
  if (!secret) return false;

  const normalized = String(supplied ?? "").replace(/\D/g, "");
  if (normalized.length !== DIGITS) return false;

  const key = base32Decode(secret);
  if (key.length === 0) return false;

  const step = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
  const suppliedBuf = Buffer.from(normalized);

  let matched = false;
  // Always evaluate every candidate (no early return) so timing does not
  // reveal which step matched.
  for (let i = -SKEW_STEPS; i <= SKEW_STEPS; i++) {
    const candidate = Buffer.from(hotp(key, step + i));
    if (
      candidate.length === suppliedBuf.length &&
      timingSafeEqual(candidate, suppliedBuf)
    ) {
      matched = true;
    }
  }
  return matched;
}
```

### Reference: `lib/graph/app-control.ts`

The shared state store. **This is the file you will adapt most** — the `appGraph`/`readRow`/`setKillState` internals are SharePoint-specific; keep the caching, fail-open, build-phase and create-on-first-write behaviour.

```ts
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
import { getSharePointSiteId, type GraphListItem } from "@/lib/graph/client";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const APP_CONTROL_LIST = "AppControl";
const STATE_CACHE_MS = 15_000;

type AppControlFields = {
  Title?: string;
  Killed?: boolean;
  Note?: string;
  UpdatedAt?: string;
};

export type KillState = {
  killed: boolean;
  note: string | null;
  updatedAt: string | null;
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

  const live: KillState = { killed: false, note: null, updatedAt: null };

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
    state: { killed, note: fields.Note ?? null, updatedAt: fields.UpdatedAt ?? null },
  };
}
```

### Reference: `app/api/kill-switch/route.ts`

The unauthenticated endpoint: JSON check, rate limiting, verification, flip.

```ts
import { NextRequest, NextResponse } from "next/server";

import { verifyKillCode } from "@/lib/security/kill-code";
import { setKillState, readKillState } from "@/lib/graph/app-control";

/**
 * Emergency kill-switch endpoint.
 *
 * Accepts a JSON body { action: "kill" | "revive", code: "<6 digits>" }.
 * A correct time-based code (see lib/security/kill-code.ts) flips the app
 * between live and disabled — nothing else. No Microsoft sign-in is required
 * (that is the whole point: it must work even if normal auth is compromised),
 * so the ONLY gate is the rotating code plus strict rate-limiting.
 *
 * The code is never logged; failed attempts are logged as counts only.
 */

// --- In-memory rate limiting -------------------------------------------------
// The app runs a single instance today, so per-process counters are effective.
// If it is ever scaled out, move these into the AppControl row so the limit is
// shared across instances.
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const PER_IP_MAX = 5; // failed attempts per IP per window
const GLOBAL_MAX = 20; // failed attempts across all IPs per window

type Bucket = { count: number; resetAt: number };
const perIp = new Map<string, Bucket>();
let global: Bucket = { count: 0, resetAt: Date.now() + WINDOW_MS };

function bucket(map: Map<string, Bucket>, key: string): Bucket {
  const now = Date.now();
  const existing = map.get(key);
  if (!existing || now > existing.resetAt) {
    const fresh = { count: 0, resetAt: now + WINDOW_MS };
    map.set(key, fresh);
    return fresh;
  }
  return existing;
}

function globalBucket(): Bucket {
  if (Date.now() > global.resetAt) {
    global = { count: 0, resetAt: Date.now() + WINDOW_MS };
  }
  return global;
}

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-client-ip") ?? "unknown";
}

function tooMany(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "too_many_attempts" },
    { status: 429, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  // Require a JSON content-type. A cross-site form POST can't set this, which
  // blunts trivial CSRF; the rotating code is the real gate regardless.
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json(
      { ok: false, error: "bad_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const ip = clientIp(request);
  const ipBucket = bucket(perIp, ip);
  const gBucket = globalBucket();

  if (ipBucket.count >= PER_IP_MAX || gBucket.count >= GLOBAL_MAX) {
    console.warn("[kill-switch] attempt rejected: rate limited", { ip });
    return tooMany();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const action = (body as { action?: unknown })?.action;
  const code = (body as { code?: unknown })?.code;

  if (
    (action !== "kill" && action !== "revive") ||
    typeof code !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "bad_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!verifyKillCode(code)) {
    ipBucket.count += 1;
    gBucket.count += 1;
    // Never log the code or the secret — only that an attempt failed.
    console.warn("[kill-switch] invalid code", {
      ip,
      action,
      ipFails: ipBucket.count,
    });
    return NextResponse.json(
      { ok: false, error: "invalid_code" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Success — reset this IP's failure counter and apply the state.
  perIp.delete(ip);
  const killed = action === "kill";
  await setKillState(killed, `${killed ? "Killed" : "Revived"} via kill switch`);
  console.warn("[kill-switch] state changed", { ip, killed });

  return NextResponse.json(
    { ok: true, killed },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

/** Report current state (used by the panel to show Kill vs Revive). */
export async function GET() {
  const state = await readKillState();
  return NextResponse.json(
    { killed: state.killed },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

### Reference: `app/_components/KillSwitchPanel.tsx`

Hidden trigger + code prompt. Inline styles only, so it has no CSS dependency.

```tsx
"use client";

/**
 * KillSwitchPanel
 *
 * A hidden trigger for the emergency kill switch. Clicking the page
 * background (not any button/link/field) 8 times within a few seconds opens a
 * prompt for the rotating 6-digit code. Submitting it calls /api/kill-switch,
 * which verifies the code server-side and flips the app between live and
 * disabled. The code is NEVER checked here in the browser — this component
 * only collects it and shows the result.
 *
 * The same component is used on the sign-in page (to disable) and on the
 * disabled screen (to re-enable); it asks the server which action applies.
 */
import { useEffect, useRef, useState } from "react";

const REQUIRED_CLICKS = 8;
const CLICK_WINDOW_MS = 4000;

export default function KillSwitchPanel() {
  const [open, setOpen] = useState(false);
  const clicks = useRef<number>(0);
  const lastClick = useRef<number>(0);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Ignore clicks on interactive elements — only bare background clicks
      // count, so normal use never triggers the prompt.
      const target = e.target as HTMLElement | null;
      if (target?.closest("a,button,input,select,textarea,[role='button']")) {
        return;
      }
      const now = Date.now();
      clicks.current = now - lastClick.current > CLICK_WINDOW_MS ? 1 : clicks.current + 1;
      lastClick.current = now;
      if (clicks.current >= REQUIRED_CLICKS) {
        clicks.current = 0;
        setOpen(true);
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!open) return null;
  return <KillSwitchModal onClose={() => setOpen(false)} />;
}

function KillSwitchModal({ onClose }: { onClose: () => void }) {
  const [killedNow, setKilledNow] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "error" | "locked">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/kill-switch", { method: "GET", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (active) setKilledNow(Boolean(d?.killed));
      })
      .catch(() => {
        if (active) setKilledNow(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const action = killedNow ? "revive" : "kill";
  const actionLabel = killedNow ? "Re-enable app" : "Disable app";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.replace(/\D/g, "").length !== 6) {
      setStatus("error");
      setMessage("Enter the 6-digit code.");
      return;
    }
    setStatus("working");
    setMessage("");
    try {
      const res = await fetch("/api/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, code: code.replace(/\D/g, "") }),
      });
      if (res.status === 429) {
        setStatus("locked");
        setMessage("Too many attempts. Wait 15 minutes and try again.");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        // Reload so the app reflects the new state everywhere.
        window.location.reload();
        return;
      }
      setStatus("error");
      setMessage("Incorrect or expired code.");
    } catch {
      setStatus("error");
      setMessage("Could not reach the server. Try again.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Application control"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(4,10,20,0.72)",
        backdropFilter: "blur(4px)",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: "100%",
          maxWidth: 360,
          borderRadius: 18,
          background: "#0d2138",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          padding: "1.75rem",
          color: "#e2ebf5",
        }}
      >
        <p style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "rgba(226,235,245,0.55)", margin: 0 }}>
          Application control
        </p>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "6px 0 4px", color: "#fff" }}>
          {killedNow === null ? "…" : actionLabel}
        </h2>
        <p style={{ fontSize: 13, color: "rgba(226,235,245,0.7)", marginTop: 0 }}>
          {killedNow
            ? "The app is currently disabled. Enter the current code to bring it back online."
            : "Enter the current code to take the app offline immediately."}
        </p>

        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          autoFocus
          style={{
            width: "100%",
            marginTop: 14,
            padding: "12px 14px",
            fontSize: 22,
            letterSpacing: 6,
            textAlign: "center",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
          }}
        />

        {message && (
          <p
            role="alert"
            style={{
              marginTop: 10,
              fontSize: 13,
              color: status === "locked" ? "#f5c451" : "#ff9b9b",
            }}
          >
            {message}
          </p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "transparent",
              color: "#e2ebf5",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={status === "working" || killedNow === null}
            style={{
              flex: 1.4,
              padding: "11px 0",
              borderRadius: 12,
              border: "none",
              background: killedNow ? "#2e7d5b" : "#a83232",
              color: "#fff",
              fontWeight: 600,
              cursor: status === "working" ? "default" : "pointer",
              opacity: status === "working" ? 0.7 : 1,
            }}
          >
            {status === "working" ? "Working…" : actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
```

### Reference: `app/_components/AppDisabledScreen.tsx`

The screen every route shows while killed. Change the app name.

```tsx
/**
 * AppDisabledScreen
 *
 * Shown for every route while the kill switch is engaged. It reveals nothing
 * and offers no data — just a notice. The hidden 8-click gesture
 * (KillSwitchPanel) is mounted here too, so the owner can re-enable the app
 * from this screen without a Microsoft sign-in.
 */
import KillSwitchPanel from "@/app/_components/KillSwitchPanel";

export default function AppDisabledScreen() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: "linear-gradient(160deg,#0d2138 0%,#081525 100%)",
        color: "#e2ebf5",
        textAlign: "center",
      }}
    >
      <KillSwitchPanel />
      <div style={{ maxWidth: 420 }}>
        <div
          aria-hidden="true"
          style={{
            width: 64,
            height: 64,
            margin: "0 auto 20px",
            borderRadius: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 30,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          ⏸
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "#fff", margin: "0 0 10px" }}>
          Temporarily unavailable
        </h1>
        <p style={{ fontSize: 15, color: "rgba(226,235,245,0.72)", margin: 0 }}>
          The Outlet Rotation App is offline for maintenance. Please check back
          shortly.
        </p>
      </div>
    </main>
  );
}
```

### Reference: `app/layout.tsx`

Page-level enforcement (piece 4).

```tsx
import type { Metadata } from "next";
import "./globals.css";

import { isAppKilled } from "@/lib/graph/app-control";
import AppDisabledScreen from "@/app/_components/AppDisabledScreen";

export const metadata: Metadata = {
  title: "Outlet Rotation App",
  description: "Goodwill Industries of Central Florida — Outlet Rotation App",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Emergency kill switch: when engaged, every route shows the disabled
  // screen (which itself hosts the hidden re-enable gesture). Fails open — a
  // read error never disables the app (see readKillState).
  const killed = await isAppKilled();

  return (
    <html lang="en">
      <body>{killed ? <AppDisabledScreen /> : children}</body>
    </html>
  );
}
```

### Reference: data-level enforcement (piece 5)

The first lines of the app's single data choke point.

```ts
// Inside the ONE function every data read/write goes through.
// In the reference app this is graphRequest() in lib/graph/client.ts.
export async function graphRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  // 0. Kill switch: if the app has been disabled, no data call proceeds.
  // Lazy import avoids an import cycle (app-control imports this file);
  // isAppKilled() is cached, so this stays cheap.
  const { isAppKilled } = await import("@/lib/graph/app-control");
  if (await isAppKilled()) {
    throw new GraphApiError("Application is disabled.", 503, "app_disabled");
  }

  // 1. Must be signed in.  2. Must be authorized.  3. ...then the real call.
  // (existing logic continues unchanged)
}
```

### Reference: environment variable

```ts
// In the app's environment-variable schema (zod in the reference app):
// Base32 secret for the time-based kill-switch code. OPTIONAL: when unset the
// kill switch is inert (no code ever verifies), so the app still boots.
KILL_SWITCH_SECRET: z.string().optional(),
```

### Reference: mounting the trigger on the sign-in page

```tsx
// On the public sign-in / landing page, render the hidden trigger once,
// anywhere inside the page. It renders nothing until the gesture fires.
import KillSwitchPanel from "@/app/_components/KillSwitchPanel";

export default async function SignInPage() {
  return (
    <main>
      <KillSwitchPanel />
      {/* ...existing sign-in UI unchanged... */}
    </main>
  );
}
```
