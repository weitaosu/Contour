"use client";

import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { COLORS } from "./common";
import { useSize } from "./useSize";

/** Smooth market curve for market cards; the line turns violet when the card is hovered. */
export function Sparkline({ values, height = 56 }: { values: number[]; height?: number }) {
  const { ref, width } = useSize<HTMLDivElement>();
  const n = values.length;
  const w = width || 240;
  const x = scaleLinear().domain([0, n - 1]).range([2, w - 2]);
  const y = scaleLinear().domain([0, Math.max(...values) * 1.1 || 1]).range([height - 1, 4]);
  const pts = values.map((v, j) => [x(j), y(v)] as [number, number]);
  const a = area<[number, number]>().x((d) => d[0]).y0(height).y1((d) => d[1]).curve(curveMonotoneX)(pts) ?? "";
  const l = line<[number, number]>().x((d) => d[0]).y((d) => d[1]).curve(curveMonotoneX)(pts) ?? "";
  return (
    <div ref={ref} className="w-full" style={{ height }} aria-hidden="true">
      {width > 0 && (
        <svg width={w} height={height} className="overflow-visible">
          <path d={a} fill={COLORS.mist} className="ease group-hover:fill-signal-violet/15" />
          <path d={l} fill="none" stroke={COLORS.smoke} strokeWidth={1.5} className="ease group-hover:stroke-signal-violet" />
        </svg>
      )}
    </div>
  );
}
