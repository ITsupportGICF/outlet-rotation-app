import Link from "next/link";

/**
 * Shown on every page to IT while maintenance mode is on, so it can never be
 * left switched on by accident — whoever closed the app sees it everywhere
 * they go, with a direct link to the control.
 */
export default function MaintenanceBanner({ timeLabel }: { timeLabel: string }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-2 text-center text-sm font-semibold"
      style={{ background: "#fff6e0", color: "#7a5c05", borderBottom: "1px solid #f0d78a" }}
    >
      <span>Maintenance mode is ON — only IT can use the app</span>
      <span aria-hidden="true">·</span>
      <span style={{ fontWeight: 500 }}>expected back {timeLabel}</span>
      <Link href="/admin?tab=maintenance" style={{ color: "#8a6d0b", textDecoration: "underline" }}>
        Manage →
      </Link>
    </div>
  );
}
