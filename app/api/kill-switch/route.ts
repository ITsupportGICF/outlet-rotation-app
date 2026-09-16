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
