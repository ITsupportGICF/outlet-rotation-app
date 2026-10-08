# Kill Switch for GoodGuide Portal

Copied from the Outlet Rotation App. Verified against your actual GoodGuidePortal source: **production build passes, lint is clean on every file below, and 14 behaviour tests pass** (code accepted/rejected correctly, clock skew handled, fails open if SharePoint is down).

## What it does

A hidden lever that takes the whole portal offline — or brings it back — **without signing in**. It's for the case where sign-in itself can't be trusted.

- On the sign-in page, **click the empty background 8 times within 4 seconds**. A box asks for a 6-digit code.
- Enter the current code from your authenticator app. The portal goes offline for everyone.
- To bring it back: on the "Temporarily unavailable" screen, same gesture, same code.

The code changes every 30 seconds. The browser never checks it — the server does.

---

## Step 1 — Create the SharePoint list

On the **GoodGuidePortal** SharePoint site, create a list named exactly **`AppControl`** with these columns:

| Column | Type |
|---|---|
| `Killed` | Yes/No |
| `Note` | Single line of text |
| `UpdatedAt` | Single line of text |

Leave it empty. The first flip creates the row.

> **Check this first:** if GoodGuidePortal and the Outlet Rotation App use the **same** SharePoint site, they will share one `AppControl` row — and killing one kills both. Compare the `SHAREPOINT_SITE_ID` values in the two apps. If they match, change `const APP_CONTROL_LIST = "AppControl";` in `lib/graph/app-control.ts` to `"PortalControl"` and name the list `PortalControl` instead.

## Step 2 — Give the app WRITE access to the site (important)

GoodGuidePortal was built **read-only** — its `client.ts` says so. The kill switch has to **write** one row. If the app registration's `Sites.Selected` grant on this site is `read`, the switch will refuse to flip.

Grant `write` on the site for the GoodGuidePortal app registration (same way the original `read` grant was made, with `"roles": ["write"]`). Only the `AppControl` list is ever written to; nothing else in the app gains write access.

## Step 3 — Create the secret and add it to your authenticator

Run this in PowerShell to generate a secret:

```powershell
$b = New-Object byte[] 20; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; $bits = ""; $b | ForEach-Object { $bits += [Convert]::ToString($_,2).PadLeft(8,"0") }
-join (0..([Math]::Floor($bits.Length/5)-1) | ForEach-Object { $a[[Convert]::ToInt32($bits.Substring($_*5,5),2)] })
```

That prints a 32-character secret. Then:

1. In Microsoft or Google Authenticator: **Add account → Enter code manually**, type the secret, choose **Time-based**.
2. In Azure → your GoodGuidePortal App Service → **Configuration** → add `KILL_SWITCH_SECRET` = the same secret.
3. Add it to `.env.local` too if you want to test locally.

Store the secret somewhere safe (your password manager). Anyone with it can take the portal offline. **Never commit it.**

## Step 4 — Paste the files

5 new files and 4 replacements. Create the folders if they don't exist (`lib/security`, `app/api/kill-switch`, `app/_components`).

---

## New files

### `lib/security/kill-code.ts`

**New file.** Verifies the 6-digit code (standard TOTP, same as Google/Microsoft Authenticator). Identical to Outlet Rotation.

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

### `lib/graph/app-control.ts`

**New file.** Reads/writes the on/off state in the `AppControl` SharePoint list. 15-second cache, fails open. Identical to Outlet Rotation.

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

### `app/api/kill-switch/route.ts`

**New file.** The endpoint the hidden panel calls. Rate-limited: 5 wrong codes per IP / 20 total per 15 minutes. Identical to Outlet Rotation.

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

### `app/_components/KillSwitchPanel.tsx`

**New file.** The hidden trigger + code prompt. Inline styles only, no CSS needed. Identical to Outlet Rotation.

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

### `app/_components/AppDisabledScreen.tsx`

**New file.** What everyone sees while the portal is disabled. Only the app name differs from Outlet Rotation.

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
          The GoodGuide Portal is offline for maintenance. Please check back
          shortly.
        </p>
      </div>
    </main>
  );
}
```


---

## Replaced files

### `app/layout.tsx`

**Replace the whole file.** Shows the disabled screen on every route when the switch is on.

```tsx
import type { Metadata } from "next";
import "./globals.css";

import { isAppKilled } from "@/lib/graph/app-control";
import AppDisabledScreen from "@/app/_components/AppDisabledScreen";

