import { NextRequest, NextResponse } from "next/server";

import { getRotationSignature } from "@/lib/graph/day-view";
import { GraphApiError } from "@/lib/graph/client";

/**
 * Cheap polling endpoint for the Live Dashboard's cross-device auto-refresh.
 * Returns a small signature string that changes whenever the outlet's live
 * state changes (a rotation/override recorded, or the day started/ended). The
 * dashboard polls this and only does a full refresh when the signature moves,
 * so a rotation on the Input device shows up on the Dashboard device within
 * seconds without constant full re-renders.
 *
 * Authorization is enforced inside the Graph client (valid app session +
 * portal access); the dashboard's fetch is same-origin and sends the cookie.
 */
export async function GET(request: NextRequest) {
  const outletId = request.nextUrl.searchParams.get("outletId");
  if (!outletId) {
    return NextResponse.json({ error: "missing outletId" }, { status: 400 });
  }

  try {
    const sig = await getRotationSignature(outletId);
    return NextResponse.json(
      { sig },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const status = err instanceof GraphApiError ? err.status : 500;
    return NextResponse.json(
      { error: "signature_unavailable" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
