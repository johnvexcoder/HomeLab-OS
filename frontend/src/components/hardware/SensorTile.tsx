import { motion } from 'framer-motion';
import { MinusCircle } from 'lucide-react';
import type { SensorReading } from '@/types';
import { SENSOR_REGISTRY, sensorTone, SENSOR_TONE_COLOR, formatSensorValue } from '@/lib/sensors';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';

/**
 * A single hardware sensor tile. Every tile is the same shape whether the
 * sensor is live, present-but-failed ("Unavailable") or simply unsupported
 * ("Not Available"). No placeholder zeroes — missing sensors render a muted
 * state so the grid never reflows.
 */
export function SensorTile({ reading, index }: { reading?: SensorReading; index: number }) {
  const present = !!reading;
  const live = present && reading.available && reading.value !== null;
  const failed = present && !reading.available;

  const def = reading ? SENSOR_REGISTRY[reading.kind] : undefined;
  const tone = reading ? sensorTone(reading) : 'neutral';
  const color = SENSOR_TONE_COLOR[tone];
  const Icon = def?.icon ?? MinusCircle;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.03 * index, ease: [0.16, 1, 0.3, 1] }}
      className="group flex h-full flex-col justify-between gap-3 rounded-xl border border-surface-border bg-surface-elevated p-3.5 transition-colors hover:border-overlay/15"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors"
          style={{
            backgroundColor: live ? `${color}1A` : 'rgba(255,255,255,0.04)',
            color: live ? color : '#4A4A4A',
          }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full transition-colors',
            live && 'animate-pulse',
          )}
          style={{ backgroundColor: live ? color : '#333333' }}
        />
      </div>

      <div className="min-w-0">
        <div className="text-[11px] font-medium leading-tight text-text-secondary">
          {def?.label ?? 'Sensor'}
        </div>
        {live && reading ? (
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-display text-lg font-bold tabular" style={{ color }}>
              <AnimatedNumber value={reading.value ?? 0} decimals={def?.decimals ?? 0} />
            </span>
            <span className="text-xs text-text-muted">{def?.unit}</span>
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-1.5 text-text-muted">
            <span className="text-sm font-medium">
              {failed ? 'Unavailable' : 'Not Available'}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
