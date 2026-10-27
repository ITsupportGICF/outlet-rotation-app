"use client";

/**
 * Small line / column chart for the Insights page.
 *  - Lines: 2px, gaps where a week has no completed days (never drawn as 0).
 *  - Columns: ≤ 24px, rounded top, from a single baseline.
 *  - Hover or keyboard focus shows one tooltip listing every series at that week.
 *  - A legend whenever there are 2+ series; a "View as table" toggle always,
 *    so no value depends on hovering or on colour.
 */
import { useId, useMemo, useState } from "react";

export type ChartSeries = { name: string; color: string; values: (number | null)[] };

type Unit = "count" | "percent" | "minutes";

function formatValue(v: number | null, unit: Unit, decimals: number): string {
  if (v == null) return "—";
  if (unit === "percent") return `${Math.round(v * 100)}%`;
  if (unit === "minutes") {
    const m = Math.round(v);
    if (m < 60) return `${m}m`;
    return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  }
  return v.toFixed(decimals);
}

function niceMax(max: number, unit: Unit, kind: "line" | "column"): number {
  if (unit === "percent") return 1;
  // Whole-number counts (e.g. missing days) get whole-number ticks: 0,1,2,3,4…
  if (unit === "count" && kind === "column") return Math.max(4, Math.ceil(max / 4) * 4);
  // Minutes get tick steps that are whole hours / half hours.
  if (unit === "minutes") {
    for (const step of [15, 30, 60, 120, 180, 240, 360, 480, 720]) {
      if (step * 4 >= max) return step * 4;
    }
    return Math.ceil(max / 240) * 240;
  }
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * pow >= max) return step * pow;
  }
  return 10 * pow;
}

const W = 640;
const H = 220;
const PAD = { l: 58, r: 14, t: 12, b: 28 };

