import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

const CORE_THEME = {
  textStyle: { color: '#A3A3A3', fontFamily: 'Inter, sans-serif' },
  axisLine: { lineStyle: { color: '#2A2A2A' } },
  splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
  axisLabel: { color: '#6B6B6B', fontSize: 11 },
};

export function chartOption(series: EChartsOption['series'], extra: Partial<EChartsOption> = {}): EChartsOption {
  return {
    backgroundColor: 'transparent',
    animationDuration: 700,
    animationDurationUpdate: 500,
    animationEasing: 'cubicOut',
    animationEasingUpdate: 'cubicOut',
    textStyle: CORE_THEME.textStyle,
    ...extra,
    series,
  };
}

interface EChartProps {
  option: EChartsOption;
  className?: string;
  height?: number;
  notMerge?: boolean;
}

export function EChart({ option, className, height = 260, notMerge = true }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge });
  }, [option, notMerge]);

  return <div ref={containerRef} className={className} style={{ height, width: '100%' }} />;
}
