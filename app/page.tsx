import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import Ambient from "@/app/_components/Ambient";

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    "Your account isn't authorized to access this app. Contact IT if you believe this is a mistake.",
  authentication_failed: "Sign-in didn't complete. Please try again.",
  invalid_auth_transaction:
    "Your sign-in session expired before it completed. Please try again.",
};

export default async function HomePage(props: PageProps<"/">) {
  const session = await getSession();
  if (session) {
    redirect("/home");
  }

  const params = await props.searchParams;
  const rawError = params?.error;
  const errorKey = typeof rawError === "string" ? rawError : null;
  const errorMessage = errorKey
    ? ERROR_MESSAGES[errorKey] ?? "Something went wrong. Please try again."
    : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <Ambient />

      <div className="rise-in glass glass-gold gloss relative w-full max-w-md overflow-hidden p-10 text-center">
        <span
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl text-3xl text-white"
          style={{
            background: "linear-gradient(135deg,#0d2138 0%,#081525 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.4), 0 10px 24px rgba(44,62,86,0.32)",
          }}
          aria-hidden="true"
        >
          ⟳
        </span>

        <p className="eyebrow mb-2">Goodwill Industries of Central Florida</p>
        <h1 className="mb-3 text-3xl font-bold" style={{ color: "#ffffff" }}>
          Outlet <span style={{ color: "#f5c451" }}>Rotation</span>
        </h1>
        <p className="mb-8 text-base" style={{ color: "rgba(226,235,245,0.72)" }}>
          Sign in with your Goodwill Microsoft 365 account to continue.
        </p>

        {errorMessage && (
          <div
            role="alert"
            className="mb-6 rounded-xl px-4 py-3 text-left text-sm"
            style={{
              background: "#fdecec",
              border: "1px solid #f3b9b9",
              color: "#9c2c2c",
            }}
          >
            {errorMessage}
          </div>
        )}

        <a
          href="/auth/signin?returnTo=/welcome"
          className="btn btn-primary btn-lg btn-block"
        >
          <MicrosoftLogo />
          Sign in with Microsoft 365
        </a>

        <p className="mt-6 text-xs" style={{ color: "rgba(226,235,245,0.50)" }}>
          Secure access for authorized Goodwill staff only.
        </p>
      </div>
    </main>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
