import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EChartsOption } from 'echarts';
import { endpoints } from '@/api/endpoints';
import type { HistoryPoint, HistoryRange, MetricKey, ServerRuntime } from '@/types';
import { EChart } from './EChart';
import { cn } from '@/lib/utils';
import { useAccentHex } from '@/lib/theme';

export type { MetricKey };

interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  color: string;
  fmt: (v: number) => string;
  max?: number;
}

export const METRIC_DEFS: Record<MetricKey, MetricDef> = {
  cpu: { key: 'cpu', label: 'CPU', unit: '%', color: '#34D399', fmt: (v) => `${Math.round(v)}%`, max: 100 },
  ram: { key: 'ram', label: 'Memory', unit: '%', color: '#60A5FA', fmt: (v) => `${Math.round(v)}%`, max: 100 },
  disk: { key: 'disk', label: 'Storage', unit: '%', color: '#F59E0B', fmt: (v) => `${Math.round(v)}%`, max: 100 },
  temp: { key: 'temp', label: 'Temperature', unit: '°C', color: '#F97316', fmt: (v) => `${Math.round(v)}°C` },
  netUp: { key: 'netUp', label: 'Upload', unit: 'Mb/s', color: '#A78BFA', fmt: (v) => `${Math.round(v)} Mb/s` },
  netDown: { key: 'netDown', label: 'Download', unit: 'Mb/s', color: '#22D3EE', fmt: (v) => `${Math.round(v)} Mb/s` },
  load: { key: 'load', label: 'Load', unit: '', color: '#F472B6', fmt: (v) => v.toFixed(2) },
};

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '6h', label: '6H' },
  { value: '24h', label: '24H' },
];

export function MetricChart({
  server,
  metric,
  range,
  onRangeChange,
  height = 240,
}: {
  server: ServerRuntime;
  metric: MetricKey;
  range: HistoryRange;
  onRangeChange?: (range: HistoryRange) => void;
  height?: number;
}) {
  const accent = useAccentHex();
  const def = useMemo(() => {
    return metric === 'cpu' ? { ...METRIC_DEFS.cpu, color: accent } : METRIC_DEFS[metric];
  }, [metric, accent]);

  const { data } = useQuery({
    queryKey: ['history', server.spec.id, range],
    queryFn: () => endpoints.servers.history(server.spec.id, range),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const option = useMemo<EChartsOption>(() => {
    const points: HistoryPoint[] = data?.points ?? [];
    const times = points.map((p) => new Date(p.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    const values = points.map((p) => p[def.key]);

    return {
      grid: { left: 10, right: 14, top: 24, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#141414',
        borderColor: '#2A2A2A',
        textStyle: { color: '#F5F5F5', fontSize: 12 },
        formatter: (params: unknown) => {
          const p = params as Array<{ axisValue: string; value: number }>;
          if (!p?.[0]) return '';
          return `<div style="font-weight:600">${p[0].axisValue}</div><div>${def.label}: <b style="color:${def.color}">${def.fmt(p[0].value)}</b></div>`;
        },
      },
      xAxis: {
        type: 'category',
        data: times,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#2A2A2A' } },
        axisTick: { show: false },
        axisLabel: { color: '#6B6B6B', fontSize: 10, interval: 'auto', hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        max: def.max,
        axisLabel: { color: '#6B6B6B', fontSize: 10, formatter: (v: number) => `${v}${def.unit === '%' ? '%' : ''}` },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      },
      series: [
        {
          name: def.label,
          type: 'line',
          data: values,
          smooth: 0.4,
          showSymbol: false,
          lineStyle: { width: 2, color: def.color },
          itemStyle: { color: def.color },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${def.color}40` },
                { offset: 1, color: `${def.color}00` },
              ],
            },
          },
          emphasis: { focus: 'series' },
        },
      ],
    };
  }, [data, def]);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: def.color, boxShadow: `0 0 8px ${def.color}` }} />
          <span className="text-sm font-semibold text-text-primary">{def.label}</span>
          <span className="text-xs text-text-muted">
            {def.max ? `${def.max}% max` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-overlay/5 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => onRangeChange?.(r.value)}
              className={cn(
                'flex min-h-11 items-center rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer',
                range === r.value
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-muted hover:text-text-primary',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <EChart option={option} height={height} />
    </div>
  );
}
