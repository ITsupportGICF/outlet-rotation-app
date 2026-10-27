"use client";

/**
 * Date-range controls for the Insights filter bar. Picking a date switches
 * the preset to "Custom range" automatically, so an edited date is never
 * silently ignored because a preset was still selected.
 */
import { useState } from "react";

import { RANGE_PRESETS, type RangePreset } from "@/lib/insights/range";

export default function RangeFields({
  preset,
  from,
  to,
  max,
}: {
  preset: RangePreset;
  from: string;
  to: string;
  max: string;
}) {
  const [value, setValue] = useState<RangePreset>(preset);
  return (
    <>
      <label className="block min-w-[10rem] flex-1">
        <span className="field-label">Date range</span>
        <select
          name="range"
          value={value}
          onChange={(e) => setValue(e.target.value as RangePreset)}
          className="field-input"
        >
          {RANGE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-[9rem] flex-1 sm:flex-none">
        <span className="field-label">From</span>
        <input
          type="date"
          name="from"
          defaultValue={from}
          max={max}
          onChange={() => setValue("custom")}
          className="field-input"
        />
      </label>
      <label className="block min-w-[9rem] flex-1 sm:flex-none">
        <span className="field-label">To</span>
        <input
          type="date"
          name="to"
          defaultValue={to}
          max={max}
          onChange={() => setValue("custom")}
          className="field-input"
        />
      </label>
    </>
  );
}
