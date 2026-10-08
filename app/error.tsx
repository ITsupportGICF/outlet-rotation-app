"use client";

import ErrorPanel from "@/app/_components/ErrorPanel";

/**
 * Root error boundary. See ErrorPanel for what it shows and why it uses
 * retry() rather than reset().
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPanel error={error} retry={retry} />;
}
