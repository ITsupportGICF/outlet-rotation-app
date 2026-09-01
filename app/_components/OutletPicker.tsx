import Link from "next/link";

export type OutletOption = { id: string; name: string };

/**
 * Shown when an area (Input Screen / Live Dashboard) is opened without a
 * specific outlet. Store devices bookmark the per-outlet URL, but this makes
 * the pages safe to reach directly and self-explanatory for a new device.
 */
export default function OutletPicker({
  outlets,
  basePath,
  title,
  subtitle,
}: {
  outlets: OutletOption[];
  basePath: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mx-auto max-w-lg">
      <h2 className="page-title mb-2 text-2xl font-semibold">{title}</h2>
      <p className="page-sub mb-7 text-base">{subtitle}</p>

      {outlets.length === 0 ? (
        <div className="glass glass-gold p-6 text-base" style={{ color: "rgba(226,235,245,0.72)" }}>
          No active outlets are configured yet. Add one in the Admin Center.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {outlets.map((outlet) => (
            <Link
              key={outlet.id}
              href={`${basePath}?outletId=${encodeURIComponent(outlet.id)}`}
              className="glass glass-gold glass-hover gloss relative flex items-center justify-between overflow-hidden p-6"
            >
              <span className="text-xl font-semibold" style={{ color: "#ffffff" }}>
                {outlet.name}
              </span>
              <span
                className="btn btn-gold btn-sm"
                aria-hidden="true"
              >
                Open →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
