import { useMemo } from 'react';
import { Cpu } from 'lucide-react';
import type { SensorReading } from '@/types';
import { SENSOR_GROUPS, SENSOR_ORDER, SENSOR_REGISTRY } from '@/lib/sensors';
import { SensorTile } from './SensorTile';
import { Card, CardHeader } from '@/components/ui/Card';

/**
 * Full hardware telemetry panel. Renders every known sensor across all groups
 * in a fixed grid. Sensors the host doesn't expose appear as "Not Available"
 * tiles, so the layout is identical whether telemetry is present or absent.
 *
 * Adding a new sensor type later = add it to SENSOR_REGISTRY / SENSOR_ORDER and
 * the grid picks it up automatically — the panel design never changes.
 */
export function HardwareTelemetry({
  sensors,
  collapsed = false,
}: {
  sensors: SensorReading[];
  collapsed?: boolean;
}) {
  const byKind = useMemo(() => {
    const map = new Map<string, SensorReading>();
    for (const s of sensors) map.set(s.kind, s);
    return map;
  }, [sensors]);

  const totalLive = sensors.filter((s) => s.available && s.value !== null).length;
  const totalExpected = SENSOR_ORDER.length;

  return (
    <Card>
      <CardHeader
        title="Hardware Telemetry"
        subtitle={
          collapsed
            ? `${totalLive}/${totalExpected} sensors reporting`
            : 'Optional sensors — missing hardware renders as Not Available'
        }
        icon={<Cpu className="h-[18px] w-[18px]" />}
        action={
          <span className="rounded-full border border-surface-border bg-overlay/5 px-2.5 py-1 text-[11px] font-medium text-text-muted">
            {totalLive}/{totalExpected}
          </span>
        }
      />

      <div className="space-y-5">
        {SENSOR_GROUPS.map((group) => {
          const kinds = SENSOR_ORDER.filter((k) => SENSOR_REGISTRY[k].group === group.id);
          return (
            <div key={group.id}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                  {group.label}
                </span>
                <span className="h-px flex-1 bg-surface-border" />
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                {kinds.map((kind, i) => (
                  <SensorTile key={kind} reading={byKind.get(kind)} index={i} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
