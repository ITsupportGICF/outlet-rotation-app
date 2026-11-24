import type { Metadata } from "next";
import Link from "next/link";

import LegalPage from "@/app/_components/LegalPage";
import { APP_NAME, CONTACT_EMAIL, ORG_NAME } from "@/lib/legal";

export const metadata: Metadata = { title: `Terms of Use — ${APP_NAME}` };

/** Terms of Use for an internal staff tool. Public page. */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro={`These terms apply to everyone who uses the ${APP_NAME}, which is provided by ${ORG_NAME} ("Goodwill"). By signing in, you agree to them. They add to, and do not replace, Goodwill's employment, IT and acceptable-use policies. If they ever conflict, Goodwill's policies apply.`}
    >
      <h2>1. Who may use the app</h2>
      <p>
        The app is for Goodwill staff and accounts that Goodwill has authorized, for Goodwill
        business only. Store device accounts may be used only on that store&apos;s devices, by staff
        working there. Access can be changed or removed at any time.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>Keep your Microsoft 365 and Admin Center passwords private. Do not share them or let others use your account.</li>
        <li>Sign out of the Admin Center when you finish, especially on shared devices.</li>
        <li>Report a lost device, a suspected compromised account, or anything that looks wrong to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> right away.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Enter false or misleading rotation, quantity or day records, or record work you did not do.</li>
        <li>Try to get around sign-in, permissions, store restrictions, lockouts or other security controls, or access data you are not authorized to see.</li>
        <li>Probe, scan, overload or disrupt the app or the systems it connects to, or upload harmful code.</li>
        <li>Copy, export or share app data outside Goodwill, except as your job requires and Goodwill policy allows.</li>
        <li>Use the emergency shut-off or maintenance controls unless you are authorized to.</li>
      </ul>

      <h2>4. Records and monitoring</h2>
      <p>
        The app records who does what and when (see the <Link href="/privacy">Privacy Notice</Link>).
        These records belong to Goodwill and may be reviewed by authorized staff for operations,
        security and compliance. Use of Goodwill systems is subject to Goodwill&apos;s monitoring
        policies.
      </p>

      <h2>5. Ownership</h2>
      <p>
        The app, its design and the data in it are the property of Goodwill, or are used by Goodwill
        under license. Open-source components are used under their own licenses (see{" "}
        <Link href="/licenses">Licenses</Link>). &ldquo;Goodwill&rdquo; and related names and logos are
        trademarks of Goodwill Industries International, Inc. Microsoft and Microsoft 365 are trademarks
        of Microsoft Corporation.
      </p>

      <h2>6. Availability</h2>
      <p>
        Goodwill aims to keep the app available but does not guarantee it will be uninterrupted or
        error-free. It may be paused for maintenance, updates or security reasons. If figures look
        wrong, check them before relying on them, and report the problem to IT.
      </p>

      <h2>7. Disclaimer and limitation of liability</h2>
      <p>
        The app is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; for Goodwill&apos;s internal
        operations, without warranties of any kind, to the extent the law allows. To the extent the law
        allows, Goodwill is not liable for indirect, incidental or consequential losses arising from use
        of the app, or from being unable to use it. Nothing in these terms limits any right that cannot
        be limited by law, or changes your rights as an employee.
      </p>

      <h2>8. Ending access</h2>
      <p>
        Goodwill may suspend or end access, for example when your role changes, when you leave
        Goodwill, or if these terms or Goodwill&apos;s policies are not followed.
      </p>

      <h2>9. Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Florida and applicable U.S. federal law.
        Questions or concerns should be raised first through Goodwill&apos;s normal internal channels.
      </p>

      <h2>10. Changes</h2>
      <p>
        Goodwill may update these terms. The date at the top will change, and continuing to use the app
        after an update means you accept the new terms.
      </p>

      <h2>11. Contact</h2>
      <p>
        {ORG_NAME} — IT Department
        <br />
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
