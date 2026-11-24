# Outlet Rotation App: compliance record

Last reviewed: **November 24, 2026**. Contact: **ITsupport@goodwillcfl.org**.

This file records what was reviewed, what was put in place, and what is still open. It is an engineering record, **not legal advice**. Items marked ⚖️ need review by a qualified attorney or compliance professional before anyone relies on them.

---

## 1. What the app is (this decides which laws apply)

- It is an **internal staff tool** for Goodwill Industries of Central Florida.
- It needs a Goodwill **Microsoft 365 (Entra ID)** sign-in, checked against the tenant. It is not offered to the public or to consumers.
- **Users:** store staff, store device accounts (Taft, Pine Hills) and Admin Center users. Everyone is an adult employee or an authorized account.
- **No commerce.** There are no payments, marketing, advertising, analytics or tracking.
- **Storage:** all data lives in Goodwill's own Microsoft 365 tenant (SharePoint). The app is hosted on Azure App Service.

---

## 2. Which laws apply ⚖️

These conclusions were reached without web research, because web search was blocked in this session. Have counsel confirm them.

| Law | Applies? | Why / what was done |
|---|---|---|
| **Florida Information Protection Act (FIPA), Fla. Stat. §501.171** | **Likely yes** ⚖️ | The app stores admin usernames with password credentials (scrypt hashes) and work emails, which can count as "personal information" under FIPA. FIPA requires reasonable security measures and breach notice to affected people (generally within 30 days) and to the Florida Attorney General if 500 or more Floridians are affected. Done: hashing, lockout, encryption in transit, role-based access, an audit log, and a breach-notice commitment in the Privacy Notice. **Open:** confirm that Goodwill's incident-response plan covers this app. |
| **Florida Digital Bill of Rights (Ch. 501, Part V)** | **Likely no** ⚖️ | It targets for-profit controllers with over $1B in global revenue that meet further criteria. Goodwill CFL is a nonprofit, and this is an employee tool. |
| **ADA Title I (employment)** | **Yes, in spirit** ⚖️ | Employees with disabilities must get reasonable accommodations. Done: WCAG 2.2 AA work, an Accessibility Statement, and an accommodation contact. |
| **ADA Title III / DOJ web rules** | Unlikely | The app is not a public accommodation offered to the public. Title II (state and local government) does not apply. |
| **Section 504 of the Rehabilitation Act** | **Possibly** ⚖️ | It can apply if Goodwill CFL receives federal financial assistance, for example workforce programs. The WCAG work above is the right control either way. |
| **FTC Act §5 (deception)** | Low risk | The app is not consumer-facing. Even so, the Privacy Notice was written to match the code exactly (section 3). |
| **CAN-SPAM** | No | The app's emails are operational and transactional messages to staff, not commercial messages. They still identify the sender and purpose. |
| **GDPR** | No | There is no EU establishment, no offering to EU residents and no monitoring of EU residents. |
| **CCPA/CPRA** | No | It applies to for-profit businesses and California residents' consumer data; the CPRA employee rules don't reach Florida nonprofits. ⚖️ Confirm if any staff work in California. |
| **COPPA** | No | The app is not directed to children and is employee-only. If Goodwill employs 16–17-year-olds who use it, COPPA still does not apply (it covers under-13s), but HR policy may. |
| **Employee monitoring notice laws (NY, CT, DE)** | No (Florida only) | Monitoring is disclosed in the Privacy Notice and the Terms anyway. ⚖️ Confirm that no stores are outside Florida. |
| **Records retention** | ⚖️ | There is no app-specific statute. Records currently have **no automatic deletion**. Goodwill should set retention periods; see open item 2. |

---

## 3. Data inventory (the Privacy Notice must match this)

