import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { getAdminSession } from "@/lib/auth/admin-session";
import { listOutlets, type Outlet } from "@/lib/graph/outlets";
import { listSectionsForOutlet } from "@/lib/graph/sections";
import { listActiveCommodities } from "@/lib/graph/commodities";
import { getMixMap } from "@/lib/graph/section-mix";
import { listGoalsForOutlet } from "@/lib/graph/commodity-goals";
import { getOutletSettings } from "@/lib/graph/outlet-settings";
import { getOutletDayView } from "@/lib/graph/day-view";
import { getOpenOperatingDay } from "@/lib/graph/operating-days";
import { getDayGoals } from "@/lib/graph/operating-day-goals";
import { getNotificationSettings } from "@/lib/graph/notifications";
import {
  createOutletAction,
  toggleOutletActiveAction,
  createSectionAction,
  updateSectionAction,
  toggleSectionActiveAction,
  deleteSectionAction,
  saveSettingsAction,
  saveGoalsAction,
  applyGoalsToTodayAction,
  saveSectionMixAction,
  saveNotificationSettingsAction,
  startDayAction,
  endDayAction,
  manualRotationAction,
} from "@/lib/actions/admin";
import { formatDateTimeFriendly, parseTimeOfDay } from "@/lib/time";
import Ambient from "@/app/_components/Ambient";
import AppHeader from "@/app/_components/AppHeader";
import SubmitButton from "@/app/_components/SubmitButton";

import AdminLoginForm from "./AdminLoginForm";

const MSG: Record<string, string> = {
  outlet_added: "Outlet added.",
  outlet_saved: "Outlet updated.",
  section_added: "Section added.",
  section_saved: "Section saved.",
  section_removed: "Section removed.",
  mix_saved: "Section mix saved.",
  goal_saved: "Goal saved.",
  goals_saved: "Daily goals saved.",
  goals_applied: "Today's open day now uses these goals.",
  notifications_saved: "Notification settings saved.",
  settings_saved: "Operating settings saved.",
  day_started: "Day started.",
  day_ended: "Day ended.",
  already_open: "That outlet already has an open day — end it before starting a new one.",
  no_open_day: "There's no open day to end for that outlet.",
  manual_done: "Manual rotation recorded.",
};

const RERROR: Record<string, string> = {
  out_of_order: "That section isn't next in the rotation order — no bypass, even here.",
  no_open_day: "Start the day before recording a rotation.",
  no_active_sections: "No active sections are configured.",
  no_mix: "That section has no commodity mix configured yet.",
  unknown_section: "That section isn't recognized for this outlet.",
  no_quantities: "Enter a quantity for at least one commodity before rotating.",
  error: "Something went wrong. Please try again.",
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "rotation", label: "Rotation" },
  { key: "sections", label: "Sections" },
  { key: "mix", label: "Section Mix" },
  { key: "goals", label: "Goals" },
  { key: "settings", label: "Settings" },
  { key: "locations", label: "Locations" },
  { key: "notifications", label: "Notifications" },
] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AdminCenterPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/signin");
  if (!hasPortalAccess(session)) redirect("/?error=access_denied");

  const admin = await getAdminSession();
  const params = await searchParams;
  const outletId = str(params.outletId);
  const tab = str(params.tab) ?? (outletId ? "overview" : "locations");
  const sec = str(params.sec);
  const msg = str(params.msg);
  const rerror = str(params.rerror);

  return (
    <main className="relative min-h-screen">
      <Ambient />
      <AppHeader current="admin" />

      <div className="mx-auto max-w-5xl px-6 pb-14 sm:px-10">
        <div className="mb-6">
          <p className="eyebrow-light">Outlet Rotation App</p>
          <h1 className="page-title text-3xl font-bold">Admin Center</h1>
        </div>

        {!admin ? (
          <div className="glass glass-gold gloss relative mx-auto max-w-md overflow-hidden p-8">
            <p className="mb-6 text-center text-base" style={{ color: "rgba(226,235,245,0.72)" }}>
              Enter the Admin Center username and password to continue. Signing in
              with Microsoft 365 gets you into the app — it does not unlock the
              Admin Center on its own.
            </p>
            <AdminLoginForm />
          </div>
        ) : (
          <>
            {msg && <Banner tone="ok">{MSG[msg] ?? "Saved."}</Banner>}
            {rerror && <Banner tone="error">{RERROR[rerror] ?? "Something went wrong."}</Banner>}
            <AdminWorkspace outletId={outletId} tab={tab} sec={sec} adminName={admin.username} />
          </>
        )}
      </div>
    </main>
  );
}

