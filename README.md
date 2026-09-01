# Outlet Rotation App

Internal web app for Goodwill Industries of Central Florida — replaces the
existing Power Apps "Outlet Rotation App." Three areas behind one Microsoft
365 sign-in: a vertical Live Dashboard for the in-store TV, an Input Screen
for running the rotation process, and an Admin Center for configuration.

Same stack and security conventions as the GoodGuide Portal project.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in real values, see below
npm run dev
```

Open http://localhost:3000.

## Environment variables

See `.env.example` for the full list. You'll need:

1. **An Entra ID App Registration** (Azure Portal → Entra ID → App
   registrations → New registration). Single-tenant. Add a redirect URI of
   type "Web": `http://localhost:3000/auth/callback` for local dev, and
   `https://<your-app>.azurewebsites.net/auth/callback` for production, plus
   `.../signed-out` as a second redirect URI for post-logout. Create a
   client secret under "Certificates & secrets." Grant the app the
   `Sites.Selected` **application** permission under Microsoft Graph API
   permissions, and have an admin grant consent.
2. **Sites.Selected access to the SharePoint site** you create for this app
   (separate step - see the SharePoint List Setup Guide). Sites.Selected
   means this app can only reach the one site it's explicitly granted
   access to, not every SharePoint site in the tenant.
3. `AUTH_SECRET` - generate with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Architecture notes

- **Auth**: `@azure/msal-node` confidential client, manual authorization
  code + PKCE flow (`app/auth/signin`, `app/auth/callback`, `app/auth/signout`).
  The ID token is verified independently against Microsoft's JWKS
  (`app/auth/callback/route.ts`) rather than trusted solely from MSAL.
  Session is an encrypted (JWE) cookie (`lib/auth/session.ts`) - identity
  only, no access tokens, 8-hour expiry.
- **SharePoint access**: app-only Graph token (client credentials,
  `Sites.Selected`), never the signed-in user's own token. Every Graph call
  goes through `lib/graph/client.ts`, which re-checks the caller has a valid,
  authorized app session before it will even acquire a token.
- **Admin Center**: a *second*, independent gate on top of the Microsoft 365
  sign-in - a username/password checked against the `AdminUsers` SharePoint
  list (`lib/graph/admin-users.ts`), hashed with scrypt
  (`lib/security/password.ts`), with attempt-count lockout. Successful login
  sets a separate, short-lived (30 min) elevated cookie
  (`lib/auth/admin-session.ts`) bound to the current M365 session - it can't
  be reused by a different signed-in user or replayed after the M365 session
  ends.
- **Security headers / CSP**: `next.config.ts`.

## What's built vs. what's next

Sections management (add/remove/activate) and the misc amount are fully
wired to SharePoint via `lib/graph/sections.ts` and `lib/graph/settings.ts`.
The Live Dashboard and Input Screen render real active-section data once
SharePoint is configured, but the actual **rotation process** (what happens
when a user selects a section on the Input Screen, and what "live" means on
the Dashboard) is a placeholder pending that spec.
