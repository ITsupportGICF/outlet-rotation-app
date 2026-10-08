"use client";

/**
 * Two-tap submit for permanent actions (Remove section, Delete user).
 *
 *   [Remove]  →  [Confirm remove]  →  submits
 *
 * The first tap only arms it; if the second tap doesn't come within 5
 * seconds it goes back to normal. Stops one mis-tap on a touch screen from
 * permanently deleting something. Must be rendered inside the <form>.
 */
import { useEffect, useState } from "react";

import SubmitButton from "@/app/_components/SubmitButton";

export default function ConfirmSubmitButton({
  children,
  confirmLabel,
  className = "btn btn-ghost btn-sm",
  style,
  overlayLabel,
}: {
  children: React.ReactNode;
  confirmLabel: string;
  className?: string;
  style?: React.CSSProperties;
  overlayLabel?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (armed) {
    return (
      <SubmitButton className="btn btn-danger btn-sm" overlayLabel={overlayLabel}>
        {confirmLabel}
      </SubmitButton>
    );
  }

  return (
    <button type="button" onClick={() => setArmed(true)} className={className} style={style}>
      {children}
    </button>
  );
}
