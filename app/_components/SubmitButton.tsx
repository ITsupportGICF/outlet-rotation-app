"use client";

/**
 * A submit button that gives clear, prominent feedback while its form's
 * server action is running:
 *   - the button itself shows a spinner and disables (no double-submits)
 *   - a large, centered "Working…" overlay covers the screen so the user is
 *     never left wondering whether their press registered
 *
 * useFormStatus reports the pending state of the nearest enclosing <form>, so
 * this must be rendered inside the form whose action it submits. The overlay
 * clears automatically when the action finishes (the form re-renders /
 * navigates and pending flips back to false).
 */
import { useFormStatus } from "react-dom";

export default function SubmitButton({
  children,
  className = "btn btn-primary btn-md",
  style,
  overlayLabel = "Working…",
  overlay = true,
  formAction,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  overlayLabel?: string;
  overlay?: boolean;
  /**
   * Optional per-button action. Lets one <form> expose more than one submit —
   * each button can target a different server action while sharing the form's
   * inputs. Omit to use the form's own action.
   */
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <button
        type="submit"
        formAction={formAction}
        disabled={pending}
        className={className}
        style={style}
      >
        {pending ? (
          <>
            <span className="spinner spinner-sm" aria-hidden="true" /> Working…
          </>
        ) : (
          children
        )}
      </button>

      {overlay && pending && (
        <div className="action-overlay" role="status" aria-live="polite">
          <div className="glass glass-gold action-overlay-card">
            <span className="spinner" aria-hidden="true" />
            <p className="text-base font-semibold" style={{ color: "#ffffff" }}>
              {overlayLabel}
            </p>
            <p className="text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
              Please wait a moment…
            </p>
          </div>
        </div>
      )}
    </>
  );
}
