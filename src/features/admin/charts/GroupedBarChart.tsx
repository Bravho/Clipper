"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHROME, SERIES_ORDER } from "@/features/admin/charts/palette";
import { TOOLTIP_STYLE } from "@/features/admin/charts/TimeSeriesChart";
import type { SeriesSpec } from "@/features/admin/charts/TimeSeriesChart";
import { formatChartValue } from "@/features/admin/formatDuration";
import type { ValueFormat } from "@/features/admin/formatDuration";

export interface CategoryRow {
  /** Category label shown on the axis. */
  category: string;
  [seriesKey: string]: string | number;
}

/**
 * Horizontal grouped bars — one group per category, one bar per series.
 *
 * Horizontal because the categories here are step names (`montage_scene_segment`,
 * `ffmpeg_composition`), which are far too long to sit under vertical bars
 * without rotating the labels.
 *
 * Bars carry a 2px surface gap (`barGap`) so adjacent fills never touch, and
 * radius is applied only to the data end so the bar stays anchored to the
 * baseline.
 *
 * Note `valueFormat` is a STRING, not a formatter function. Every admin page
 * that uses this chart is a server component, and React refuses to serialise a
 * function across the server/client boundary ("Functions cannot be passed
 * directly to Client Components") — which fails at request time, not at build
 * time, so it shows up as a blank page with a digest rather than a type error.
 * Naming the format and resolving it here is what keeps that from happening.
 */
export function GroupedBarChart({
  data,
  series,
  height,
  valueSuffix = "",
  valueFormat,
}: {
  data: CategoryRow[];
  series: SeriesSpec[];
  height?: number;
  valueSuffix?: string;
  valueFormat?: ValueFormat;
}) {
  const showLegend = series.length > 1;
  // Give each category enough room that the label never collides with its neighbour.
  const computedHeight = height ?? Math.max(200, data.length * 34 + (showLegend ? 48 : 24));

  return (
    <ResponsiveContainer width="100%" height={computedHeight}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
        barGap={2}
      >
        <CartesianGrid stroke={CHROME.grid} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: CHROME.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: CHROME.axis }}
          tickFormatter={(v: number) =>
            valueFormat ? formatChartValue(v, valueFormat) : String(v)
          }
        />
        <YAxis
          type="category"
          dataKey="category"
          tick={{ fill: CHROME.secondary, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={160}
        />
        <Tooltip
          cursor={{ fill: "rgba(15,23,42,0.04)" }}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: CHROME.secondary, fontSize: 11, marginBottom: 4 }}
          itemStyle={{ fontSize: 12 }}
          // Recharts 3 widens the formatter's parameter types, so narrow here
          // rather than annotating them and fighting the library's signature.
          formatter={(value, name) => [
            valueFormat
              ? formatChartValue(Number(value), valueFormat)
              : `${Number(value)}${valueSuffix}`,
            String(name),
          ]}
        />
        {showLegend && (
          <Legend
            verticalAlign="top"
            align="left"
            height={28}
            wrapperStyle={{ fontSize: 12, color: CHROME.secondary }}
          />
        )}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={SERIES_ORDER[i % SERIES_ORDER.length]}
            radius={[0, 4, 4, 0]}
            maxBarSize={14}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
