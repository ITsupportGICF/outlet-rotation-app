"use client";

/**
 * The Rotate + Override controls for one section on the Input Screen.
 *
 * Only the section that's next in the rotation order is actionable; the rest
 * render disabled, so the order rule is visible in the UI (and re-checked on
 * the server). Override opens a confirmation first — skipping a section is
 * deliberate — and, once confirmed, records the skip and advances the cycle.
 */
import { useState } from "react";

import { performRotationAction, overrideSectionAction } from "@/lib/actions/rotation";
import SubmitButton from "@/app/_components/SubmitButton";

export default function RotateControls({
  outletId,
  sectionId,
  sectionName,
  isNext,
  hasOpenDay,
}: {
  outletId: string;
  sectionId: string;
  sectionName: string;
  isNext: boolean;
  hasOpenDay: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!isNext) {
    return (
      <div className="space-y-2">
        <button type="button" disabled className="btn btn-outline btn-lg btn-block">
          {hasOpenDay ? "Waiting for its turn" : "Day not started"}
        </button>
        <button type="button" disabled className="btn btn-ghost btn-sm btn-block">
          Override
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <form action={performRotationAction}>
        <input type="hidden" name="outletId" value={outletId} />
        <input type="hidden" name="sectionId" value={sectionId} />
        <SubmitButton
          className="btn btn-primary btn-lg btn-block"
          overlayLabel={`Rotating ${sectionName}…`}
        >
          Rotate {sectionName} →
        </SubmitButton>
      </form>

      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn btn-ghost btn-sm btn-block"
        style={{ color: "#8a6d0b" }}
      >
        Override / Skip
      </button>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Override ${sectionName}`}
          className="action-overlay"
          onClick={() => setConfirming(false)}
        >
          <div
            className="glass glass-gold action-overlay-card"
            style={{ maxWidth: "24rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full text-2xl"
              style={{ background: "#fff6e0", color: "#8a6d0b" }}
              aria-hidden="true"
            >
              ⏭
            </span>
            <h2 className="text-lg font-semibold" style={{ color: "#ffffff" }}>
              Override {sectionName}?
            </h2>
            <p className="text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
              {sectionName} will be recorded as skipped and the rotation will
              move to the next section. A notification is sent when a section is
              overridden.
            </p>
            <div className="mt-1 flex w-full gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn btn-outline btn-md flex-1"
              >
                Cancel
              </button>
              <form action={overrideSectionAction} className="flex-1">
                <input type="hidden" name="outletId" value={outletId} />
                <input type="hidden" name="sectionId" value={sectionId} />
                <SubmitButton
                  className="btn btn-danger btn-md btn-block"
                  overlayLabel={`Overriding ${sectionName}…`}
                >
                  Yes, override
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
