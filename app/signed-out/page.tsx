import Link from "next/link";

import Ambient from "@/app/_components/Ambient";

/**
 * Public "you've signed out" landing page (no auth guard — the user has just
 * logged out). Microsoft redirects here after ending the Entra session.
 */
export default function SignedOutPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <Ambient />
      <div className="rise-in glass glass-gold gloss relative w-full max-w-md overflow-hidden p-10 text-center">
        <span
          className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl text-white"
          style={{
            background: "linear-gradient(135deg,#0d2138 0%,#081525 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 24px rgba(44,62,86,0.3)",
          }}
          aria-hidden="true"
        >
          ⟳
        </span>
        <h1 className="mb-2 text-2xl font-semibold" style={{ color: "#ffffff" }}>
          You&rsquo;ve signed out
        </h1>
        <p className="mb-8 text-base" style={{ color: "rgba(226,235,245,0.72)" }}>
          Your Outlet Rotation App session has ended.
        </p>
        <Link href="/auth/signin" className="btn btn-primary btn-lg">
          Sign in again
        </Link>
      </div>
    </main>
  );
}
