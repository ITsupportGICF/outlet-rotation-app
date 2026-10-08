"use client";

import ErrorPanel from "@/app/_components/ErrorPanel";

/**
 * Admin Center error boundary. Without it, one failed SharePoint call in any
 * admin tab replaced the whole Admin Center with the root error page. Now
 * only the admin content shows the error, and "Try again" re-fetches it.
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPanel error={error} retry={retry} />;
}
