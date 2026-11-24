import type { Metadata } from "next";

import LegalPage from "@/app/_components/LegalPage";
import { APP_NAME, ORG_NAME } from "@/lib/legal";
import { THIRD_PARTY_PACKAGES } from "@/lib/third-party-licenses";

export const metadata: Metadata = { title: `Licenses — ${APP_NAME}` };

/**
 * Third-party notices. The package list is generated from package-lock.json
 * (lib/third-party-licenses.ts). Public page.
 */
export default function LicensesPage() {
  const groups = new Map<string, typeof THIRD_PARTY_PACKAGES>();
  for (const p of THIRD_PARTY_PACKAGES) {
    groups.set(p.license, [...(groups.get(p.license) ?? []), p]);
  }
  const licenses = [...groups.keys()].sort();

  return (
    <LegalPage
      title="Licenses and Notices"
      intro={`The ${APP_NAME} is © ${new Date().getFullYear()} ${ORG_NAME}. It is built with the open-source software listed below, each used under its own license. Copyright in each component belongs to its authors.`}
    >
      <h2>Fonts, icons and images</h2>
      <ul>
        <li>The app ships no font files. Text uses the fonts already on your device (such as Segoe UI, Aptos or Georgia).</li>
        <li>Icons are standard Unicode characters drawn by your device&apos;s fonts. Charts are drawn by the app.</li>
        <li>The four-square Microsoft logo on the sign-in button is a trademark of Microsoft Corporation, used to identify Microsoft 365 sign-in.</li>
        <li>&ldquo;Goodwill&rdquo; and related names are trademarks of Goodwill Industries International, Inc.</li>
      </ul>

      <h2>Notices that need specific wording</h2>
      <ul>
        <li>
          <strong>libvips</strong> (installed with the image tools that come with Next.js, under
          the <code>@img/sharp-libvips-*</code> packages) is licensed under the GNU Lesser General
          Public License v3.0 or later. It is used unmodified as a separate library. Its source code
          is available at <a href="https://github.com/lovell/sharp-libvips">github.com/lovell/sharp-libvips</a>.
        </li>
        <li>
          <strong>caniuse-lite</strong> browser-support data is licensed under Creative Commons
          Attribution 4.0 (CC BY 4.0), from the Can I Use project by Alexis Deveria
          (<a href="https://caniuse.com">caniuse.com</a>).
        </li>
      </ul>

      <h2>Open-source components</h2>
      <p>
        The full license text for each package is included in its folder in the deployed app
        (<code>node_modules/&lt;package&gt;/LICENSE</code>) and at the link given.
      </p>
      {licenses.map((lic) => (
        <section key={lic}>
          <h3>
            {lic} ({groups.get(lic)!.length})
          </h3>
          <ul className="legal-columns">
            {groups.get(lic)!.map((p) => (
              <li key={`${p.name}@${p.version}`}>
                <a href={p.url}>{p.name}</a> {p.version}
                {p.optional ? " (platform-specific, optional)" : ""}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </LegalPage>
  );
}
