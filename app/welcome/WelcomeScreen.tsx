"use client";

/**
 * WelcomeScreen — the post-login transition, shown once right after a
 * successful Microsoft 365 sign-in (see app/welcome/page.tsx).
 *
 * Purely presentational + a timed hand-off. All security checks already ran
 * server-side in page.tsx before this component was allowed to render.
 *
 * Sequence (each line rises smoothly into view):
 *   1. "Welcome to"
 *   2. "Outlet Rotation"
 *   3. the signed-in user's name
 *   4. "Loading your dashboard..."
 * A loading indicator sits below.
 *
 * Hand-off timing - the goal is ZERO wait after the loading screen:
 *   - We keep the welcome screen up for a minimum hold (~4.5s) AND actively
 *     "warm" the dashboard route in the background (prefetch its code + fetch
 *     it so the server render + data are ready). We only fade to the
 *     dashboard once BOTH the minimum hold has elapsed AND it's confirmed
 *     ready - so when the fade completes, the dashboard is already rendered
 *     underneath with no blank wait. A safety cap guarantees we never hang
 *     here forever.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const MIN_HOLD_MS = 4500;
const MAX_HOLD_MS = 9000;
const MIN_HOLD_REDUCED_MS = 1500;
const FADE_MS = 600;

export default function WelcomeScreen({
  name,
  next,
}: {
  name: string;
  next: string;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  const displayName = (name || "").trim() || "Welcome";
  const firstName = displayName.split(" ")[0];

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const minHold = prefersReduced ? MIN_HOLD_REDUCED_MS : MIN_HOLD_MS;

    const start = Date.now();
    const controller = new AbortController();
    const timers: number[] = [];
    let navigated = false;

    router.prefetch(next);

    let dashboardReady = false;
    const warm = fetch(next, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(() => {
        dashboardReady = true;
      })
      .catch(() => {
        dashboardReady = true;
      });

    const go = () => {
      if (navigated) return;
      navigated = true;
      setLeaving(true);
      timers.push(window.setTimeout(() => router.replace(next), FADE_MS));
    };

    timers.push(
      window.setTimeout(
        () => {
          if (dashboardReady) {
            go();
          } else {
            warm.finally(go);
          }
        },
        Math.max(0, minHold - (Date.now() - start)),
      ),
    );

    timers.push(window.setTimeout(go, MAX_HOLD_MS));

    return () => {
      controller.abort();
      timers.forEach((t) => clearTimeout(t));
    };
  }, [router, next]);

  return (
    <main
      role="status"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center overflow-hidden p-6 transition-opacity duration-500"
      style={{ background: "transparent", opacity: leaving ? 0 : 1 }}
    >
      <div
        className="drift-orb pointer-events-none absolute h-72 w-72 rounded-full"
        style={{ top: "12%", left: "8%", background: "radial-gradient(circle, rgba(96,123,155,0.22), transparent 70%)" }}
        aria-hidden="true"
      />
      <div
        className="drift-orb pointer-events-none absolute h-80 w-80 rounded-full"
        style={{ bottom: "8%", right: "10%", background: "radial-gradient(circle, rgba(132,161,196,0.16), transparent 70%)", animationDelay: "-6s" }}
        aria-hidden="true"
      />

      <div className="relative text-center">
        <p
          className="rise-in mb-3 text-sm font-semibold uppercase tracking-[0.35em]"
          style={{ color: "#f5c451", animationDelay: "0.05s" }}
        >
          Welcome to
        </p>

        <h1
          className="rise-in mb-6 text-5xl font-bold sm:text-6xl"
          style={{ color: "#e8f0fa", animationDelay: "0.2s" }}
        >
          Outlet <span style={{ color: "#f5c451" }}>Rotation</span>
        </h1>

        <p
          className="rise-in mb-2 text-2xl font-semibold"
          style={{ color: "#e8f0fa", animationDelay: "0.4s" }}
        >
          {firstName}
        </p>

        <p
          className="rise-in mb-10 text-sm"
          style={{ color: "#f5c451", animationDelay: "0.55s" }}
        >
          Loading your dashboard…
        </p>

        <div
          className="rise-in mx-auto h-1 w-48 overflow-hidden rounded-full"
          style={{ background: "rgba(255,255,255,0.14)", animationDelay: "0.7s" }}
          aria-hidden="true"
        >
          <span
            className="block h-full w-1/3 rounded-full"
            style={{
              background: "linear-gradient(90deg,#ffffff,#f5c451,#f5c451)",
              animation: "loading-bar 1.4s ease-in-out infinite",
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(320%); }
        }
      `}</style>
    </main>
  );
}
