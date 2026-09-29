/**
 * lib/auth/locations.ts
 *
 * WHICH OUTLETS THE SIGNED-IN USER MAY USE.
 *
 * Two dedicated Microsoft 365 accounts run the in-store devices, and each is
 * locked to its own store so a store device can never act on the other store's
 * data by accident:
 *
 *   Taft@goodwillcfl.org      -> Taft only
 *   PineHills@goodwillcfl.org -> Pine Hills only
 *
 * EVERY other authenticated Microsoft user is a manager/admin: they need no
 * outlet assignment of any kind and keep full access to both stores, exactly
 * as before this module existed. There is deliberately NO user->outlet mapping
 * table anywhere — the restriction is keyed only off these two known accounts,
 * so nothing has to be maintained per person and the default is "unrestricted".
 *
 * The decision is made from the SERVER-SIDE SESSION identity (the encrypted
 * M365 cookie), never from a URL, form field, or anything else the browser can
 * set. Callers enforce it at every layer — page, API route, and server action.
 *
 * To lock another store later, add a row to STORE_ACCOUNTS below.
 */
import "server-only";

import { listActiveOutlets, type Outlet } from "@/lib/graph/outlets";
import type { PortalSession } from "@/lib/auth/session";

/**
 * A dedicated store account and the outlet it is locked to.
 *
 * `outletKey` is matched against the Outlets list's name, normalized (see
 * outletKey()), so "Pine Hills", "PineHills" and "Pine-Hills" all match.
 */
type StoreAccount = {
  /** Full sign-in address of the dedicated account. */
  email: string;
  /** Normalized name of the outlet this account is locked to. */
  outletKey: string;
  /** Human label used in UI messages. */
  label: string;
};

const STORE_ACCOUNTS: StoreAccount[] = [
  { email: "taft@goodwillcfl.org", outletKey: "taft", label: "Taft" },
  { email: "pinehills@goodwillcfl.org", outletKey: "pinehills", label: "Pine Hills" },
];

/** Lowercase, strip everything but letters/digits: "Pine Hills" -> "pinehills". */
export function outletKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The dedicated store account for this sign-in address, or null for everyone
 * else (i.e. a manager/admin — unrestricted).
 *
 * Matches the full address case-insensitively. It also accepts the same
 * local-part on another domain in the tenant (e.g. the .onmicrosoft.com
 * fallback), because the token's `email` claim is not guaranteed to be the
 * same address as the UPN. Tenant membership has already been verified by the
 * session layer before this is ever called, and no person's sign-in address is
 * simply "taft@" or "pinehills@", so this cannot catch a real staff account.
 */
export function storeAccountFor(
  email: string | null | undefined,
): StoreAccount | null {
  const value = (email ?? "").trim().toLowerCase();
  if (!value) return null;

  const localPart = value.split("@")[0] ?? "";

  return (
    STORE_ACCOUNTS.find(
      (a) => a.email === value || (localPart !== "" && localPart === a.email.split("@")[0]),
    ) ?? null
  );
}

/** What the current user is allowed to reach. */
export type OutletAccess = {
  /** True only for a dedicated store account. */
  restricted: boolean;
  /** "Taft" / "Pine Hills" for a store account, otherwise null. */
  label: string | null;
  /** The active outlets this user may use (all of them when unrestricted). */
  outlets: Outlet[];
  /**
   * For a store account, the id of its one outlet — or null if that outlet is
   * missing or inactive in SharePoint, which means the account can't do
   * anything and the UI should say so rather than show an empty picker.
   */
  soleOutletId: string | null;
};

/**
 * Resolve the signed-in user's outlet access from their session identity.
 *
 * Unrestricted users get every active outlet, which is exactly the list the
 * app showed before — their experience is unchanged.
 */
export async function getOutletAccess(
  session: PortalSession,
): Promise<OutletAccess> {
  const account = storeAccountFor(session.email);
  const active = await listActiveOutlets();

  if (!account) {
    return { restricted: false, label: null, outlets: active, soleOutletId: null };
  }

  const mine = active.filter((o) => outletKey(o.name) === account.outletKey);

  return {
    restricted: true,
    label: account.label,
    outlets: mine,
    soleOutletId: mine[0]?.id ?? null,
  };
}

/**
 * THE authorization check. An unrestricted user may use any outlet; a store
 * account may only use its own. Used by pages, the polling API route, and the
 * rotation server actions so the rule holds no matter how the request arrives.
 */
export function canUseOutlet(access: OutletAccess, outletId: string): boolean {
  if (!access.restricted) return true;
  return access.outlets.some((o) => o.id === outletId);
}

/**
 * Convenience for server actions: resolve access and answer in one step.
 * Returns false when the outlet isn't allowed for this session.
 */
export async function sessionCanUseOutlet(
  session: PortalSession,
  outletId: string,
): Promise<boolean> {
  const access = await getOutletAccess(session);
  return canUseOutlet(access, outletId);
}
