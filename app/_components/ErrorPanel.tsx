"use client";

import { useEffect } from "react";

/**
 * Shared error screen for the error boundaries (app/error.tsx and
 * app/admin/error.tsx). Shows nothing about the underlying error (no stack
 * traces or internal details) — only that something went wrong. The real
 * detail is still logged.
 *
 * "Try again" calls retry(), which RE-FETCHES the page from the server
 * (reset() only re-renders the cached result and can't recover from a failed
 * SharePoint call).
 *
 * On the TV dashboard nobody is there to press the button, so it retries by
 * itself every 60 seconds until the page comes back.
 */
export default function ErrorPanel({
  error,
  retry,
  fullScreen = true,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  fullScreen?: boolean;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  useEffect(() => {
    if (!window.location.pathname.startsWith("/dashboard")) return;
    const timer = window.setInterval(() => retry(), 60_000);
    return () => window.clearInterval(timer);
  }, [retry]);

  return (
    <div
      className={`flex items-center justify-center p-6 ${fullScreen ? "min-h-screen" : "py-16"}`}
    >
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
        <p
          className="mx-auto mb-8 max-w-sm text-base"
          style={{ color: "rgba(226,235,245,0.72)" }}
        >
          An unexpected error occurred. Please try again, or contact IT if this
          keeps happening.
        </p>
        <button onClick={() => retry()} className="btn btn-primary btn-lg">
          Try again
        </button>
      </div>
    </div>
  );
}
