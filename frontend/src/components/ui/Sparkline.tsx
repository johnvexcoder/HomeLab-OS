import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  min?: number;
  max?: number;
  id?: string;
  className?: string;
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function Sparkline({
  data,
  width = 140,
  height = 36,
  color = 'var(--accent)',
  min,
  max,
  id = 'spark',
  className,
}: SparklineProps) {
  const reactId = useId();
  const { linePath, areaPath, padMin, padMax } = useMemo(() => {
    if (data.length < 2) return { linePath: '', areaPath: '', padMin: 0, padMax: 100 };

    const lo = min ?? Math.min(...data);
    const hi = max ?? Math.max(...data);
    const range = hi - lo || 1;
    const pad = range * 0.15;
    const padMin = lo - pad;
    const padMax = hi + pad;

    const pts = data.map((v, i) => ({
      x: (i / (data.length - 1)) * width,
      y: height - ((v - padMin) / (padMax - padMin)) * height,
    }));

    const line = smoothPath(pts);
    const area = `${line} L ${width} ${height} L 0 ${height} Z`;
    return { linePath: line, areaPath: area, padMin, padMax };
  }, [data, width, height, min, max]);

  if (!linePath) return null;

  const uid = `${id}-${color.replace('#', '')}-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={className}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </linearGradient>
      </defs>

      <motion.path
        d={areaPath}
        fill={`url(#${uid}-fill)`}
        initial={false}
        animate={{ d: areaPath }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />

      <motion.path
        d={linePath}
        fill="none"
        stroke={`url(#${uid}-stroke)`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ d: linePath }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}
