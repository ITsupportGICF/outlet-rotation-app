"use server";

/**
 * Server actions for the Admin Portal's user/permission management, plus the
 * invitee's account-setup action.
 *
 * SECURITY: every management action resolves the ACTOR fresh from SharePoint
 * (getCurrentAdminUser) and authorizes against lib/auth/permissions on top of
 * identity guards that need live data — you can never change your own level,
 * deactivate/delete yourself, or remove the last active IT account. Nothing
 * trusts anything the client sent about who they are or what they may do.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { env } from "@/lib/env";
import { getSession, hasPortalAccess } from "@/lib/auth/session";
import { getCurrentAdminUser } from "@/lib/auth/current-admin";
import {
  type AdminUserRecord,
  createAdminUser,
  findAdminUserByEmail,
  findAdminUserByInviteToken,
  completeAccountSetup,
  getAdminUserById,
  setUserActive,
  setUserPermissionLevel,
  setUserPasswordHash,
  setUsername,
  deleteAdminUser,
  regenerateInvite,
  usernameTaken,
  countActiveIT,
} from "@/lib/graph/admin-users";
import {
  isPermissionLevel,
  assignableLevels,
  canDeleteUsers,
  canSetActive,
  canChangeLevel,
  canChangePassword,
  canChangeUsername,
  canResendInvite,
} from "@/lib/auth/permissions";
import { hashPassword } from "@/lib/security/password";
import { sendInviteEmail } from "@/lib/graph/invite-email";

function usersUrl(p: {
  msg?: string;
  rerror?: string;
  rmsg?: string;
  invite?: string;
  emailed?: string;
}): string {
  const q = new URLSearchParams();
  q.set("tab", "users");
  if (p.msg) q.set("msg", p.msg);
  if (p.rerror) q.set("rerror", p.rerror);
  if (p.rmsg) q.set("rmsg", p.rmsg);
  if (p.invite) q.set("invite", p.invite);
  if (p.emailed) q.set("emailed", p.emailed);
  return `/admin?${q.toString()}`;
}

function deny(rmsg: string): never {
  redirect(usersUrl({ rerror: "user_error", rmsg }));
}

async function requireActor(): Promise<AdminUserRecord> {
  const actor = await getCurrentAdminUser();
  if (!actor) redirect("/admin?relogin=1");
  return actor;
}

function inviteLink(token: string): string {
  return `${env.AUTH_URL}/admin/setup?token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Create account (invite)
// ---------------------------------------------------------------------------

export async function createAdminUserAction(formData: FormData): Promise<void> {
  const actor = await requireActor();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const levelRaw = String(formData.get("permissionLevel") ?? "");

  if (!name) deny("Enter the person's name.");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    deny("Enter a valid email address.");
  }
  if (
    !isPermissionLevel(levelRaw) ||
    !assignableLevels(actor.permissionLevel).includes(levelRaw)
  ) {
    deny("You can't create an account at that permission level.");
  }
  if (await findAdminUserByEmail(email)) {
    deny("An account with that email already exists.");
  }

  let token: string;
  try {
    ({ token } = await createAdminUser({
      name,
      email,
      permissionLevel: levelRaw,
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    deny(
      /not recognized|does not exist|column|invalid request/i.test(msg)
        ? "The AdminUsers list is missing one or more of the new columns (Email, PermissionLevel, SetupComplete, InviteTokenHash, InviteExpiresAt). Add them and try again."
        : "Couldn't create the account — please try again.",
    );
  }

  const link = inviteLink(token);
  const { sent } = await sendInviteEmail(email, name, link);

  revalidatePath("/admin");
  redirect(usersUrl({ msg: "user_created", invite: link, emailed: sent ? "1" : "0" }));
}

// ---------------------------------------------------------------------------
// Manage existing accounts
// ---------------------------------------------------------------------------

export async function setUserLevelAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const itemId = String(formData.get("itemId") ?? "");
  const newLevel = String(formData.get("permissionLevel") ?? "");
  if (!itemId || !isPermissionLevel(newLevel)) deny("Invalid request.");

  const target = await getAdminUserById(itemId);
  if (!target) deny("That account no longer exists.");
  if (actor.itemId === target.itemId) {
    deny("You can't change your own permission level.");
  }
  if (!canChangeLevel(actor.permissionLevel, target.permissionLevel, newLevel)) {
    deny("You don't have permission to make that change.");
  }
  if (
    target.permissionLevel === "IT" &&
    newLevel !== "IT" &&
    target.isActive &&
    (await countActiveIT()) <= 1
  ) {
    deny("You can't remove the last active IT account.");
  }

  await setUserPermissionLevel(itemId, newLevel);
  revalidatePath("/admin");
  redirect(usersUrl({ msg: "user_updated" }));
}

export async function setUserActiveAction(
  itemId: string,
  isActive: boolean,
): Promise<void> {
  const actor = await requireActor();
  const target = await getAdminUserById(itemId);
  if (!target) deny("That account no longer exists.");
  if (actor.itemId === target.itemId && !isActive) {
    deny("You can't deactivate your own account.");
  }
  if (!canSetActive(actor.permissionLevel, target.permissionLevel)) {
    deny("You don't have permission to do that.");
  }
  if (
    !isActive &&
    target.permissionLevel === "IT" &&
    target.isActive &&
    (await countActiveIT()) <= 1
  ) {
    deny("You can't deactivate the last active IT account.");
  }

  await setUserActive(itemId, isActive);
  revalidatePath("/admin");
  redirect(usersUrl({ msg: isActive ? "user_activated" : "user_deactivated" }));
}

export async function deleteUserAction(itemId: string): Promise<void> {
  const actor = await requireActor();
  if (!canDeleteUsers(actor.permissionLevel)) {
    deny("Only IT can delete accounts.");
  }
  const target = await getAdminUserById(itemId);
  if (!target) deny("That account no longer exists.");
  if (actor.itemId === target.itemId) deny("You can't delete your own account.");
  if (
    target.permissionLevel === "IT" &&
    target.isActive &&
    (await countActiveIT()) <= 1
  ) {
    deny("You can't delete the last active IT account.");
  }

  await deleteAdminUser(itemId);
  revalidatePath("/admin");
  redirect(usersUrl({ msg: "user_deleted" }));
}

export async function setUserPasswordAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  if (!canChangePassword(actor.permissionLevel)) {
    deny("Only IT can set passwords.");
  }
  const itemId = String(formData.get("itemId") ?? "");
  const password = String(formData.get("password") ?? "");
  const target = await getAdminUserById(itemId);
  if (!target) deny("That account no longer exists.");
  if (password.length < 10) deny("Password must be at least 10 characters.");

  await setUserPasswordHash(itemId, await hashPassword(password));
  revalidatePath("/admin");
  redirect(usersUrl({ msg: "password_set" }));
}

export async function setUsernameAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  if (!canChangeUsername(actor.permissionLevel)) {
    deny("Only IT can change usernames.");
  }
  const itemId = String(formData.get("itemId") ?? "");
  const username = String(formData.get("username") ?? "").trim();
  const target = await getAdminUserById(itemId);
  if (!target) deny("That account no longer exists.");
  if (username.length < 3 || /\s/.test(username)) {
    deny("Username must be at least 3 characters with no spaces.");
  }
  if (await usernameTaken(username, itemId)) deny("That username is taken.");

  await setUsername(itemId, username);
  revalidatePath("/admin");
  redirect(usersUrl({ msg: "username_changed" }));
}

export async function resendInviteAction(itemId: string): Promise<void> {
  const actor = await requireActor();
  const target = await getAdminUserById(itemId);
  if (!target) deny("That account no longer exists.");
  if (target.setupComplete) deny("That account is already set up.");
  if (!canResendInvite(actor.permissionLevel, target.permissionLevel)) {
    deny("You don't have permission to do that.");
  }

  const link = inviteLink(await regenerateInvite(itemId));
  const { sent } = await sendInviteEmail(target.email, target.displayName, link);
  revalidatePath("/admin");
  redirect(usersUrl({ msg: "invite_resent", invite: link, emailed: sent ? "1" : "0" }));
}

// ---------------------------------------------------------------------------
// Invitee account setup (reached from the emailed link, M365-gated by the page)
// ---------------------------------------------------------------------------

export type SetupState = { error: string | null };

export async function completeAccountSetupAction(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const session = await getSession();
  if (!session || !hasPortalAccess(session)) {
    return { error: "Please sign in with your Goodwill Microsoft 365 account first." };
  }

  const token = String(formData.get("token") ?? "");
  const user = await findAdminUserByInviteToken(token);
  if (!user) {
    return {
      error:
        "This setup link is invalid or has expired. Ask an admin to resend your invite.",
    };
  }

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (username.length < 3 || username.length > 100) {
    return { error: "Choose a username between 3 and 100 characters." };
  }
  if (/\s/.test(username)) return { error: "Username can't contain spaces." };
  if (password.length < 10) {
    return { error: "Password must be at least 10 characters." };
  }
  if (password !== confirm) return { error: "The passwords don't match." };
  if (await usernameTaken(username, user.itemId)) {
    return { error: "That username is already taken — choose another." };
  }

  await completeAccountSetup(user.itemId, {
    username,
    passwordHash: await hashPassword(password),
  });

  redirect("/admin?msg=account_ready");
}
