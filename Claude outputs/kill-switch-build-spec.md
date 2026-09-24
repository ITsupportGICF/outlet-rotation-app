# Build Brief — Emergency TOTP Kill Switch (paste this to an agent)

You are adding an **emergency kill switch** to this web app (Next.js App Router,
Node runtime, TypeScript assumed — adapt the framework-specific parts if the
stack differs). Follow this brief exactly, then run the verification steps and
tell me the results.

## What it must do
- A hidden gesture on the sign-in / landing page (**click the page background 8
  times within ~4 seconds**) opens a prompt for a **rotating 6-digit code**.
- A correct code **disables** the whole app (every route shows a "temporarily
  unavailable" screen; all data calls are refused). Entering a correct code
  again on the disabled screen **re-enables** it.
- It works **without** the app's normal login (so it works even if that login is
  compromised). The only gate is the rotating code + rate limiting.

## HARD SAFETY RULES — do not violate
1. **Disable-only / fail-closed.** A valid code may ONLY flip a boolean
   (live ↔ disabled). It must NEVER grant a session, read data, or expose any
   screen. Worst case for a leaked code = the app goes offline, never a breach.
2. **Secret is server-side only** (`process.env.KILL_SWITCH_SECRET`), never sent
   to the browser, never logged, never hard-coded.
3. **Never log** the code or the secret — log failed attempts as counts only.
4. **Fail open on read errors:** if the "is it disabled?" state can't be read
   (store down, build phase), treat the app as LIVE. Only a real, readable
   `disabled=true` takes it offline.
5. Use **standard TOTP (RFC 6238)** so the owner holds the code in Google
   Authenticator / Authy. Do NOT invent a custom `hash % 10000` scheme.

## Design decisions (and why — carry these over)
- **TOTP HMAC-SHA1, 6 digits, 30s period, ±1 step tolerance (~90s skew).** These
  are Google Authenticator's defaults, so a scanned secret "just works."
