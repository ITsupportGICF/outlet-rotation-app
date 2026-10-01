import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { getOutletAccess } from "@/lib/auth/locations";
import { getOutletDayView } from "@/lib/graph/day-view";
import { statusStyle, freshnessLabel } from "@/lib/ui";
import { formatTimeFriendly, formatClockTime } from "@/lib/time";
import Ambient from "@/app/_components/Ambient";
import AppHeader from "@/app/_components/AppHeader";
import OutletPicker from "@/app/_components/OutletPicker";
import { undoExpiresAt } from "@/lib/rotation";
import RotateControls from "./RotateControls";
import UndoLastRotation from "./UndoLastRotation";
import ActionFeedback from "./ActionFeedback";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function InputScreenPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/signin");
  if (!hasPortalAccess(session)) redirect("/?error=access_denied");

  const params = await searchParams;
  const outletId = str(params.outletId);

  // Location gate. A dedicated store account (Taft / Pine Hills) may only ever
  // reach its own outlet — including by typing an ?outletId= for the other
  // store. Every other user is unrestricted, exactly as before.
  let access;
  try {
    access = await getOutletAccess(session);
  } catch {
    return (
      <main className="relative min-h-screen">
        <Ambient />
        <AppHeader current="input" />
        <div className="mx-auto max-w-4xl px-6 pb-14 sm:px-10">
          <SetupNotice />
        </div>
      </main>
    );
  }

  if (access.restricted) {
    if (!access.soleOutletId) return <LocationUnavailable label={access.label} />;
    // Send them to their own outlet, whether they arrived with no outlet at
    // all or with someone else's.
    if (outletId !== access.soleOutletId) {
      redirect(`/input?outletId=${encodeURIComponent(access.soleOutletId)}`);
    }
  }

  return (
    <main className="relative min-h-screen">
      <Ambient />
      <AppHeader current="input" />
      <Suspense fallback={null}>
        <ActionFeedback />
      </Suspense>

      <div className="mx-auto max-w-4xl px-6 pb-14 sm:px-10">
        {!outletId ? (
          <OutletPickerSection outlets={access.outlets} />
        ) : (
          <OutletInput outletId={outletId} />
        )}
      </div>
    </main>
  );
}

/** A store account whose outlet is missing or inactive in SharePoint. */
function LocationUnavailable({ label }: { label: string | null }) {
  return (
    <main className="relative min-h-screen">
      <Ambient />
      <AppHeader current="input" />
      <div className="mx-auto max-w-4xl px-6 pb-14 sm:px-10">
        <SetupNotice
          message={`This device is signed in as the ${label ?? "store"} account, but no active ${label ?? "store"} outlet is configured. Ask an admin to activate it in the Admin Center.`}
        />
      </div>
    </main>
  );
}

function OutletPickerSection({ outlets }: { outlets: { id: string; name: string }[] }) {
  return (
    <OutletPicker
      outlets={outlets}
      basePath="/input"
      title="Choose your outlet"
      subtitle="Select the store this device is at. You can bookmark the page once selected."
    />
  );
}

async function OutletInput({ outletId }: { outletId: string }) {
  let view;
  try {
    view = await getOutletDayView(outletId);
  } catch {
    return <SetupNotice />;
  }

  if (!view.outlet) {
    return (
      <SetupNotice message="That outlet wasn't found. Pick one from the Input Screen." />
    );
  }

  const { outlet, openDay, sections, nextSectionId, totalRotations, lastPress } = view;

  const undoSectionName = lastPress
    ? (sections.find((s) => s.section.id === lastPress.sectionId)?.section.name ??
      "the last section")
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow-light">Input Screen · Rotating at</p>
          <h2 className="page-title text-3xl font-bold">{outlet.name}</h2>
        </div>
        <div className="flex items-center gap-3">
          {openDay && (
            <span className="chip" style={{ background: "rgba(255,255,255,0.08)", color: "#ffffff" }}>
              {totalRotations} rotation{totalRotations === 1 ? "" : "s"} today
            </span>
          )}
          <Link href="/input" className="btn btn-outline btn-sm">
            Change outlet
          </Link>
        </div>
      </div>

      {openDay && lastPress && undoSectionName && (
        <UndoLastRotation
          outletId={outlet.id}
          sectionName={undoSectionName}
          rotatedAt={lastPress.rotatedAt}
          expiresAtMs={undoExpiresAt(lastPress)}
        />
      )}

      {!openDay ? (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: "#fff6e0", border: "1px solid #f0d78a", color: "#7a5c05" }}
        >
          The day hasn&apos;t been started for {outlet.name} yet. A manager starts
          it in the Admin Center before rotations can be recorded.
        </div>
      ) : (
        <p className="page-sub text-base">
          Day is open
          {openDay.operatingHoursStart && openDay.operatingHoursEnd
            ? ` · ${formatTimeFriendly(openDay.operatingHoursStart)} – ${formatTimeFriendly(openDay.operatingHoursEnd)}`
            : ""}
          . Rotate the highlighted section — the order is enforced automatically.
        </p>
      )}

      {sections.length === 0 ? (
        <div className="glass glass-gold p-6 text-base" style={{ color: "rgba(226,235,245,0.72)" }}>
          No active sections are configured. Add or activate sections in the Admin
          Center.
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {sections.map((s) => {
            const isNext = s.section.id === nextSectionId && Boolean(openDay);
            const fresh = statusStyle(s.freshness);
            return (
              <div
                key={s.section.id}
                className={`glass gloss relative overflow-hidden p-6 ${isNext ? "glass-gold" : ""}`}
                style={{
                  opacity: isNext ? 1 : 0.72,
                  boxShadow: isNext
                    ? "inset 0 1px 0 rgba(255,255,255,0.9), 0 24px 50px rgba(44,62,86,0.16)"
                    : undefined,
                }}
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <span
                    className="min-w-0 text-xl font-semibold sm:text-2xl"
                    style={{ color: "#ffffff", overflowWrap: "anywhere" }}
                  >
                    {s.section.name}
                  </span>
                  <span
                    className="chip shrink-0"
                    style={{ background: fresh.bg, color: fresh.text }}
                  >
                    {s.awaitingFirstRotation ? "Ready" : freshnessLabel(s.freshness)}
                  </span>
                </div>
                <p className="mb-4 text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
                  {s.lastRotatedAt
                    ? `Last rotated ${formatClockTime(s.lastRotatedAt)}`
                    : "Not rotated yet today"}
                </p>

                <RotateControls
                  outletId={outletId}
                  sectionId={s.section.id}
                  sectionName={s.section.name}
                  isNext={isNext}
                  hasOpenDay={Boolean(openDay)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SetupNotice({ message }: { message?: string }) {
  return (
    <div
      className="rounded-2xl p-6 text-base"
      style={{ background: "#fff6e0", border: "1px solid #f0d78a", color: "#7a5c05" }}
    >
      {message ??
        "SharePoint isn't connected yet. Once the site is configured and the lists are reachable, outlets and sections will appear here automatically."}
    </div>
  );
}