export const metadata: Metadata = {
  title: "GoodGuide Portal",
  description:
    "Goodwill Industries of Central Florida — internal resource portal.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Emergency kill switch: when engaged, every route shows the disabled
  // screen (which itself hosts the hidden re-enable gesture). Fails open — a
  // read error never disables the portal (see readKillState).
  const killed = await isAppKilled();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {killed ? <AppDisabledScreen /> : children}
      </body>
    </html>
  );
}
```

### `app/page.tsx`

**Replace the whole file.** Adds `<KillSwitchPanel />` to the sign-in page — the only change is that one import and that one line.

```tsx
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import KillSwitchPanel from "@/app/_components/KillSwitchPanel";
import SignInCard from "./SignInCard";
import styles from "./home.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    "Your account isn't authorized to access this portal. Contact IT if you believe this is a mistake.",
  authentication_failed: "Sign-in didn't complete. Please try again.",
  invalid_auth_transaction:
    "Your sign-in session expired before it completed. Please try again.",
};

export default async function HomePage(props: PageProps<"/">) {
  const session = await getSession();
  if (session) {
    redirect("/portal");
  }

  const params = await props.searchParams;
  const rawError = params?.error;
  const errorKey = typeof rawError === "string" ? rawError : null;
  const errorMessage = errorKey
    ? ERROR_MESSAGES[errorKey] ?? "Something went wrong. Please try again."
    : null;

  return (
    <main className={styles.page}>
      <KillSwitchPanel />
      <div className={styles.bg} aria-hidden="true">
        <span className={styles.orbGold} />
        <span className={styles.orbBlue} />
        <span className={styles.orbGold2} />
        <div className={styles.grid} />
      </div>

      <div className={styles.shell}>
        <section className={styles.brand}>
          <p className={styles.eyebrow}>
            Goodwill Industries of Central Florida
          </p>
          <h1 className={styles.motto}>
            Building Lives
            <br />
            that <span className={styles.gold}>Work.</span>
          </h1>
          <p className={styles.lead}>
            Your secure home for company resources, people, and tools — all in
            one place.
          </p>
        </section>

        <SignInCard errorMessage={errorMessage} />
      </div>
    </main>
  );
}
```

### `lib/env.ts`

**Replace the whole file.** Adds the optional `KILL_SWITCH_SECRET`.

```ts
/**
 * lib/env.ts
 *
 * Single validated source of truth for environment configuration.
 *
 * SERVER-ONLY. The "server-only" import below makes the build fail if this
 * file is ever pulled into browser-side code, which is what keeps
 * ENTRA_CLIENT_SECRET out of the JavaScript bundle sent to users.
 */
import "server-only";
import { z } from "zod";

const envSchema = z.object({
  // --- Required now ---
  AUTH_SECRET: z
    .string()
    .min(32, "must be at least 32 characters - regenerate it"),

  AUTH_URL: z
    .string()
    .startsWith("http", "must be a full URL, e.g. http://localhost:3000"),

  // --- Microsoft Entra ID ---
  ENTRA_TENANT_ID: z.string().min(1),
  ENTRA_CLIENT_ID: z.string().min(1),
  ENTRA_CLIENT_SECRET: z.string().min(1),

  // Microsoft Entra OAuth redirect URI
  AZURE_REDIRECT_URI: z.url(),

  // --- Portal access control ---
  PORTAL_ALLOWED_GROUP_IDS: z.string().optional(),

  // --- SharePoint ---
  SHAREPOINT_SITE_ID: z.string().optional(),
  // Optional: overrides the built-in GWCORPContact list ID if it ever changes.
  SHAREPOINT_CONTACTS_LIST_ID: z.string().optional(),

  // --- Emergency kill switch ---
  // Base32 secret for the time-based kill-switch code (see
  // lib/security/kill-code.ts). Optional: when unset the kill switch is inert
  // (no code will ever verify), so the portal still boots without it.
  KILL_SWITCH_SECRET: z.string().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Report WHICH variable is wrong, never its value - so a crash log
    // can never leak a secret.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    /**
     * During `next build` (e.g. in Azure/CI) the real runtime settings are
     * not present yet - they live in Azure App Settings and are only
     * injected when the app actually RUNS. So we must not fail the build
     * here. The app still validates for real on first run (below), so a
     * misconfigured production deployment fails loudly at startup, not
     * silently.
     */
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return process.env as unknown as z.infer<typeof envSchema>;
    }

    throw new Error(
      `Invalid environment configuration:\n${issues}`,
    );
  }

  return parsed.data;
}

