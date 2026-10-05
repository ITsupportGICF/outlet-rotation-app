import { NextResponse } from "next/server";

import { getMaintenanceView } from "@/lib/auth/maintenance";
import { getSession } from "@/lib/auth/session";

/**
 * Tiny polling endpoint for the maintenance screen. It reports only whether
 * THIS caller is still blocked — no settings, no identities — so the screen
 * can send the user back into the app the moment maintenance ends.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { blocked: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const view = await getMaintenanceView();
    return NextResponse.json(
      { blocked: view.blocked },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Fail open, same as everywhere else.
    return NextResponse.json(
      { blocked: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
