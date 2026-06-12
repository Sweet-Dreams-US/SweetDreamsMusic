'use client';

import { useState, useRef, useCallback } from 'react';

// ============================================================
// MetricsChart — Pure SVG line chart with hover tooltips
// No external dependencies. Matches site monospace/minimal style.
// ============================================================

export interface DataPoint {
  date: string;
  value: number;
}

export interface ChartSeries {
  label: string;
  data: DataPoint[];
  color: string;
}

interface MetricsChartProps {
  series: ChartSeries[];
  height?: number;
  showGrid?: boolean;
  showDots?: boolean;
  showArea?: boolean;
  className?: string;
}

interface SparklineProps {
  data: number[];
  color: string;
  width?: number;
  height?: number;
  className?: string;
}

// ---- Helpers ----

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateFull(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---- Main Chart ----

export default function MetricsChart({
  series,
  height = 200,
  showGrid = true,
  showDots = true,
  showArea = true,
  className = '',
}: MetricsChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    date: string;
    values: { label: string; value: number; color: string }[];
  } | null>(null);

  // Chart dimensions
  const w = 600;
  const h = height;
  const padL = 55;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  // Collect all dates across all series
  const allDates = Array.from(
    new Set(series.flatMap((s) => s.data.map((d) => d.date)))
  ).sort();

  if (allDates.length < 2) {
    return (
      <div className={`flex items-center justify-center h-32 ${className}`}>
        <p className="font-mono text-xs text-black/30 uppercase tracking-wider">
          Not enough data points
        </p>
      </div>
    );
  }

  // Global min/max across all series
  const allValues = series.flatMap((s) => s.data.map((d) => d.value));
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const padding = (rawMax - rawMin) * 0.1 || 1;
  const yMin = Math.max(0, rawMin - padding);
  const yMax = rawMax + padding;
  const yRange = yMax - yMin || 1;

  // Map date -> x position
  function dateToX(date: string): number {
    const idx = allDates.indexOf(date);
    return padL + (idx / (allDates.length - 1)) * chartW;
  }

  function valueToY(val: number): number {
    return padT + chartH - ((val - yMin) / yRange) * chartH;
  }

  // Build polyline points per series
  const seriesLines = series.map((s) => {
    const sorted = [...s.data].sort((a, b) => a.date.localeCompare(b.date));
    const points = sorted.map((d) => `${dateToX(d.date)},${valueToY(d.value)}`).join(' ');
    const areaPoints = `${dateToX(sorted[0].date)},${padT + chartH} ${points} ${dateToX(sorted[sorted.length - 1].date)},${padT + chartH}`;
    return { ...s, sorted, points, areaPoints };
  });

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    y: padT + chartH * (1 - pct),
    label: formatNumber(yMin + yRange * pct),
  }));

  // X-axis labels (show 5 evenly spaced)
  const xLabelCount = Math.min(5, allDates.length);
  const xLabels: { x: number; label: string }[] = [];
  for (let i = 0; i < xLabelCount; i++) {
    const idx = Math.round((i / (xLabelCount - 1)) * (allDates.length - 1));
    xLabels.push({ x: dateToX(allDates[idx]), label: formatDate(allDates[idx]) });
  }

  // Handle mouse interaction for tooltips
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const svgX = ((e.clientX - rect.left) / rect.width) * w;
      const svgY = ((e.clientY - rect.top) / rect.height) * h;

      // Find closest date index
      const relX = (svgX - padL) / chartW;
      const dateIdx = Math.round(relX * (allDates.length - 1));
      if (dateIdx < 0 || dateIdx >= allDates.length) {
        setTooltip(null);
        return;
      }
      const date = allDates[dateIdx];

      const values = series
        .map((s) => {
          const point = s.data.find((d) => d.date === date);
          return point ? { label: s.label, value: point.value, color: s.color } : null;
        })
        .filter(Boolean) as { label: string; value: number; color: string }[];

      if (values.length === 0) {
        setTooltip(null);
        return;
      }

      setTooltip({ x: dateToX(date), y: svgY, date, values });
    },
    [series, allDates, w, h, padL, chartW]
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  return (
    <div className={`relative ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="w-full transition-all duration-300"
        style={{ height: `${height}px` }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Grid lines */}
        {showGrid &&
          yTicks.map((tick, i) => (
            <g key={`y-${i}`}>
              <line
                x1={padL}
                y1={tick.y}
                x2={w - padR}
                y2={tick.y}
                stroke="rgba(0,0,0,0.06)"
                strokeWidth="0.5"
                strokeDasharray="4 3"
              />
              <text
                x={padL - 8}
                y={tick.y + 3}
                textAnchor="end"
                className="font-mono"
                fontSize="8"
                fill="rgba(0,0,0,0.3)"
              >
                {tick.label}
              </text>
            </g>
          ))}

        {/* X-axis labels */}
        {xLabels.map((lbl, i) => (
          <text
            key={`x-${i}`}
            x={lbl.x}
            y={h - 4}
            textAnchor={
              i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'
            }
            className="font-mono"
            fontSize="8"
            fill="rgba(0,0,0,0.3)"
          >
            {lbl.label}
          </text>
        ))}

        {/* Area fills */}
        {showArea &&
          seriesLines.map((sl, i) => (
            <polygon
              key={`area-${i}`}
              points={sl.areaPoints}
              fill={sl.color}
              fillOpacity="0.06"
            />
          ))}

        {/* Lines */}
        {seriesLines.map((sl, i) => (
          <polyline
            key={`line-${i}`}
            points={sl.points}
            fill="none"
            stroke={sl.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Dots */}
        {showDots &&
          seriesLines.map((sl, si) =>
            sl.sorted.map((d, di) => (
              <circle
                key={`dot-${si}-${di}`}
                cx={dateToX(d.date)}
                cy={valueToY(d.value)}
                r="2.5"
                fill="white"
                stroke={sl.color}
                strokeWidth="1.5"
              />
            ))
          )}

        {/* Hover vertical line */}
        {tooltip && (
          <line
            x1={tooltip.x}
            y1={padT}
            x2={tooltip.x}
            y2={padT + chartH}
            stroke="rgba(0,0,0,0.15)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        {/* Hover highlight dots */}
        {tooltip &&
          tooltip.values.map((v, i) => {
            const point = series[i]?.data.find((d) => d.date === tooltip.date);
            if (!point) return null;
            return (
              <circle
                key={`hover-${i}`}
                cx={tooltip.x}
                cy={valueToY(point.value)}
                r="4"
                fill={v.color}
                stroke="white"
                strokeWidth="2"
              />
            );
          })}
      </svg>

      {/* Tooltip overlay */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: `${(tooltip.x / w) * 100}%`,
            top: `${((tooltip.y - 20) / h) * 100}%`,
            transform: tooltip.x > w * 0.7 ? 'translateX(-110%)' : 'translateX(10%)',
          }}
        >
          <div className="bg-black text-white px-3 py-2 shadow-lg min-w-[120px]">
            <p className="font-mono text-[10px] uppercase tracking-wider text-white/60 mb-1">
              {formatDateFull(tooltip.date)}
            </p>
            {tooltip.values.map((v, i) => (
              <div key={i} className="flex items-center gap-2 font-mono text-xs">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: v.color }}
                />
                <span className="text-white/60">{v.label}:</span>
                <span className="font-bold ml-auto">{v.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Mini Sparkline (for metric cards) ----

export function Sparkline({ data, color, width = 80, height = 24, className = '' }: SparklineProps) {
  if (data.length < 2) return null;

  const w = width;
  const h = height;
  const padY = 2;
  const usableH = h - padY * 2;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * w},${padY + usableH - ((v - min) / range) * usableH}`
    )
    .join(' ');

  // Last value dot position
  const lastY = padY + usableH - ((data[data.length - 1] - min) / range) * usableH;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`${className}`} style={{ width, height }}>
      <polygon
        points={`0,${h - padY} ${points} ${w},${h - padY}`}
        fill={color}
        fillOpacity="0.1"
      />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={w} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

// ---- Growth Rate Calculator ----

export function calculateGrowthRate(
  data: DataPoint[],
  periodDays: number = 30
): { percent: number; absolute: number; positive: boolean } | null {
  if (data.length < 2) return null;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const latestValue = sorted[sorted.length - 1].value;

  // Find value closest to `periodDays` ago
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - periodDays);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  let comparisonPoint = sorted[0];
  for (const point of sorted) {
    if (point.date <= cutoffStr) comparisonPoint = point;
    else break;
  }

  const oldValue = comparisonPoint.value;
  if (oldValue === 0) return null;

  const absolute = latestValue - oldValue;
  const percent = Math.round((absolute / oldValue) * 100);

  return { percent, absolute, positive: percent >= 0 };
}