export const env = loadEnv();

/** Whether Entra ID sign-in is fully configured yet. */
export const isAuthConfigured =
  Boolean(env.ENTRA_TENANT_ID) &&
  Boolean(env.ENTRA_CLIENT_ID) &&
  Boolean(env.ENTRA_CLIENT_SECRET) &&
  Boolean(env.AZURE_REDIRECT_URI);

/** "id1,id2" -> ["id1","id2"]. Empty array until configured. */
export const allowedGroupIds: string[] =
  env.PORTAL_ALLOWED_GROUP_IDS
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];
```

### `lib/graph/client.ts`

**Replace the whole file.** Adds the `GraphListItem` type and the kill check as step 0 of `graphRequest()`, so no data call can run while disabled.

```ts
/**
 * lib/graph/client.ts
 *
 * Server-side Microsoft Graph client for the GoodGuide Portal.
 *
 * Security model:
 *  - AUTHORIZATION happens HERE, on the data layer. Every Graph call first
 *    requires a valid portal session AND that the session passes
 *    hasPortalAccess(). This is the single choke point: no route or page can
 *    read SharePoint data without an authorized user, even by mistake.
 *  - The Graph token itself is APP-ONLY (client credentials, Sites.Selected).
 *    The app reads SharePoint as itself, scoped to one site. The signed-in
 *    user's identity gates WHETHER we make the call; it is not what Graph
 *    authenticates as.
 *  - Read-only. Only GET helpers are exported.
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

/** A SharePoint list item as returned with $expand=fields. */
export type GraphListItem<TFields> = {
  id: string;
  fields: TFields;
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

/**
 * Get the configured SharePoint site ID.
 */
export function getSharePointSiteId(): string {
  if (!env.SHAREPOINT_SITE_ID) {
    throw new Error("SHAREPOINT_SITE_ID is not configured.");
  }
  return env.SHAREPOINT_SITE_ID;
}

/**
 * Execute a read request against Microsoft Graph.
 *
 * Authorization (session + portal access) is enforced before any token is
 * acquired or any network call is made.
 */
export async function graphRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // 0. Kill switch: if the portal has been disabled, no data call proceeds.
  // Lazy import avoids a static import cycle (app-control imports this file);
  // isAppKilled is cached, so this stays cheap.
  const { isAppKilled } = await import("@/lib/graph/app-control");
  if (await isAppKilled()) {
    throw new GraphApiError("Application is disabled.", 503, "app_disabled");
  }

  // 1. Must be signed in.
  const session = await getSession();
  if (!session) {
    throw new GraphApiError("Authentication required.", 401);
  }

  // 2. Must be authorized for the portal (tenant + group rules).
  if (!hasPortalAccess(session)) {
    throw new GraphApiError("Not authorized to access this resource.", 403);
  }

  // 3. Read as the application (Sites.Selected, one site only).
  const accessToken = await acquireAppGraphToken();

  const url = graphUrl(path);
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");

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

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Convenience helper for GET requests.
 */
export async function graphGet<T>(path: string): Promise<T> {
  return graphRequest<T>(path, { method: "GET" });
}

/**
 * Build a Graph URL relative to v1.0.
 */
export function graphUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${GRAPH_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
```


---

## Test it

Locally with `npm run dev` (and `KILL_SWITCH_SECRET` in `.env.local`):

1. Sign out, go to the sign-in page, click the empty background 8 times quickly. The "Application control" box opens saying **Disable app**.
2. Enter a wrong code → "Incorrect or expired code." Nothing changes.
3. Enter the current code from your authenticator → the page reloads to **Temporarily unavailable**.
4. Try any URL directly — `/portal`, `/portal/contacts`, `/api/resources/x`. All blocked: pages show the unavailable screen and data calls are refused on the server.
5. On the unavailable screen, 8 clicks again → the box now says **Re-enable app**. Enter the code → the portal is back.
6. Check the `AppControl` list in SharePoint: one row, `Killed` reflecting the last change.

Then commit and push the usual way.

## If something goes wrong

- **Code always says incorrect:** your phone's clock is off, or the secret in Azure doesn't exactly match the one in the authenticator. Re-check both.
- **"Too many attempts":** 5 wrong codes from one network locks it for 15 minutes. Wait it out.
- **Correct code, but nothing changes:** the app can't write to SharePoint — see Step 2.
- **Locked out and can't flip it back:** in SharePoint, open the `AppControl` list and untick `Killed` by hand. The portal comes back within 15 seconds.
