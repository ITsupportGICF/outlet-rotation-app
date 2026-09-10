import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { findAdminUserByInviteToken } from "@/lib/graph/admin-users";
import Ambient from "@/app/_components/Ambient";

import AccountSetupForm from "./AccountSetupForm";

/**
 * Account setup, reached from the emailed invite link. Requires a valid M365
 * sign-in first (so only a signed-in Goodwill tenant user can complete setup),
 * plus a valid, unexpired invite token. The invitee chooses their own username
 * and password here; after that they sign in to the Admin Center normally.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AccountSetupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/signin");
  if (!hasPortalAccess(session)) redirect("/?error=access_denied");

  const params = await searchParams;
  const token = str(params.token) ?? "";
  const user = token ? await findAdminUserByInviteToken(token) : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-10">
      <Ambient />
      <div className="glass glass-gold gloss relative w-full max-w-md overflow-hidden p-8">
        <p className="eyebrow-light">Outlet Rotation App</p>
        <h1 className="page-title mb-4 mt-1 text-2xl font-bold">
          Set up your account
        </h1>

        {!user ? (
          <div
            className="rounded-xl px-4 py-3 text-sm"
            style={{ background: "#fdecec", border: "1px solid #f3b9b9", color: "#9c2c2c" }}
          >
            This setup link is invalid or has expired. Ask an admin to resend
            your invite.
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm" style={{ color: "rgba(226,235,245,0.72)" }}>
              Welcome, {user.displayName}. Choose a username and password for the
              Admin Portal. Your account email is{" "}
              <span style={{ color: "#ffffff" }}>{user.email}</span>.
            </p>
            <AccountSetupForm token={token} />
          </>
        )}

        <div className="mt-6 text-center">
          <Link href="/home" className="back-link-dark">
            ← Back to app
          </Link>
        </div>
      </div>
    </main>
  );
}
