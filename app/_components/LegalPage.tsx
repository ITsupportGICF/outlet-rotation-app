import Link from "next/link";

import Ambient from "@/app/_components/Ambient";
import LegalFooter from "@/app/_components/LegalFooter";
import { APP_NAME, LEGAL_EFFECTIVE_DATE } from "@/lib/legal";

/**
 * Shared shell for the legal pages: readable width, real headings, and the
 * same dark theme as the rest of the app. Public — no sign-in needed, so the
 * notices can be read before signing in.
 */
export default function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative min-h-screen">
      <Ambient />
      <div className="mx-auto max-w-3xl px-6 py-10 sm:px-10">
        <Link href="/" className="legal-link text-sm">
          ← {APP_NAME}
        </Link>
        <article className="legal-doc glass glass-gold mt-4 p-6 sm:p-10">
          <h1 className="page-title text-3xl font-bold">{title}</h1>
          <p className="legal-meta mt-2 text-sm">Effective {LEGAL_EFFECTIVE_DATE}</p>
          {intro && <p className="mt-5 text-base">{intro}</p>}
          {children}
        </article>
        <LegalFooter className="mt-8" />
      </div>
    </main>
  );
}