async function AdminWorkspace({
  outletId,
  tab,
  sec,
  adminName,
}: {
  outletId?: string;
  tab: string;
  sec?: string;
  adminName: string;
}) {
  let outlets: Outlet[] = [];
  let selected: Outlet | null = null;
  try {
    outlets = await listOutlets();
    selected = outletId ? outlets.find((o) => o.id === outletId) ?? null : null;
  } catch {
    return (
      <div
        className="rounded-2xl p-6 text-base"
        style={{ background: "#fff6e0", border: "1px solid #f0d78a", color: "#7a5c05" }}
      >
        SharePoint isn&apos;t connected yet (site not configured, or the lists
        aren&apos;t reachable). Once that&apos;s in place, everything manages
        from here.
      </div>
    );
  }

  const activeOutletId = selected?.id;

  return (
    <div className="space-y-6">
      {/* Outlet switcher + admin identity */}
      <div className="glass glass-gold flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1" style={{ alignSelf: "center" }}>Outlet</span>
          {outlets.length === 0 ? (
            <span className="text-sm" style={{ color: "rgba(226,235,245,0.50)" }}>None yet — add one under Locations.</span>
          ) : (
            outlets.map((o) => (
              <Link
                key={o.id}
                href={`/admin?outletId=${encodeURIComponent(o.id)}&tab=${tab === "locations" ? "overview" : tab}`}
                className={`chip ${o.id === activeOutletId ? "" : ""}`}
                style={
                  o.id === activeOutletId
                    ? { background: "linear-gradient(135deg,#0d2138,#081525)", color: "#fff" }
                    : { background: "rgba(255,255,255,0.08)", color: "#ffffff", cursor: "pointer" }
                }
              >
                {o.name}
                {!o.isActive && " (inactive)"}
              </Link>
            ))
          )}
        </div>
        <span className="text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
          Admin: <strong style={{ color: "#ffffff" }}>{adminName}</strong> · 30&nbsp;min
        </span>
      </div>

      {/* Tab bar */}
      <div className="glass flex flex-wrap gap-1.5 p-2">
        {TABS.map((t) => {
          const href =
            t.key === "locations"
              ? `/admin?tab=locations${activeOutletId ? `&outletId=${encodeURIComponent(activeOutletId)}` : ""}`
              : `/admin?tab=${t.key}${activeOutletId ? `&outletId=${encodeURIComponent(activeOutletId)}` : ""}`;
          return (
            <Link key={t.key} href={href} className={`tab${tab === t.key ? " active" : ""}`}>
              {t.label}
            </Link>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "locations" ? (
        <LocationsTab outlets={outlets} />
      ) : tab === "notifications" ? (
        <NotificationsTab />
      ) : !selected ? (
        <Card title="Select an outlet">
          <p className="text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
            Choose an outlet above to manage its {tab}. Add or edit outlets under
            the <strong>Locations</strong> tab.
          </p>
        </Card>
      ) : tab === "overview" ? (
        <OverviewTab outlet={selected} />
      ) : tab === "rotation" ? (
        <RotationTab outlet={selected} sec={sec} />
      ) : tab === "sections" ? (
        <SectionsTab outlet={selected} />
      ) : tab === "mix" ? (
        <MixTab outlet={selected} />
      ) : tab === "goals" ? (
        <GoalsTab outlet={selected} />
      ) : tab === "settings" ? (
        <SettingsTab outlet={selected} />
      ) : (
        <OverviewTab outlet={selected} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Tabs
// --------------------------------------------------------------------------

async function OverviewTab({ outlet }: { outlet: Outlet }) {
  const view = await getOutletDayView(outlet.id);
  const openDay = view.openDay;
  const goalsMet = view.commodityProgress.filter((c) => c.goal > 0 && c.actual >= c.goal).length;
  const goalsTotal = view.commodityProgress.filter((c) => c.goal > 0).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Day" value={openDay ? "Open" : "Closed"} />
        <MiniStat label="Rotations" value={String(view.totalRotations)} />
        <MiniStat label="Goals Met" value={goalsTotal > 0 ? `${goalsMet}/${goalsTotal}` : "—"} />
        <MiniStat label="Active Sections" value={String(view.activeSections.length)} />
      </div>

      <Card title="Operating day">
        {openDay ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
              <span className="chip" style={{ background: "#dff3e6", color: "#1c7a44" }}>OPEN</span>{" "}
              Started {formatDateTimeFriendly(openDay.startedAt)}
              {openDay.startedByEmail ? ` by ${openDay.startedByEmail}` : ""}.
            </p>
            <form action={endDayAction}>
              <input type="hidden" name="outletId" value={outlet.id} />
              <SubmitButton className="btn btn-danger btn-md" overlayLabel="Ending day…">End Day</SubmitButton>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
              No open day. Starting the day snapshots the current hours,
              thresholds, and goals onto it.
            </p>
            <form action={startDayAction}>
              <input type="hidden" name="outletId" value={outlet.id} />
              <SubmitButton className="btn btn-primary btn-md" overlayLabel="Starting day…">Start Day</SubmitButton>
            </form>
          </div>
        )}
      </Card>
    </div>
  );
}

async function RotationTab({ outlet, sec }: { outlet: Outlet; sec?: string }) {
  const [view, commodities] = await Promise.all([
    getOutletDayView(outlet.id),
    listActiveCommodities(),
  ]);
  const openDay = view.openDay;
  const sections = view.activeSections;
  const selected = sec ? sections.find((s) => s.id === sec) : undefined;

  return (
    <Card title="Manual rotation">
      <p className="mb-4 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
        A one-time manual adjustment: pick a section, enter the quantity for each
        commodity, and record it. It&apos;s logged separately for that outlet,
        section, and day, and does <strong>not</strong> change the store&apos;s
        settings, goals, section order, or the normal rotation schedule.
      </p>

      {!openDay ? (
        <p className="text-sm" style={{ color: "rgba(226,235,245,0.50)" }}>
          Start the day first (Overview tab) to record a manual rotation.
        </p>
      ) : sections.length === 0 ? (
        <p className="text-sm" style={{ color: "rgba(226,235,245,0.50)" }}>
          No active sections. Add some under the Sections tab.
        </p>
      ) : !selected ? (
        <div>
          <p className="field-label">Select a section</p>
          <div className="flex flex-wrap gap-2">
            {sections.map((s) => (
              <Link
                key={s.id}
                href={`/admin?tab=rotation&outletId=${encodeURIComponent(outlet.id)}&sec=${encodeURIComponent(s.id)}`}
                className="btn btn-outline btn-md"
              >
                {s.name}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-lg font-semibold" style={{ color: "#ffffff" }}>
              {selected.name}
            </p>
            <Link
              href={`/admin?tab=rotation&outletId=${encodeURIComponent(outlet.id)}`}
              className="btn btn-ghost btn-sm"
            >
              Change section
            </Link>
          </div>

          {commodities.length === 0 ? (
            <p className="text-sm" style={{ color: "rgba(226,235,245,0.50)" }}>No commodities configured.</p>
          ) : (
            <form action={manualRotationAction} className="space-y-4">
              <input type="hidden" name="outletId" value={outlet.id} />
              <input type="hidden" name="sectionId" value={selected.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                {commodities.map((c) => (
                  <Field key={c.id} label={c.name}>
                    <input type="number" name={`qty_${c.id}`} min={0} defaultValue={0} className="field-input" />
                  </Field>
                ))}
              </div>
              <SubmitButton className="btn btn-primary btn-md" overlayLabel={`Recording ${selected.name}…`}>
                Rotate {selected.name}
              </SubmitButton>
              <p className="text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
                Only commodities with a quantity above 0 are recorded.
              </p>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}

async function SectionsTab({ outlet }: { outlet: Outlet }) {
  const sections = await listSectionsForOutlet(outlet.id);
  return (
    <Card title="Sections & rotation order">
      <p className="mb-4 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
        Order (lowest first) is the rotation sequence. Only active sections rotate.
      </p>
      <div className="mb-6 space-y-3">
        {sections.length === 0 && <p className="text-sm" style={{ color: "rgba(226,235,245,0.50)" }}>No sections yet.</p>}
        {sections.map((s) => (
          <div key={s.id} className="glass rounded-2xl p-4">
            <form action={updateSectionAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="outletId" value={outlet.id} />
              <input type="hidden" name="itemId" value={s.id} />
              <Field label="Name">
                <input name="name" defaultValue={s.name} required className="field-input w-40" />
              </Field>
              <Field label="Order">
                <input name="displayOrder" type="number" min={0} defaultValue={s.displayOrder} className="field-input w-20" />
              </Field>
              <label className="flex items-center gap-2 pb-2.5 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
                <input type="checkbox" name="isActive" defaultChecked={s.isActive} /> Active
              </label>
              <SubmitButton className="btn btn-outline btn-sm" overlayLabel="Saving section…">Save</SubmitButton>
            </form>
            <div className="mt-2 flex gap-4">
              <form action={toggleSectionActiveAction.bind(null, outlet.id, s.id, !s.isActive)}>
                <SubmitButton className="btn btn-ghost btn-sm" overlayLabel="Updating section…">
                  {s.isActive ? "Deactivate" : "Activate"}
                </SubmitButton>
              </form>
              <form action={deleteSectionAction.bind(null, outlet.id, s.id)}>
                <SubmitButton className="btn btn-ghost btn-sm" style={{ color: "#c23b3b" }} overlayLabel="Removing section…">Remove</SubmitButton>
              </form>
            </div>
          </div>
        ))}
      </div>
      <form action={createSectionAction} className="flex flex-wrap items-end gap-3 border-t pt-5" style={{ borderColor: "rgba(44,62,86,0.08)" }}>
        <input type="hidden" name="outletId" value={outlet.id} />
        <Field label="New section name">
          <input name="name" required placeholder="e.g. Section E" className="field-input w-44" />
        </Field>
        <Field label="Order">
          <input name="displayOrder" type="number" min={0} defaultValue={sections.length} className="field-input w-20" />
        </Field>
        <label className="flex items-center gap-2 pb-2.5 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
          <input type="checkbox" name="isActive" defaultChecked /> Active
        </label>
        <SubmitButton className="btn btn-primary btn-md" overlayLabel="Adding section…">Add section</SubmitButton>
      </form>
    </Card>
  );
}

async function MixTab({ outlet }: { outlet: Outlet }) {
  const [sections, commodities] = await Promise.all([
    listSectionsForOutlet(outlet.id),
    listActiveCommodities(),
  ]);
  const mix = await getMixMap(sections.map((s) => s.id));

  return (
    <Card title="Section commodity mix">
      <p className="mb-4 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
        How many of each commodity go out when a section is rotated. One Rotate
        press logs all of them at once.
      </p>
      {sections.length === 0 || commodities.length === 0 ? (
        <p className="text-sm" style={{ color: "rgba(226,235,245,0.50)" }}>Add sections and commodities first.</p>
      ) : (
        <div className="space-y-4">
          {sections.map((s) => (
            <form key={s.id} action={saveSectionMixAction} className="glass rounded-2xl p-4">
              <input type="hidden" name="outletId" value={outlet.id} />
              <input type="hidden" name="outletName" value={outlet.name} />
              <input type="hidden" name="sectionId" value={s.id} />
              <input type="hidden" name="sectionName" value={s.name} />
              <p className="mb-3 text-lg font-semibold" style={{ color: "#ffffff" }}>{s.name}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {commodities.map((c) => (
                  <Field key={c.id} label={c.name}>
                    <input type="number" name={`qty_${c.id}`} min={0} defaultValue={mix.get(s.id)?.get(c.id) ?? 0} className="field-input" />
                  </Field>
                ))}
              </div>
              <SubmitButton className="btn btn-outline btn-sm mt-3" overlayLabel={`Saving ${s.name} mix…`}>Save {s.name} mix</SubmitButton>
            </form>
          ))}
        </div>
      )}
    </Card>
  );
}

async function GoalsTab({ outlet }: { outlet: Outlet }) {
  const [commodities, goalList, openDay] = await Promise.all([
    listActiveCommodities(),
    listGoalsForOutlet(outlet.id),
    getOpenOperatingDay(outlet.id),
  ]);
  const goals = new Map(goalList.map((g) => [g.commodityId, g.dailyGoal]));
  const dayGoals = openDay ? await getDayGoals(openDay.id) : null;

  // Does today's open-day snapshot already differ from the saved goals? If so,
  // nudge the admin toward "Save & apply to today".
  const daysDiffer =
    !!dayGoals &&
    commodities.some(
      (c) => (dayGoals.get(c.id) ?? 0) !== (goals.get(c.id) ?? 0),
    );

  return (
    <Card title="Daily commodity goals">
      {commodities.length === 0 ? (
        <p className="text-sm" style={{ color: "rgba(226,235,245,0.50)" }}>No commodities configured.</p>
      ) : (
        <form action={saveGoalsAction} className="space-y-4">
          <input type="hidden" name="outletId" value={outlet.id} />
          <input type="hidden" name="outletName" value={outlet.name} />
          <div className="grid gap-3 sm:grid-cols-2">
            {commodities.map((c) => (
              <Field key={c.id} label={c.name}>
                <input type="number" name={`goal_${c.id}`} min={0} defaultValue={goals.get(c.id) ?? 0} className="field-input" />
              </Field>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <SubmitButton className="btn btn-primary btn-md" overlayLabel="Saving goals…">
              Save goals
            </SubmitButton>
            {openDay && (
              <SubmitButton
                className={`btn btn-md ${daysDiffer ? "btn-gold" : "btn-outline"}`}
                overlayLabel="Applying to today…"
                formAction={applyGoalsToTodayAction}
              >
                Save &amp; apply to today
              </SubmitButton>
            )}
          </div>

          {openDay ? (
            <p className="text-xs" style={{ color: "rgba(226,235,245,0.60)" }}>
              Goals are locked onto a day when you press <strong>Start Day</strong>.
              <strong> Save goals</strong> updates the default for future days;
              today&apos;s open day keeps what it was started with
              {daysDiffer ? " — which is different from the goals above" : ""}.
              Use <strong>Save &amp; apply to today</strong> to also push these onto
              today&apos;s dashboard now.
            </p>
          ) : (
            <p className="text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
              No day is open. These goals apply to the next day you start.
            </p>
          )}
        </form>
      )}
    </Card>
  );
}

async function SettingsTab({ outlet }: { outlet: Outlet }) {
  const settings = await getOutletSettings(outlet.id);
  return (
    <Card title="Operating settings">
      <form action={saveSettingsAction} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="outletId" value={outlet.id} />
        <input type="hidden" name="outletName" value={outlet.name} />
        <Field label="Opening time">
          <input type="time" name="operatingHoursStart" defaultValue={toTimeInputValue(settings.operatingHoursStart)} className="field-input" />
        </Field>
        <Field label="Closing time">
          <input type="time" name="operatingHoursEnd" defaultValue={toTimeInputValue(settings.operatingHoursEnd)} className="field-input" />
        </Field>
        <Field label="Green under (minutes since last rotation)">
          <input type="number" name="greenThresholdMinutes" min={1} max={1440} defaultValue={settings.greenThresholdMinutes} className="field-input" />
        </Field>
        <Field label="Yellow under (minutes; at/above is red)">
          <input type="number" name="yellowThresholdMinutes" min={1} max={1440} defaultValue={settings.yellowThresholdMinutes} className="field-input" />
        </Field>
        <Field label="Misc amount ($)">
          <input type="number" name="miscAmount" step="0.01" min={0} defaultValue={settings.miscAmount} className="field-input" />
        </Field>
        <div className="flex items-end">
          <SubmitButton className="btn btn-primary btn-md" overlayLabel="Saving settings…">Save settings</SubmitButton>
        </div>
      </form>
      <p className="mt-3 text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
        These are the live settings. Start Day snapshots them onto the day, so
        editing here never changes a day already in progress.
      </p>
    </Card>
  );
}

function LocationsTab({ outlets }: { outlets: Outlet[] }) {
  return (
    <Card title="Outlets / store locations">
      <div className="mb-5 divide-y" style={{ borderColor: "rgba(44,62,86,0.08)" }}>
        {outlets.length === 0 && <p className="py-2 text-sm" style={{ color: "rgba(226,235,245,0.50)" }}>No outlets yet.</p>}
        {outlets.map((o) => (
          <div key={o.id} className="flex items-center justify-between py-3">
            <span className="font-medium" style={{ color: "#ffffff" }}>{o.name}</span>
            <form action={toggleOutletActiveAction.bind(null, o.id, !o.isActive)}>
              <SubmitButton
                className="chip"
                style={o.isActive ? { background: "#dff3e6", color: "#1c7a44", cursor: "pointer" } : { background: "rgba(255,255,255,0.08)", color: "rgba(226,235,245,0.72)", cursor: "pointer" }}
                overlayLabel="Updating outlet…"
              >
                {o.isActive ? "Active" : "Inactive"}
              </SubmitButton>
            </form>
          </div>
        ))}
      </div>
      <form action={createOutletAction} className="flex flex-wrap items-end gap-3 border-t pt-5" style={{ borderColor: "rgba(44,62,86,0.08)" }}>
        <Field label="New outlet name">
          <input name="name" required placeholder="e.g. Kissimmee" className="field-input w-56" />
        </Field>
        <label className="flex items-center gap-2 pb-2.5 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
          <input type="checkbox" name="isActive" defaultChecked /> Active
        </label>
        <SubmitButton className="btn btn-primary btn-md" overlayLabel="Adding outlet…">Add outlet</SubmitButton>
      </form>
    </Card>
  );
}

// --------------------------------------------------------------------------
// Shared bits
// --------------------------------------------------------------------------

async function NotificationsTab() {
  const s = await getNotificationSettings();
  return (
    <Card title="Email notifications">
      <p className="mb-5 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
        The app sends these emails itself — set who receives them and which
        mailbox they come from. Changes take effect immediately.
      </p>
      <form action={saveNotificationSettingsAction} className="space-y-4">
        <Field label="Send from — the mailbox the app sends as">
          <input
            name="fromMailbox"
            type="email"
            defaultValue={s.fromMailbox}
            placeholder="e.g. outlet-rotation@goodwillcfl.org"
            className="field-input"
          />
        </Field>
        <Field label="Recipients — comma or semicolon separated">
          <input
            name="recipients"
            defaultValue={s.recipientsRaw}
            placeholder="SAdhikari@goodwillcfl.org; zthorpe@goodwillcfl.org"
            className="field-input"
          />
        </Field>

        <div className="space-y-2 pt-1">
          <p className="field-label">Send an email when…</p>
          <label className="flex items-center gap-2 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
            <input type="checkbox" name="enableEndOfDay" defaultChecked={s.endOfDay} /> A day is ended (End-of-Day summary)
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
            <input type="checkbox" name="enableConfigChange" defaultChecked={s.configChange} /> A section or its mix is added, removed, or changed
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
            <input type="checkbox" name="enableOverride" defaultChecked={s.override} /> A section is overridden (skipped)
          </label>
        </div>

        <SubmitButton className="btn btn-primary btn-md" overlayLabel="Saving…">
          Save notification settings
        </SubmitButton>
        <p className="text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
          Leave recipients or the sending mailbox blank to pause all emails.
          Sending requires the one-time Mail.Send setup (see
          docs/email-setup.md).
        </p>
      </form>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass glass-gold p-6 sm:p-7">
      <h3 className="mb-4 text-lg font-semibold" style={{ color: "#ffffff" }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass flex flex-col items-center justify-center px-3 py-4 text-center">
      <span className="text-2xl font-bold tabular-nums" style={{ color: "#ffffff" }}>{value}</span>
      <span className="eyebrow mt-1" style={{ fontSize: "0.6rem" }}>{label}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Banner({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  const styles =
    tone === "ok"
      ? { background: "#dff3e6", border: "1px solid #b6e3c6", color: "#1c7a44" }
      : { background: "#fdecec", border: "1px solid #f3b9b9", color: "#9c2c2c" };
  return (
    <div className="mb-5 rounded-xl px-4 py-3 text-sm" style={styles}>
      {children}
    </div>
  );
}

function toTimeInputValue(raw: string | null): string {
  const t = parseTimeOfDay(raw);
  if (!t) return "";
  return `${String(t.hours).padStart(2, "0")}:${String(t.minutes).padStart(2, "0")}`;
}
