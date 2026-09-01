import { NextResponse } from "next/server";

/**
 * Lightweight, UNAUTHENTICATED connectivity check.
 *
 * Deliberately public and deliberately returns nothing sensitive - it
 * exists purely so the browser (via ConnectionCheckModal) and, later,
 * Azure App Service health probes have something fast to ping to confirm
 * the app server is actually reachable, as opposed to navigator.onLine,
 * which only reflects the device's network interface state and can be
 * "true" even with no real path to the internet.
 */
export async function GET() {
  return NextResponse.json(
    { ok: true, time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
