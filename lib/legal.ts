/**
 * lib/legal.ts — one place for the facts the legal pages state, so the
 * Privacy Notice, Terms, Accessibility and Licenses pages never disagree.
 *
 * If anything here changes (contact address, cookie names or lifetimes, a new
 * service the app sends data to), update it here AND re-read the pages in
 * app/(legal) to keep them accurate. See docs/compliance/COMPLIANCE.md.
 */

export const ORG_NAME = "Goodwill Industries of Central Florida";
export const APP_NAME = "Outlet Rotation App";
export const CONTACT_EMAIL = "ITsupport@goodwillcfl.org";
/** Date the current versions of the legal pages took effect. */
export const LEGAL_EFFECTIVE_DATE = "November 24, 2026";

/** Every cookie the app sets. All are strictly necessary; none track or advertise. */
export const COOKIES = [
  {
    name: "__Host-ora_session",
    purpose:
      "Keeps you signed in after Microsoft 365 sign-in. Holds your name, work email and Microsoft account ID, encrypted.",
    lifetime: "8 hours, or until you sign out",
  },
  {
    name: "__Host-ora_admin",
    purpose: "Unlocks the Admin Center after an admin username and password are entered. Encrypted.",
    lifetime: "30 minutes, or until you sign out of the Admin Center",
  },
  {
    name: "__Host-ora_authtx",
    purpose:
      "Protects the Microsoft sign-in step against forgery. Created when sign-in starts and deleted as soon as it finishes.",
    lifetime: "10 minutes at most",
  },
] as const;

/** Browser storage that is not a cookie. */
export const LOCAL_STORAGE = [
  {
    name: "ora-contrast",
    purpose: "Remembers whether you turned on High contrast on this device. Never sent to the server.",
    lifetime: "Until you turn it off or clear your browser data",
  },
] as const;

/** Outside services the app relies on, and what they receive. */
export const SERVICE_PROVIDERS = [
  {
    name: "Microsoft Entra ID (Microsoft 365 sign-in)",
    use: "Signs you in with your Goodwill work account. Microsoft tells the app your name, work email, account ID and, if configured, group membership.",
  },
  {
    name: "Microsoft SharePoint Online (via Microsoft Graph)",
    use: "Stores all app data: stores, sections, goals, operating days, rotation records, admin accounts, settings and the event log, in Goodwill's own Microsoft 365 tenant.",
  },
  {
    name: "Microsoft Exchange Online (via Microsoft Graph)",
    use: "Sends the app's operational emails (end-of-day reports, override, undo and configuration alerts, account invitations) from a Goodwill mailbox.",
  },
  {
    name: "Microsoft Azure App Service",
    use: "Hosts the app. Keeps standard web server and application logs (see 'Security logs').",
  },
  {
    name: "GitHub",
    use: "Stores the app's source code and builds it for deployment. It holds no app data about people.",
  },
] as const;
