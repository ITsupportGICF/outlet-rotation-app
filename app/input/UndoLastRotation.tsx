"use client";

/**
 * "Undo" on the Input Screen. Two clicks, nothing else:
 *
 *   [↩ Undo]  →  [Confirm Undo]  →  done
 *
 * If Confirm isn't pressed within a few seconds the button quietly goes back
 * to "↩ Undo", so a shared tablet is never left armed.
 *
 * Below IT: shown for 2 minutes after a rotation (measured from the rotation's
 * own stored time), then it disappears. IT (`unlimited`): always shown.
 * The server re-checks all of this before deleting anything.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { undoLastRotationAction } from "@/lib/actions/rotation";
import SubmitButton from "@/app/_components/SubmitButton";

const DISARM_AFTER_MS = 5000;

/**
 * true once `expiresAtMs` has passed. The snapshot is a plain boolean, so it
 * is stable between reads (no infinite-loop warning) and only changes once,
 * at the moment the window closes. Server render: false.
 */
function useExpired(expiresAtMs: number, enabled: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled) return () => {};
      const ms = expiresAtMs - Date.now();
      if (ms <= 0) return () => {};
      const timer = window.setTimeout(onChange, ms + 50);
      return () => window.clearTimeout(timer);
    },
    [expiresAtMs, enabled],
  );
  const getSnapshot = useCallback(
    () => enabled && Date.now() >= expiresAtMs,
    [expiresAtMs, enabled],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export default function UndoLastRotation({
  outletId,
  rotatedAt,
  expiresAtMs,
  unlimited = false,
}: {
  outletId: string;
  /** Kept for callers; no longer displayed. */
  sectionName?: string;
  rotatedAt: string;
  expiresAtMs: number;
  unlimited?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const expired = useExpired(expiresAtMs, !unlimited);

  // Auto-disarm. State is only set from the timer callback, never synchronously.
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), DISARM_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (expired) return null;

  if (armed) {
    return (
      <form action={undoLastRotationAction}>
        <input type="hidden" name="outletId" value={outletId} />
        <input type="hidden" name="rotatedAt" value={rotatedAt} />
        <SubmitButton className="btn btn-danger btn-md" overlayLabel="Undoing…">
          Confirm Undo
        </SubmitButton>
      </form>
    );
  }

  return (
    <button type="button" onClick={() => setArmed(true)} className="btn btn-outline btn-md">
      ↩ Undo
    </button>
  );
}