export default function TrendChart({
  title,
  note,
  labels,
  series,
  unit,
  kind = "line",
  decimals = 0,
}: {
  title: string;
  note?: string;
  labels: string[];
  series: ChartSeries[];
  unit: Unit;
  kind?: "line" | "column";
  decimals?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();

  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const yMax = niceMax(all.length ? Math.max(...all) : 0, unit, kind);
  const n = labels.length;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const bandW = n > 0 ? plotW / n : plotW;
  const xBand = (i: number) => PAD.l + bandW * i + bandW / 2;
  const y = (v: number) => PAD.t + plotH - (v / yMax) * plotH;
  const xAt = kind === "column" ? xBand : x;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  // Show every Nth week, plus the last one — unless it would crowd the one before.
  const showLabel = (i: number) =>
    i === n - 1 || (i % labelEvery === 0 && n - 1 - i >= Math.max(1, labelEvery * 0.6));

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = "";
        let pen = false;
        s.values.forEach((v, i) => {
          if (v == null) {
            pen = false;
            return;
          }
          d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
          pen = true;
        });
        return d;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, yMax, n],
  );

  const hasData = all.length > 0;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = Math.abs(xAt(i) - px);
      if (dx < dist) {
        dist = dx;
        best = i;
      }
    }
    setHover(best);
  };

  const colW = Math.min(24, Math.max(4, (bandW - 4) / Math.max(1, series.length)));

  return (
    <figure className="glass p-4 sm:p-5" style={{ margin: 0 }}>
      <figcaption className="mb-2">
        <span className="text-base font-semibold" style={{ color: "#ffffff" }}>
          {title}
        </span>
        {note && (
          <span className="mt-0.5 block text-xs" style={{ color: "rgba(226,235,245,0.55)" }}>
            {note}
          </span>
        )}
      </figcaption>

      {series.length >= 2 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "rgba(226,235,245,0.80)" }}>
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              {kind === "line" ? (
                <svg width="16" height="8" aria-hidden="true">
                  <line x1="0" y1="4" x2="16" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="10" height="10" aria-hidden="true">
                  <rect width="10" height="10" rx="2" fill={s.color} />
                </svg>
              )}
              {s.name}
            </span>
          ))}
        </div>
      )}

      {!hasData ? (
        <p className="py-10 text-center text-sm" style={{ color: "rgba(226,235,245,0.55)" }}>
          No completed days in this period.
        </p>
      ) : (
        <div style={{ position: "relative" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label={`${title}. Values are listed in the table below the chart.`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            tabIndex={0}
            onFocus={() => setHover(n - 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
              if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
            }}
            style={{ display: "block", touchAction: "pan-y", outline: "none" }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)"} strokeWidth="1" />
                <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="rgba(226,235,245,0.55)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatValue(t, unit, unit === "count" && kind === "line" && yMax < 5 ? 1 : 0)}
                </text>
              </g>
            ))}

            {labels.map((l, i) =>
              showLabel(i) ? (
                <text
                  key={`${l}-${i}`}
                  x={xAt(i)}
                  y={H - 8}
                  textAnchor={kind === "line" && i === n - 1 && n > 1 ? "end" : kind === "line" && i === 0 && n > 1 ? "start" : "middle"}
                  fontSize="11"
                  fill="rgba(226,235,245,0.55)"
                >
                  {l}
                </text>
              ) : null,
            )}

            {hover != null && kind === "line" && (
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
            )}
            {hover != null && kind === "column" && (
              <rect x={PAD.l + bandW * hover} y={PAD.t} width={bandW} height={plotH} fill="rgba(255,255,255,0.05)" />
            )}

            {kind === "line" &&
              series.map((s, si) => (
                <g key={s.name}>
                  <path d={paths[si]} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {/* Isolated points (a week between two empty weeks) still need a mark. */}
                  {s.values.map((v, i) =>
                    v != null && (s.values[i - 1] == null && s.values[i + 1] == null) ? (
                      <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={s.color} />
                    ) : null,
                  )}
                  {hover != null && s.values[hover] != null && (
                    <circle cx={x(hover)} cy={y(s.values[hover]!)} r="4.5" fill={s.color} stroke="#0d2138" strokeWidth="2" />
                  )}
                </g>
              ))}

            {kind === "column" &&
              labels.map((_, i) =>
                series.map((s, si) => {
                  const v = s.values[i];
                  if (v == null || v <= 0) return null;
                  const h = (v / yMax) * plotH;
                  const left = xBand(i) - (colW * series.length + 2 * (series.length - 1)) / 2 + si * (colW + 2);
                  const r = Math.min(4, colW / 2, h);
                  const top = PAD.t + plotH - h;
                  return (
                    <path
                      key={`${i}-${s.name}`}
                      d={`M${left},${PAD.t + plotH}V${top + r}Q${left},${top} ${left + r},${top}H${left + colW - r}Q${left + colW},${top} ${left + colW},${top + r}V${PAD.t + plotH}Z`}
                      fill={s.color}
                    />
                  );
                }),
              )}
          </svg>

          {hover != null && (
            <div
              role="status"
              className="pointer-events-none"
              style={{
                position: "absolute",
                top: 4,
                left: `${(xAt(hover) / W) * 100}%`,
                transform: xAt(hover) > W * 0.6 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
                background: "rgba(8,21,37,0.96)",
                border: "1px solid rgba(245,196,81,0.35)",
                borderRadius: 10,
                padding: "8px 10px",
                minWidth: 140,
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                fontSize: 12,
                zIndex: 5,
              }}
            >
              <div style={{ color: "rgba(226,235,245,0.6)", marginBottom: 4 }}>Week of {labels[hover]}</div>
              {series.map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5" style={{ color: "rgba(226,235,245,0.75)" }}>
                    <svg width="12" height="6" aria-hidden="true">
                      <line x1="0" y1="3" x2="12" y2="3" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    {s.name}
                  </span>
                  <strong style={{ color: "#ffffff", fontVariantNumeric: "tabular-nums" }}>
                    {formatValue(s.values[hover], unit, decimals)}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-xs" style={{ color: "rgba(226,235,245,0.55)" }} aria-controls={tableId}>
          View as table
        </summary>
        <div id={tableId} style={{ overflowX: "auto" }}>
          <table className="mt-2 w-full text-xs" style={{ borderCollapse: "collapse", color: "rgba(226,235,245,0.85)" }}>
            <thead>
              <tr>
                <th className="py-1 pr-3 text-left font-semibold">Week of</th>
                {series.map((s) => (
                  <th key={s.name} className="py-1 pr-3 text-right font-semibold">{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={`${l}-${i}`} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <td className="py-1 pr-3">{l}</td>
                  {series.map((s) => (
                    <td key={s.name} className="py-1 pr-3 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatValue(s.values[i], unit, decimals)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
