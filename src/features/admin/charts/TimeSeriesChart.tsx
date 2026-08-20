"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHROME, SERIES_ORDER } from "@/features/admin/charts/palette";

export interface TimeSeriesPoint {
  /** `YYYY-MM-DD` in Bangkok. */
  date: string;
  [seriesKey: string]: string | number;
}

export interface SeriesSpec {
  /** Key into each point. */
  key: string;
  /** Legend / tooltip label. */
  label: string;
}

/**
 * Daily trend line, one line per series.
 *
 * Deliberately single-axis: two measures on different scales get two charts,
 * never a second y-axis. If you find yourself wanting one, index both series to
 * a common base instead.
 *
 * A legend is always rendered for two or more series so identity never rests on
 * colour alone; with one series the chart title names it and the legend is
 * dropped as redundant.
 */
export function TimeSeriesChart({
  data,
  series,
  height = 260,
  valueSuffix = "",
}: {
  data: TimeSeriesPoint[];
  series: SeriesSpec[];
  height?: number;
  valueSuffix?: string;
}) {
  const showLegend = series.length > 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={CHROME.grid} strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: CHROME.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: CHROME.axis }}
          minTickGap={28}
          tickFormatter={formatDayTick}
        />
        <YAxis
          tick={{ fill: CHROME.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={48}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: CHROME.secondary, fontSize: 11, marginBottom: 4 }}
          itemStyle={{ fontSize: 12 }}
          // Recharts 3 widens the formatter's parameter types, so narrow here
          // rather than annotating them and fighting the library's signature.
          formatter={(value, name) => [`${Number(value)}${valueSuffix}`, String(name)]}
        />
        {showLegend && (
          <Legend
            verticalAlign="top"
            align="left"
            height={28}
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: CHROME.secondary }}
          />
        )}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={SERIES_ORDER[i % SERIES_ORDER.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHROME.surface }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export const TOOLTIP_STYLE = {
  border: `1px solid ${CHROME.grid}`,
  borderRadius: 6,
  fontSize: 12,
  padding: "6px 10px",
  boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
} as const;

/** `2026-08-16` → `16 Aug`. Keeps the axis readable at 90-day ranges. */
function formatDayTick(value: string): string {
  const [, month, day] = value.split("-");
  if (!month || !day) return value;
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${Number(day)} ${monthNames[Number(month) - 1] ?? ""}`.trim();
}
