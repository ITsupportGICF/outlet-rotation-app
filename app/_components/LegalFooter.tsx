import Link from "next/link";

import ContrastToggle from "@/app/_components/ContrastToggle";
import { ORG_NAME } from "@/lib/legal";

/**
 * Small grey links to the legal pages + the High contrast switch. Shown at the
 * bottom of the landing, sign-in and signed-out screens, and on every legal page.
 */
export default function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <nav
      aria-label="Legal and accessibility"
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs ${className}`}
    >
      <span className="legal-text">© {new Date().getFullYear()} {ORG_NAME}</span>
      <span aria-hidden="true" className="legal-text">·</span>
      <Link href="/privacy" className="legal-link">Privacy Notice</Link>
      <span aria-hidden="true" className="legal-text">·</span>
      <Link href="/terms" className="legal-link">Terms of Use</Link>
      <span aria-hidden="true" className="legal-text">·</span>
      <Link href="/accessibility" className="legal-link">Accessibility</Link>
      <span aria-hidden="true" className="legal-text">·</span>
      <Link href="/licenses" className="legal-link">Licenses</Link>
      <span aria-hidden="true" className="legal-text">·</span>
      <ContrastToggle />
    </nav>
  );
}