- **State store** = one persisted server-side boolean the app can read on every
  request (cache it ~15s) and write without a user session. Use whatever this
  project already has (a DB row, a SharePoint list, Redis/KV, Azure App Config).
  It must be reachable **pre-auth and while disabled** (that's how you re-enable).
- **Enforcement in two places:** (a) the root layout renders the disabled screen
  instead of the app when the flag is set; (b) the data layer refuses calls when
  the flag is set (defense in depth).
- **Rate limit** the verify endpoint: per-IP (5 / 15 min) + global (20 / 15 min),
  then lockout. In-memory is fine for a single instance; move counters into the
  shared store if the app scales out.

---

## Files to create

### 1) `lib/security/kill-code.ts` — TOTP verify (generic, Node crypto)
```ts
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const SKEW_STEPS = 1; // accept current 30s step and one on each side

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 0xff); }
  }
  return Buffer.from(out);
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin =
    ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) |
    ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** True only if `supplied` matches the current or an adjacent 30s step. Constant-time. */
export function verifyKillCode(supplied: string): boolean {
  const secret = process.env.KILL_SWITCH_SECRET;
  if (!secret) return false;
  const normalized = String(supplied ?? "").replace(/\D/g, "");
  if (normalized.length !== DIGITS) return false;
  const key = base32Decode(secret);
  if (key.length === 0) return false;
  const step = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
  const suppliedBuf = Buffer.from(normalized);
  let matched = false; // evaluate all candidates (no early return) for constant time
  for (let i = -SKEW_STEPS; i <= SKEW_STEPS; i++) {
    const candidate = Buffer.from(hotp(key, step + i));
    if (candidate.length === suppliedBuf.length && timingSafeEqual(candidate, suppliedBuf)) {
      matched = true;
    }
  }
  return matched;
}
```

### 2) `lib/kill-state.ts` — the disabled flag (IMPLEMENT the store for THIS project)
Provide two functions. Plug the body into whatever persistence this project
already uses. Requirements: `isKilled()` must be cheap (cache ~15s) and **fail
open** (return false on any error); `setKilled()` writes the flag. Neither may
require a user session.
```ts
import "server-only";

let cache: { at: number; killed: boolean } | null = null;
const TTL_MS = 15_000;

async function readFlag(): Promise<boolean> {
  // TODO: read the persisted boolean from your store (DB row / list / KV).
  // Example (replace): return (await db.appState.get("killed")) === true;
  throw new Error("implement readFlag()");
}
async function writeFlag(killed: boolean): Promise<void> {
  // TODO: persist the boolean to your store.
  throw new Error("implement writeFlag()");
}

export async function isKilled(): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.killed;
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  try {
    const killed = await readFlag();
    cache = { at: now, killed };
    return killed;
  } catch {
    cache = { at: now, killed: false }; // FAIL OPEN
    return false;
  }
}
export async function setKilled(killed: boolean): Promise<void> {
  await writeFlag(killed);
  cache = { at: Date.now(), killed };
}
```

### 3) `app/api/kill-switch/route.ts` — rate-limited verify + toggle
```ts
import { NextRequest, NextResponse } from "next/server";
import { verifyKillCode } from "@/lib/security/kill-code";
import { isKilled, setKilled } from "@/lib/kill-state";

const WINDOW_MS = 15 * 60 * 1000, PER_IP_MAX = 5, GLOBAL_MAX = 20;
type Bucket = { count: number; resetAt: number };
const perIp = new Map<string, Bucket>();
let global: Bucket = { count: 0, resetAt: Date.now() + WINDOW_MS };
function bucket(map: Map<string, Bucket>, key: string): Bucket {
  const now = Date.now(); const b = map.get(key);
  if (!b || now > b.resetAt) { const f = { count: 0, resetAt: now + WINDOW_MS }; map.set(key, f); return f; }
  return b;
}
function globalBucket(): Bucket { if (Date.now() > global.resetAt) global = { count: 0, resetAt: Date.now() + WINDOW_MS }; return global; }
function clientIp(r: NextRequest): string { return r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"; }
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400, headers: noStore });
  const ip = clientIp(request); const ib = bucket(perIp, ip); const gb = globalBucket();
  if (ib.count >= PER_IP_MAX || gb.count >= GLOBAL_MAX)
    return NextResponse.json({ ok: false, error: "too_many_attempts" }, { status: 429, headers: noStore });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ ok:false, error:"bad_request" }, { status:400, headers:noStore }); }
  const action = (body as { action?: unknown })?.action;
  const code = (body as { code?: unknown })?.code;
  if ((action !== "kill" && action !== "revive") || typeof code !== "string")
    return NextResponse.json({ ok:false, error:"bad_request" }, { status:400, headers:noStore });
  if (!verifyKillCode(code)) {
    ib.count += 1; gb.count += 1;
    console.warn("[kill-switch] invalid code", { ip, action, ipFails: ib.count }); // never log the code
    return NextResponse.json({ ok:false, error:"invalid_code" }, { status:401, headers:noStore });
  }
  perIp.delete(ip);
  const killed = action === "kill";
  await setKilled(killed);
  console.warn("[kill-switch] state changed", { ip, killed });
  return NextResponse.json({ ok:true, killed }, { status:200, headers:noStore });
}

export async function GET() {
  return NextResponse.json({ killed: await isKilled() }, { headers: noStore });
}
```

### 4) `app/_components/KillSwitchPanel.tsx` — hidden 8-click gesture + prompt (client)
```tsx
"use client";
import { useEffect, useRef, useState } from "react";
const REQUIRED_CLICKS = 8, CLICK_WINDOW_MS = 4000;

export default function KillSwitchPanel() {
  const [open, setOpen] = useState(false);
  const clicks = useRef(0); const last = useRef(0);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("a,button,input,select,textarea,[role='button']")) return;
      const now = Date.now();
      clicks.current = now - last.current > CLICK_WINDOW_MS ? 1 : clicks.current + 1;
      last.current = now;
      if (clicks.current >= REQUIRED_CLICKS) { clicks.current = 0; setOpen(true); }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return open ? <Modal onClose={() => setOpen(false)} /> : null;
}

function Modal({ onClose }: { onClose: () => void }) {
  const [killedNow, setKilledNow] = useState<boolean | null>(null);
  const [code, setCode] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/kill-switch").then(r => r.json()).then(d => setKilledNow(!!d?.killed)).catch(() => setKilledNow(false)); }, []);
  const action = killedNow ? "revive" : "kill";
  const label = killedNow ? "Re-enable app" : "Disable app";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (code.replace(/\D/g, "").length !== 6) { setMsg("Enter the 6-digit code."); return; }
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/kill-switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, code: code.replace(/\D/g, "") }) });
      if (res.status === 429) { setMsg("Too many attempts. Wait 15 minutes."); setBusy(false); return; }
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok) { window.location.reload(); return; }
      setMsg("Incorrect or expired code."); setBusy(false);
    } catch { setMsg("Could not reach the server."); setBusy(false); }
  }
  return (
    <div role="dialog" aria-modal="true" style={{ position:"fixed", inset:0, zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(4,10,20,0.72)", padding:"1rem" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} style={{ width:"100%", maxWidth:360, borderRadius:18, background:"#0d2138", border:"1px solid rgba(255,255,255,0.12)", padding:"1.75rem", color:"#e2ebf5" }}>
        <h2 style={{ fontSize:20, fontWeight:700, color:"#fff", margin:"0 0 8px" }}>{killedNow === null ? "…" : label}</h2>
        <input inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000"
          style={{ width:"100%", padding:"12px 14px", fontSize:22, letterSpacing:6, textAlign:"center", borderRadius:12, border:"1px solid rgba(255,255,255,0.18)", background:"rgba(255,255,255,0.06)", color:"#fff" }} />
        {msg && <p role="alert" style={{ marginTop:10, fontSize:13, color:"#ff9b9b" }}>{msg}</p>}
        <div style={{ display:"flex", gap:10, marginTop:16 }}>
          <button type="button" onClick={onClose} style={{ flex:1, padding:"11px 0", borderRadius:12, border:"1px solid rgba(255,255,255,0.18)", background:"transparent", color:"#e2ebf5" }}>Cancel</button>
          <button type="submit" disabled={busy || killedNow === null} style={{ flex:1.4, padding:"11px 0", borderRadius:12, border:"none", background: killedNow ? "#2e7d5b" : "#a83232", color:"#fff", fontWeight:600 }}>{busy ? "Working…" : label}</button>
        </div>
      </form>
    </div>
  );
}
```

### 5) `app/_components/AppDisabledScreen.tsx` — shown when killed (hosts revive gesture)
```tsx
import KillSwitchPanel from "@/app/_components/KillSwitchPanel";
export default function AppDisabledScreen() {
  return (
    <main style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:"1.5rem", background:"linear-gradient(160deg,#0d2138,#081525)", color:"#e2ebf5", textAlign:"center" }}>
      <KillSwitchPanel />
      <div style={{ maxWidth:420 }}>
        <h1 style={{ fontSize:26, fontWeight:700, color:"#fff", margin:"0 0 10px" }}>Temporarily unavailable</h1>
        <p style={{ fontSize:15, color:"rgba(226,235,245,0.72)", margin:0 }}>This app is offline for maintenance. Please check back shortly.</p>
      </div>
    </main>
  );
}
```

## Wiring (edits)
- **`app/layout.tsx`** — make it `async`, gate on the flag:
  ```tsx
  import { isKilled } from "@/lib/kill-state";
  import AppDisabledScreen from "@/app/_components/AppDisabledScreen";
  export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const killed = await isKilled();
    return (<html lang="en"><body>{killed ? <AppDisabledScreen /> : children}</body></html>);
  }
  ```
- **Sign-in / landing page** — add `<KillSwitchPanel />` inside the main element.
- **Data layer (defense in depth)** — at the top of the single function every data
  call funnels through, refuse when killed:
  ```ts
  const { isKilled } = await import("@/lib/kill-state"); // lazy import avoids an import cycle
  if (await isKilled()) throw new Error("app_disabled");
  ```
- **Env** — register `KILL_SWITCH_SECRET` as an OPTIONAL env var (app still boots
  without it; the switch is simply inert until it's set).

## One-time setup
1. **Generate a strong base32 secret + enrollment URI** (run in Node):
   ```js
   const { randomBytes } = require("crypto");
   const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
   const b32 = b => { let bits=0,v=0,o=""; for (const x of b){v=(v<<8)|x;bits+=8;while(bits>=5){o+=A[(v>>>(bits-5))&31];bits-=5;}} if(bits>0)o+=A[(v<<(5-bits))&31]; return o; };
   const secret = b32(randomBytes(20));
   console.log("KILL_SWITCH_SECRET =", secret);
   console.log(`otpauth://totp/App:KillSwitch?secret=${secret}&issuer=App&algorithm=SHA1&digits=6&period=30`);
   ```
2. Put `KILL_SWITCH_SECRET` in the server env (local `.env.local` for dev; the
   host's app settings for prod). Never in client code.
3. Scan the `otpauth://` URI in Google Authenticator / Authy (or enter the base32
   key manually: time-based, 6 digits, 30s).

## Verification (do these and report back)
1. **Prove the TOTP is standard** against the official RFC 6238 vectors:
   ```js
   const { createHmac } = require("crypto");
   const hotp=(k,c)=>{const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/0x100000000),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",k).update(b).digest();const o=h[h.length-1]&15;const n=((h[o]&127)<<24)|((h[o+1]&255)<<16)|((h[o+2]&255)<<8)|(h[o+3]&255);return (n%1000000).toString().padStart(6,"0");};
   const key=Buffer.from("12345678901234567890","ascii");
   console.log(hotp(key,Math.floor(59/30))==="287082", hotp(key,Math.floor(1111111109/30))==="081804"); // both true
   ```
2. `npm run build` (or the project's build) → must be exit 0, no type errors.
3. Set the env var, run the app, do the 8-click gesture, enter the current code
   from the authenticator → app disables. Repeat on the disabled screen → app
   re-enables.
4. Enter a wrong code 6 times → confirm the lockout (HTTP 429).

## Gotchas that will waste your time (from a real build)
- **Code "always invalid" = the secret isn't set in the environment you're
  testing** (or is set in prod but you're on localhost, or vice-versa). This is
  the #1 cause; check it first.
- **Wrong code on a scan = a mistyped manual key.** Re-scan the QR.
- **Off by a whole window = phone clock drift.** Google Authenticator →
  Settings → "Time correction for codes" → Sync now. (±90s is tolerated.)
- **Import cycle** between the data-layer file and the kill-state file — use the
  lazy `await import()` shown above.
- If the async root layout complains during static generation, keep `isKilled()`
  guarded for the build phase (shown) and failing open.
```
