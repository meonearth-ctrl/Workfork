"use client";
// Staffing coverage for one day: planned people per hour (columns) against the
// forecast need (step line), on one axis. Hover any hour for exact values; a
// table view carries the same numbers for screen readers and print.
// Colours: validated categorical slots 1 (blue) and 2 (orange) on white.

import { useState } from "react";

const PLANNED = "#2a78d6";
const NEEDED = "#eb6834";
const GRID = "#e2e8f0";

interface Props {
  need: number[];      // 24 values
  planned: number[];   // 24 values
  fromHour: number;
  toHour: number;      // exclusive
  label: string;       // accessible name, e.g. "Coverage Tue 27 Oct"
}

export function CoverageChart({ need, planned, fromHour, toHour, label }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const hours = Array.from({ length: Math.max(1, toHour - fromHour) }, (_, i) => fromHour + i);
  const max = Math.max(1, ...hours.map((h) => Math.max(need[h], planned[h])));
  const top = Math.ceil(max);
  const ticks = Array.from(new Set([0, Math.round(top / 2), top]));

  const W = 640, H = 200, padL = 28, padR = 8, padT = 10, padB = 22;
  const band = (W - padL - padR) / hours.length;
  const barW = Math.min(24, band - 2);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const x = (i: number) => padL + i * band;

  // Need as a step line across each hour's band.
  const step = hours.map((h, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(need[h])} L${x(i + 1)},${y(need[h])}`).join(" ");

  // Column with a 4px rounded data end, square at the baseline.
  const column = (cx: number, v: number) => {
    const h = y(0) - y(v);
    if (h <= 0) return "";
    const r = Math.min(4, h, barW / 2);
    const left = cx - barW / 2, right = cx + barW / 2, top = y(v), base = y(0);
    return `M${left},${base} L${left},${top + r} Q${left},${top} ${left + r},${top} L${right - r},${top} Q${right},${top} ${right},${top + r} L${right},${base} Z`;
  };

  const hovered = hover !== null ? hours[hover] : null;
  const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

  return (
    <figure className="relative">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PLANNED }} />Planned staff</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: NEEDED }} />Staff needed (forecast)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#64748b">{t}</text>
          </g>
        ))}
        {hours.map((h, i) => (
          <path key={h} d={column(x(i) + band / 2, planned[h])} fill={PLANNED} opacity={hover === null || hover === i ? 1 : 0.55} />
        ))}
        <path d={step} fill="none" stroke={NEEDED} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hours.map((h, i) => (i % 2 === 0 || hours.length <= 12) && (
          <text key={h} x={x(i) + band / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#64748b">{String(h).padStart(2, "0")}</text>
        ))}
        {/* Hit targets: the whole hour band, larger than the mark. */}
        {hours.map((h, i) => (
          <rect key={h} x={x(i)} y={padT} width={band} height={H - padT - padB} fill="transparent"
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
        ))}
        {hover !== null && <line x1={x(hover) + band / 2} x2={x(hover) + band / 2} y1={padT} y2={y(0)} stroke="#94a3b8" strokeWidth={1} pointerEvents="none" />}
      </svg>
      {hovered !== null && (
        <div className="pointer-events-none absolute top-6 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `min(calc(${((x(hover!) + band / 2) / W) * 100}% + 8px), calc(100% - 140px))` }}>
          <div className="font-medium text-slate-900">{String(hovered).padStart(2, "0")}:00–{String(hovered + 1).padStart(2, "0")}:00</div>
          <div className="text-slate-600">Planned: {fmt(planned[hovered])}</div>
          <div className="text-slate-600">Needed: {fmt(need[hovered])}</div>
          <div className={planned[hovered] < need[hovered] ? "font-medium text-rose-700" : "text-slate-600"}>
            {planned[hovered] < need[hovered] ? `▼ Short ${fmt(need[hovered] - planned[hovered])}` : "✓ Covered"}
          </div>
        </div>
      )}
      <details className="mt-1 text-xs text-slate-600">
        <summary className="cursor-pointer select-none">Table view</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead><tr className="text-slate-500"><th className="py-0.5">Hour</th><th>Planned</th><th>Needed</th><th>Gap</th></tr></thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h} className="border-t border-slate-100">
                <td className="py-0.5">{String(h).padStart(2, "0")}:00</td><td>{fmt(planned[h])}</td><td>{fmt(need[h])}</td>
                <td>{fmt(planned[h] - need[h])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
