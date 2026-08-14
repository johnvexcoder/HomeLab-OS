import type { SensorReading, SensorKind } from '../types';
import { getBoolSetting } from './settings';

/**
 * Feature-flag enforcement for data the UI consumes. Disabled features are
 * denied/emptied SERVER-SIDE — the frontend cannot un-hide them.
 */

export function featureEnabled(id: string): boolean {
  return getBoolSetting(`feature.${id}`);
}

const GPU_KINDS = new Set<SensorKind>(['gpu_temp', 'gpu_usage', 'gpu_power']);
const FAN_KINDS = new Set<SensorKind>(['fan_rpm', 'fan_speed']);
const TEMP_KINDS = new Set<SensorKind>(['disk_temp', 'nvme_temp', 'nic_temp', 'cpu_temp']);

/** Returns the sensor kinds a given feature flag governs. */
export function sensorsForFeature(feature: string): Set<SensorKind> {
  switch (feature) {
    case 'gpu_monitoring':
      return GPU_KINDS;
    case 'fan_monitoring':
      return FAN_KINDS;
    case 'temperature_monitoring':
      return TEMP_KINDS;
    default:
      return new Set();
  }
}

/** Strip sensor readings the flags don't permit. */
export function applySensorFlags(sensors: SensorReading[]): SensorReading[] {
  if (!featureEnabled('hardware_monitoring')) return [];
  const permitted = new Set<SensorKind>();
  if (featureEnabled('gpu_monitoring')) GPU_KINDS.forEach((k) => permitted.add(k));
  if (featureEnabled('fan_monitoring')) FAN_KINDS.forEach((k) => permitted.add(k));
  if (featureEnabled('temperature_monitoring')) TEMP_KINDS.forEach((k) => permitted.add(k));
  return sensors.filter((s) => permitted.has(s.kind));
}
