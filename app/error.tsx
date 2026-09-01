"use client";

import { useEffect } from "react";

/**
 * Root error boundary. Deliberately shows nothing about the underlying error
 * to the user (no stack traces or internal details) — only that something
 * went wrong. The real detail is still logged server-side.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass glass-gold gloss relative w-full max-w-md overflow-hidden p-10 text-center">
        <span
          className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl"
          style={{ background: "#fdecec", color: "#c23b3b" }}
          aria-hidden="true"
        >
          !
        </span>
        <h1 className="mb-2 text-2xl font-semibold" style={{ color: "#ffffff" }}>
          Something went wrong
        </h1>
        <p className="mx-auto mb-8 max-w-sm text-base" style={{ color: "rgba(226,235,245,0.72)" }}>
          An unexpected error occurred. Please try again, or contact IT if this
          keeps happening.
        </p>
        <button onClick={reset} className="btn btn-primary btn-lg">
          Try again
        </button>
      </div>
    </div>
  );
}
