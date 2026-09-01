/**
 * lib/env.ts
 *
 * Single validated source of truth for environment configuration.
 *
 * SERVER-ONLY. The "server-only" import below makes the build fail if this
 * file is ever pulled into browser-side code, which is what keeps
 * ENTRA_CLIENT_SECRET (and every other secret here) out of the JavaScript
 * bundle sent to users.
 */
import "server-only";
import { z } from "zod";

const envSchema = z.object({
  // --- Required now ---
  AUTH_SECRET: z
    .string()
    .min(32, "must be at least 32 characters - regenerate it"),

  AUTH_URL: z
    .string()
    .startsWith("http", "must be a full URL, e.g. http://localhost:3000"),

  // --- Microsoft Entra ID ---
  ENTRA_TENANT_ID: z.string().min(1),
  ENTRA_CLIENT_ID: z.string().min(1),
  ENTRA_CLIENT_SECRET: z.string().min(1),

  // Microsoft Entra OAuth redirect URI
  AZURE_REDIRECT_URI: z.url(),

  // --- App access control (tenant/group gate on the app itself) ---
  PORTAL_ALLOWED_GROUP_IDS: z.string().optional(),

  // --- SharePoint ---
  // The site is the only SharePoint id the app needs: every list is resolved
  // by its (space-free) display name at runtime and cached (see
  // lib/graph/lists.ts), so list GUIDs never have to be copied into config.
  // Optional so the app still boots (showing "not connected yet" messages)
  // before the Sites.Selected grant + site id are in place.
  SHAREPOINT_SITE_ID: z.string().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Report WHICH variable is wrong, never its value - so a crash log
    // can never leak a secret.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    /**
     * During `next build` (e.g. in Azure/CI) the real runtime settings are
     * not present yet - they live in Azure App Settings and are only
     * injected when the app actually RUNS. So we must not fail the build
     * here. The app still validates for real on first run (below), so a
     * misconfigured production deployment fails loudly at startup, not
     * silently.
     */
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return process.env as unknown as z.infer<typeof envSchema>;
    }

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

export const env = loadEnv();

/** Whether Entra ID sign-in is fully configured yet. */
export const isAuthConfigured =
  Boolean(env.ENTRA_TENANT_ID) &&
  Boolean(env.ENTRA_CLIENT_ID) &&
  Boolean(env.ENTRA_CLIENT_SECRET) &&
  Boolean(env.AZURE_REDIRECT_URI);

/** Whether the SharePoint data layer has enough config to make calls. */
export const isSharePointConfigured = Boolean(env.SHAREPOINT_SITE_ID);

/** "id1,id2" -> ["id1","id2"]. Empty array until configured. */
export const allowedGroupIds: string[] =
  env.PORTAL_ALLOWED_GROUP_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];
