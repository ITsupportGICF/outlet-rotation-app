import type { Metadata } from "next";

import LegalPage from "@/app/_components/LegalPage";
import { APP_NAME, CONTACT_EMAIL, LEGAL_EFFECTIVE_DATE, ORG_NAME } from "@/lib/legal";

export const metadata: Metadata = { title: `Accessibility — ${APP_NAME}` };

/** Accessibility statement. Public page. */
export default function AccessibilityPage() {
  return (
    <LegalPage
      title="Accessibility Statement"
      intro={`${ORG_NAME} wants every team member to be able to use the ${APP_NAME}. Our target is the Web Content Accessibility Guidelines (WCAG) 2.2, Level AA.`}
    >
      <h2>What the app does to help</h2>
      <ul>
        <li>Everything can be used with a keyboard. A &ldquo;Skip to main content&rdquo; link appears at the top of each page when you press Tab, and the item you&apos;re on is clearly outlined.</li>
        <li>Pages use proper headings, labelled form fields, and alerts that screen readers announce.</li>
        <li><strong>High contrast</strong> (in the footer of the sign-in screen and the Home page) turns grey text white and strengthens borders. Your choice is remembered on that device.</li>
        <li>Animations are turned off when your device is set to &ldquo;reduce motion&rdquo;.</li>
        <li>Every chart on the Insights page has a &ldquo;View as table&rdquo; option, and status colours always come with words or symbols, so nothing depends on colour alone.</li>
        <li>Pages adapt to phones, tablets and screen zoom up to 400% without losing content.</li>
        <li>Before you can permanently delete something or undo a rotation, you are asked to confirm.</li>
      </ul>

      <h2>Known limitations</h2>
      <ul>
        <li>The Live Dashboard is built to be read from a distance on store TVs. It refreshes itself and is not designed for interaction, and the same information is available on the Input Screen and in the Admin Center.</li>
        <li>The Microsoft 365 sign-in page is provided by Microsoft and follows Microsoft&apos;s accessibility standards.</li>
        <li>Some email clients may not show the app&apos;s emails exactly as designed. The same information is available in the app.</li>
      </ul>

      <h2>Need help or an accommodation?</h2>
      <p>
        If anything in the app is hard to use with your device, assistive technology or way of
        working, please tell us. We will help you get what you need and fix the problem. Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and include the page and what
        happened. You can also ask your manager or Human Resources about workplace accommodations.
      </p>

      <h2>How we check</h2>
      <p>
        The app was last reviewed on {LEGAL_EFFECTIVE_DATE}. The review used automated testing (axe)
        and manual checks of keyboard use, focus order, headings, labels, colour contrast, zoom and
        reduced motion. New features are checked the same way before release.
      </p>
    </LegalPage>
  );
}
