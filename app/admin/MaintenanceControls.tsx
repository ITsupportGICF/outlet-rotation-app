"use client";

/**
 * The IT-only maintenance control.
 *
 * Turning maintenance ON closes the app to everyone except IT, so it asks for
 * an expected return time first and then a separate confirmation step — two
 * deliberate actions, never one stray click. Turning it off is a single
 * confirmed action.
 *
 * Every rule here is also enforced on the server (see lib/actions/maintenance)
 * — this form is the convenient path, not the security boundary.
 */
import { useActionState, useState } from "react";

import {
  startMaintenanceAction,
  endMaintenanceAction,
  type MaintenanceResult,
} from "@/lib/actions/maintenance";
import SubmitButton from "@/app/_components/SubmitButton";

const EMPTY: MaintenanceResult = { ok: false, message: "" };

function Result({ state }: { state: MaintenanceResult }) {
  if (!state.message) return null;
  return (
    <div
      role="status"
      className="mb-4 rounded-xl px-4 py-3 text-sm"
      style={
        state.ok
          ? { background: "#eaf5ec", border: "1px solid #b9dcc3", color: "#1c7a44" }
          : { background: "#fdecec", border: "1px solid #f3b9b9", color: "#9c2c2c" }
      }
    >
      {state.message}
    </div>
  );
}

export default function MaintenanceControls({
  isOn,
  returnAtValue,
  returnAtLabel,
  updatedByName,
}: {
  isOn: boolean;
  /** Raw "YYYY-MM-DDTHH:MM" so the picker can be prefilled. */
  returnAtValue: string;
  returnAtLabel: string | null;
  updatedByName: string | null;
}) {
  const [startState, startAction] = useActionState(startMaintenanceAction, EMPTY);
  const [endState, endAction] = useActionState(endMaintenanceAction, EMPTY);
  // Show the result of whichever form was submitted LAST (not always "start").
  const [last, setLast] = useState<"start" | "end">("start");
  const [confirming, setConfirming] = useState<"on" | "off" | null>(null);

  return (
    <div>
      <Result state={last === "end" ? endState : startState} />

      <div
        className="mb-5 rounded-xl px-4 py-3 text-sm"
        style={
          isOn
            ? { background: "#fff6e0", border: "1px solid #f0d78a", color: "#7a5c05" }
            : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(226,235,245,0.80)" }
        }
      >
        {isOn ? (
          <>
            <strong>Maintenance mode is ON.</strong> Only IT can use the app.
            {returnAtLabel ? <> Expected back {returnAtLabel}.</> : null}
            {updatedByName ? <> Turned on by {updatedByName}.</> : null}
          </>
        ) : (
          <>
            <strong>Maintenance mode is OFF.</strong> Everyone can use the app
            normally.
          </>
        )}
      </div>

      {/* Turn on, or update the time while already on */}
      <form action={startAction} onSubmit={() => setLast("start")} className="space-y-4">
        <div>
          <label htmlFor="returnAt" className="field-label">
            Expected back online (Eastern)
          </label>
          <input
            id="returnAt"
            name="returnAt"
            type="datetime-local"
            required
            defaultValue={returnAtValue}
            className="field-input"
          />
          <p className="mt-1 text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
            Shown to everyone who is locked out. Must be in the future.
          </p>
        </div>

        {isOn ? (
          <SubmitButton
            className="btn btn-outline btn-md btn-wrap w-full sm:w-auto"
            overlayLabel="Updating…"
          >
            Update expected time
          </SubmitButton>
        ) : confirming === "on" ? (
          <div className="dialog-actions">
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="btn btn-outline btn-md"
            >
              Cancel
            </button>
            <SubmitButton
              className="btn btn-danger btn-md btn-block"
              overlayLabel="Turning on maintenance…"
            >
              Yes, close the app
            </SubmitButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming("on")}
            className="btn btn-danger btn-md btn-wrap w-full sm:w-auto"
          >
            Turn on maintenance mode
          </button>
        )}

        {confirming === "on" && (
          <p className="text-xs" style={{ color: "#e39898" }}>
            This closes the app for every user except IT — including the Taft
            and Pine Hills devices and the dashboard TVs.
          </p>
        )}
      </form>

      {/* Turn off */}
      {isOn && (
        <form action={endAction} onSubmit={() => setLast("end")} className="mt-6 border-t pt-5" style={{ borderColor: "rgba(255,255,255,0.10)" }}>
          {confirming === "off" ? (
            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="btn btn-outline btn-md"
              >
                Cancel
              </button>
              <SubmitButton
                className="btn btn-primary btn-md btn-block"
                overlayLabel="Reopening the app…"
              >
                Yes, reopen the app
              </SubmitButton>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming("off")}
              className="btn btn-primary btn-md btn-wrap w-full sm:w-auto"
            >
              Turn off maintenance mode
            </button>
          )}
        </form>
      )}
    </div>
  );
}