| Data | Where | Who sees it | Kept |
|---|---|---|---|
| Name, work email, Entra object ID, tenant ID, group IDs | Encrypted session cookie only | The user (header shows name and email) | 8 h |
| Admin username, display name, email, level, status, failed-attempt count, lockout, last sign-in | SharePoint AdminUsers | Admin Center (by permission level) | Until deleted by IT |
| Admin password (scrypt hash), invite token (SHA-256 hash) and expiry | SharePoint AdminUsers | Nobody (hashes only) | Until changed or deleted |
| Rotation rows: section, commodity quantities, time, **PerformedByEmail** | SharePoint RotationHistory | Admin Center, Event Log | Indefinite (no auto-delete) |
| Start/End Day: **StartedByEmail / EndedByEmail**, times | SharePoint OperatingDays | Admin Center, Event Log | Indefinite |
| Settings changes: **UpdatedByEmail** | SharePoint OutletSettings | Admin Center | Indefinite |
| Maintenance mode: by username or name, time | SharePoint AppControl | IT | Latest value only |
| Event Log: actor (name, username or email), details incl. **failed sign-in usernames** | SharePoint EventLog | All Admin Center levels | Indefinite |
| Email recipients and sender mailbox | SharePoint NotificationSettings | Admin Center | Until changed |
| Emails sent (EOD, override, undo, config change, invite) | Recipients' Exchange mailboxes | Recipients | Exchange retention |
| Kill-switch attempt IP address; sanitized error messages | Azure App Service logs (console) | IT / Azure admins | Azure log settings |
| Standard request logs (IP, URL, user agent, time) | Azure App Service | IT / Azure admins | Azure log settings |
| High-contrast preference | Browser `localStorage` (`ora-contrast`) | That device only | Until cleared |

**Not collected:** SSNs, financial or payment data, health data, precise location, photos or biometrics, analytics or tracking identifiers, and third-party cookies.

**Cookies:** `__Host-ora_session` (8 h), `__Host-ora_admin` (30 min) and `__Host-ora_authtx` (10 min). All are HttpOnly, Secure, SameSite=Lax and encrypted (JWE A256GCM).

---

## 4. Implemented in this review

### Legal pages
- **Pages:** Privacy Notice (`/privacy`), Terms of Use (`/terms`), Accessibility Statement (`/accessibility`) and Licenses (`/licenses`). All are public and need no sign-in. The facts they state live in `lib/legal.ts`.
- **Footer:** small grey footer links (`LegalFooter`) on the sign-in screen, Home, signed-out page and every legal page.
- **Sign-in notice:** "By signing in you agree to the Terms of Use and acknowledge the Privacy Notice."

### Cookies and consent
- **No banner, deliberately.** Only strictly necessary cookies exist, and there is no analytics or tracking. A consent pop-up would be unnecessary and intrusive. The Privacy Notice lists each cookie, its purpose and its lifetime.
- **High contrast** is a user-chosen preference kept in `localStorage`, not a cookie, and is disclosed.

### Forms (data minimization and notices)
- **Admin login:** a notice that sign-in attempts are recorded and accounts lock. Also `autocomplete="username"` (WCAG 1.3.5).
- **Account setup:** a notice that only a one-way hash of the password is kept. Also `autocomplete="username"`.
- **Create admin account:** a notice explaining why name and email are needed (invitation and identification).
- **Notification recipients:** guidance to use Goodwill work addresses only, because the emails contain staff emails and store results.
- **Collection:** no new data is collected. Every existing field was checked as necessary for its purpose.

### Accessibility (target WCAG 2.2 AA)
- **Keyboard:** a "Skip to main content" link on every page with the header, and a visible 3px gold focus ring everywhere (`:focus-visible`).
- **High contrast mode:** a footer switch, remembered per device and applied before first paint so there's no flash.
- **Reduced motion:** all non-essential animation and transitions stop; the loading spinner keeps turning slowly.
- **Contrast:** faint text raised from 42–60% to 66% opacity, and a yellow status chip darkened (`#8a6d0b` → `#6f5708`), to meet 4.5:1.
- **Headings and names:**
  - One `h1` on every page; Home cards and Admin cards moved h3 → h2.
  - The Input Screen and the Insights error and loading states now have an `h1`.
  - The header logo link's name now includes its visible text (WCAG 2.5.3).
- **Target size:** footer links have a 24px minimum target (WCAG 2.5.8).
- **Testing:**
  - axe-core (WCAG 2.0/2.1/2.2 A+AA plus best practice) found **0 violations** on these pages, in both normal and high-contrast mode:
    - Sign-in, Privacy, Terms, Accessibility, Licenses, Signed-out
    - Home, Admin login, Input, Insights (with data), Event Log, Live Dashboard
  - Manual checks: skip link and focus order, focus ring, contrast toggle and persistence, no sideways scrolling at 320px, and reduced-motion behaviour.

