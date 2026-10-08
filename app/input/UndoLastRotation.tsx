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

/** Current time, ticking once a second. 0 until mounted. */
function useNow(): number {
  const subscribe = useCallback((onChange: () => void) => {
    const timer = window.setInterval(onChange, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return useSyncExternalStore(subscribe, () => Date.now(), () => 0);
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
  const now = useNow();

  // Auto-disarm. State is only set from the timer callback, never synchronously.
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), DISARM_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (!unlimited && now !== 0 && now >= expiresAtMs) return null;

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
