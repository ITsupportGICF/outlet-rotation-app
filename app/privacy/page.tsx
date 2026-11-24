import type { Metadata } from "next";

import LegalPage from "@/app/_components/LegalPage";
import {
  APP_NAME,
  CONTACT_EMAIL,
  COOKIES,
  LOCAL_STORAGE,
  ORG_NAME,
  SERVICE_PROVIDERS,
} from "@/lib/legal";

export const metadata: Metadata = { title: `Privacy Notice — ${APP_NAME}` };

/**
 * Privacy Notice. Every statement here must match what the code actually does
 * (see docs/compliance/COMPLIANCE.md → "Data inventory"). Public page.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Notice"
      intro={`This notice explains what information the ${APP_NAME} collects, why, how it is used and protected, how long it is kept, and who can see it. The app is operated by ${ORG_NAME} ("Goodwill", "we") for its own staff.`}
    >
      <h2>1. Who this applies to</h2>
      <p>
        The {APP_NAME} is an internal work tool. It is only available to Goodwill staff and
        authorized accounts who sign in with a Goodwill Microsoft 365 account. It is not offered to
        the public, and it is not directed to children under 13.
      </p>

      <h2>2. Information the app collects</h2>
      <h3>From Microsoft 365 sign-in</h3>
      <p>
        Your name, work email address, Microsoft account ID and organization ID and, if access is
        limited to certain groups, your group memberships. The app uses these to confirm you are
        allowed in and to show who is signed in. Your Microsoft password is entered on Microsoft&apos;s
        page and is never seen or stored by the app.
      </p>
      <h3>Records of work done in the app</h3>
      <ul>
        <li>Rotations, skips (overrides), manual rotations and undos: which store and section, the commodity quantities, the time, and the work email of the person who did it.</li>
        <li>Start Day and End Day: the time and the work email of the person who did it.</li>
        <li>Store settings changes and maintenance-mode changes: who made them and when.</li>
        <li>
          The Admin Event Log: Admin Center sign-ins and sign-outs, <strong>failed sign-in attempts
          (including the username typed)</strong>, changes to sections, mix, goals, settings, locations and
          user accounts, and undos, with the time and the name, username or work email of the person
          who did it.
        </li>
      </ul>
      <h3>Admin Center accounts</h3>
      <p>
        Display name, work email, username, permission level, account status, the number of recent
        failed sign-in attempts, any temporary lockout, and the last sign-in time. Passwords are stored
        only as a one-way scrypt hash, and account-setup invitation links only as a SHA-256 hash with
        an expiry date. Nobody, including IT, can read a stored password.
      </p>
      <h3>Email settings</h3>
      <p>The mailbox the app sends from, and the work email addresses that receive its reports and alerts.</p>
      <h3>Security logs</h3>
      <p>
        The hosting service keeps standard web server logs (for example, the time of a request, the
        page requested, browser type and IP address). The app also writes the IP address of anyone who
        tries the emergency shut-off code, and short error messages that help fix problems. These logs
        are used only for security and troubleshooting.
      </p>
      <h3>What the app does not collect</h3>
      <p>
        No Social Security numbers, financial or payment details, health information, precise
        location, photos or biometrics. The app has no advertising, no analytics or tracking scripts,
        no tracking pixels and no third-party cookies, and Goodwill does not sell or rent information
        from it.
      </p>

      <h2>3. Cookies and device storage</h2>
      <p>
        The app uses only the cookies it needs to work. They are all strictly necessary, encrypted
        and readable only by the app (HttpOnly, Secure, same-site), so there is nothing to opt in or out
        of and no cookie banner. Turning cookies off in your browser will stop sign-in from working.
      </p>
      <div className="legal-table-wrap">
        <table>
          <caption className="sr-only">Cookies and storage used by the app</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Purpose</th>
              <th scope="col">Kept for</th>
            </tr>
          </thead>
          <tbody>
            {COOKIES.map((c) => (
              <tr key={c.name}>
                <td><code>{c.name}</code></td>
                <td>Cookie (strictly necessary)</td>
                <td>{c.purpose}</td>
                <td>{c.lifetime}</td>
              </tr>
            ))}
            {LOCAL_STORAGE.map((c) => (
              <tr key={c.name}>
                <td><code>{c.name}</code></td>
                <td>Browser storage (your preference)</td>
                <td>{c.purpose}</td>
                <td>{c.lifetime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>4. How the information is used</h2>
      <ul>
        <li>To run the rotation process: deciding which section is next, recording rotations and tracking daily goals.</li>
        <li>To show the Live Dashboard, End-of-Day reports, the Insights page and the Admin Event Log.</li>
        <li>To send operational emails to the people set up to receive them (end-of-day reports, override, undo and configuration alerts, and account invitations). These are work notices, not marketing.</li>
        <li>To keep the app secure: controlling access by role, locking accounts after repeated failed sign-ins, keeping an audit trail and investigating problems.</li>
        <li>
          To manage store operations. Goodwill leadership and administrators can see who performed
          an action, and may use these records in the normal course of supervising work, consistent
          with Goodwill&apos;s employment policies.
        </li>
      </ul>

      <h2>5. Who can see it</h2>
      <ul>
        <li><strong>Signed-in staff</strong> can see the Live Dashboard, the Input Screen and Insights. These show store results, not names. Store device accounts see only their own store.</li>
        <li><strong>Admin Center users</strong> can see settings, rotation details and the Event Log, which shows names and email addresses. Managing admin accounts depends on permission level.</li>
        <li><strong>Email recipients</strong> chosen in the Admin Center receive the reports and alerts.</li>
        <li><strong>Service providers</strong> that run the app for Goodwill (below) process the information only to provide their service.</li>
        <li>Information may also be disclosed if required by law, or to protect people, property or the security of Goodwill&apos;s systems.</li>
      </ul>
      <h3>Service providers</h3>
      <ul>
        {SERVICE_PROVIDERS.map((s) => (
          <li key={s.name}>
            <strong>{s.name}</strong>: {s.use}
          </li>
        ))}
      </ul>
      <p>All app data is stored in Goodwill&apos;s own Microsoft 365 environment, which Goodwill already uses for email and files.</p>

      <h2>6. How long it is kept</h2>
      <ul>
        <li>Cookies: as listed in the table above.</li>
        <li>
          Rotation records, operating days, settings, admin accounts and the Event Log are kept in
          Goodwill&apos;s SharePoint site as business records, under Goodwill&apos;s records-retention
          practices. The app does not delete them automatically. Admin accounts can be removed by IT.
        </li>
        <li>Emails the app sends are kept in recipients&apos; mailboxes under Goodwill&apos;s email retention settings.</li>
        <li>Hosting logs are kept for the period set in Goodwill&apos;s Azure configuration.</li>
      </ul>

      <h2>7. How it is protected</h2>
      <ul>
        <li>All traffic is encrypted (HTTPS), and the site sends strict security headers.</li>
        <li>Sign-in uses Microsoft 365. The Admin Center adds its own username and password, with automatic lockout after repeated failures.</li>
        <li>Access is limited by role and by store, and every data request is checked on the server.</li>
        <li>Session cookies are encrypted and expire automatically. Passwords and invitation links are stored only as one-way hashes.</li>
        <li>Data stays in Goodwill&apos;s Microsoft 365 tenant, and the app&apos;s access is limited to its own SharePoint site.</li>
      </ul>
      <p>
        No system is perfectly secure. If Goodwill learns of a security incident affecting personal
        information, it will notify affected people and authorities as required by law.
      </p>

      <h2>8. Your choices</h2>
      <p>
        You can ask what information the app holds about you, ask for a correction, or ask about
        removal by emailing <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Some records,
        such as rotation history and the Event Log, may need to be kept as business or security
        records. If so, IT will explain why.
      </p>

      <h2>9. Changes to this notice</h2>
      <p>
        When this notice changes, the date at the top will be updated. Significant changes will be
        announced to staff who use the app.
      </p>

      <h2>10. Contact</h2>
      <p>
        {ORG_NAME} — IT Department
        <br />
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