### Security
- **Dependencies:** all known vulnerabilities fixed (`npm audit`: **0**):
  - `next` 16.3.2 → **16.4.6** (a critical advisory: remote code execution and cache poisoning in image optimization and `use cache`)
  - `@azure/msal-node` 5.6.0 → **7.2.3** (an auth-code-flow parameter-disclosure advisory). MSAL 7 checks the sign-in nonce itself, so `acquireTokenByCode` now passes the nonce saved at sign-in (`lib/auth/msal.ts`).
  - `zod` 4.4.3 → **4.6.7**; `sharp` and `source-map-js` (transitive) patched; dev-tool advisories patched
- **Logout CSRF:** `/auth/signout` refuses cross-site requests (`Sec-Fetch-Site: cross-site`), so another site can't sign store devices out.
- **Headers:** added `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` and `X-Permitted-Cross-Domain-Policies: none`. These sit on top of the existing CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy.
- **Security contact:** `/.well-known/security.txt` (RFC 9116), expires 2027-11-24, so renew it yearly.
- **Earlier hardening still in place** (see `changelog-2026-10-08-hardening`):
  - a Graph path guard, an open-redirect fix, and kill-switch and login rate limits
  - an admin re-check on each action, retries and timeouts, and no secrets in logs

---

## 5. Third-party software and assets

- **Packages:** 74 production packages: MIT 36, Apache-2.0 17, ISC 3, BSD-3-Clause 2, 0BSD 1, LGPL-3.0-or-later 10 (plus 4 mixed), CC-BY-4.0 1. The full list is in `lib/third-party-licenses.ts`, shown at `/licenses`. Regenerate it after any dependency change.
- **LGPL (`@img/sharp-libvips-*`):** comes with Next.js image tools. It is unmodified and dynamically used, with notice and a source link provided. The app doesn't use `next/image`; the package ships because Next.js depends on it.
- **CC BY 4.0 (`caniuse-lite`):** attribution is provided on `/licenses`.
- **Fonts:** none shipped. The CSS names Inter and Fraunces, but they are not bundled or downloaded (CSP blocks external fonts), so system fonts are used. No font licensing applies.
- **Icons and images:** Unicode glyphs, plus the Microsoft four-square logo on the sign-in button. The logo is used to identify Microsoft sign-in. ⚖️ Confirm this meets Microsoft's brand guidelines for "Sign in with Microsoft".
- **Trademarks:** "Goodwill" is used under Goodwill CFL's membership with Goodwill Industries International. ⚖️ Confirm the trademark attribution wording with GII brand guidelines.
- **Services:** Microsoft Entra ID, Microsoft Graph (SharePoint and Exchange), Azure App Service and GitHub. These are covered by Goodwill's existing Microsoft and GitHub agreements. ⚖️ Confirm that the Microsoft Data Protection Addendum is in place, and that GitHub holds only code, not data.

---

## 6. Open items and recommendations

1. ⚖️ **Legal review of the Privacy Notice and Terms.** In particular:
   - the Terms' limitation-of-liability and governing-law sections, and whether the Terms should be acknowledged in employee policy rather than at sign-in
   - the wording on supervisory use of activity records
   - the trademark lines
2. **Records retention.** Decide how long to keep RotationHistory, OperatingDays and EventLog records, for example 3 years for operations and 1 year for EventLog. Then add a scheduled clean-up, and update the Privacy Notice's "How long it is kept" section.
3. **Azure log retention.** Set and document how long App Service logs are kept, and limit who can read them.
4. **Incident response.** Make sure Goodwill's breach-response plan names this app and the FIPA timelines.
5. **Access reviews.** Review Admin Center accounts and levels quarterly, and remove leavers promptly. Admin accounts are separate from Entra, so they don't disappear automatically when someone leaves.
6. **Store device accounts.** These are shared logins by design. Keep them limited to their store, which is enforced, and make sure each device locks when idle.
7. **Kill-switch secret.** If the secret that was exposed in October hasn't been rotated yet, rotate it.
8. **Deferred from the October review:**
   - binding invitation links to the invited email address
   - limiting which addresses can be added as email recipients (for example, only `@goodwillcfl.org`)
9. **Annual re-check.** Re-run axe and `npm audit`, renew `security.txt`, and re-confirm that the policies still match the app.

No policy, disclaimer or technical safeguard guarantees freedom from legal claims. The aim is to reduce and manage risk responsibly.
