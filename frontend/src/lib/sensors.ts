import {
  Gauge,
  Thermometer,
  Fan,
  Cpu,
  Zap,
  HardDrive,
  MemoryStick,
  Network,
  Cpu as Chip,
  type LucideIcon,
} from 'lucide-react';
import type { SensorKind, SensorReading } from '@/types';
import type { Tone } from '@/types';

export type SensorGroupId = 'gpu' | 'cooling' | 'power' | 'storage' | 'chip';

export interface SensorGroupDef {
  id: SensorGroupId;
  label: string;
}

export interface SensorDef {
  kind: SensorKind;
  label: string;
  unit: string;
  group: SensorGroupId;
  icon: LucideIcon;
  decimals: number;
}

export const SENSOR_GROUPS: SensorGroupDef[] = [
  { id: 'gpu', label: 'GPU' },
  { id: 'cooling', label: 'Cooling' },
  { id: 'power', label: 'Power' },
  { id: 'storage', label: 'Storage' },
  { id: 'chip', label: 'Chipset' },
];

/**
 * Registry of every sensor the platform knows about. The hardware telemetry UI
 * renders the whole registry in fixed order — a server that lacks a sensor gets
 * a "Not Available" tile. Adding a new sensor to a future release is: add its
 * kind here + emit it from the backend. No redesign required.
 */
export const SENSOR_REGISTRY: Record<SensorKind, SensorDef> = {
  gpu_temp: { kind: 'gpu_temp', label: 'GPU Temperature', unit: '°C', group: 'gpu', icon: Thermometer, decimals: 1 },
  gpu_usage: { kind: 'gpu_usage', label: 'GPU Utilization', unit: '%', group: 'gpu', icon: Gauge, decimals: 0 },
  gpu_power: { kind: 'gpu_power', label: 'GPU Power', unit: 'W', group: 'gpu', icon: Zap, decimals: 0 },
  cpu_temp: { kind: 'cpu_temp', label: 'CPU Temperature', unit: '°C', group: 'chip', icon: Cpu, decimals: 1 },
  fan_rpm: { kind: 'fan_rpm', label: 'Fan Speed', unit: 'rpm', group: 'cooling', icon: Fan, decimals: 0 },
  fan_speed: { kind: 'fan_speed', label: 'Fan Duty', unit: '%', group: 'cooling', icon: Fan, decimals: 0 },
  power_consumption: { kind: 'power_consumption', label: 'Power Draw', unit: 'W', group: 'power', icon: Zap, decimals: 0 },
  disk_temp: { kind: 'disk_temp', label: 'Drive Temperature', unit: '°C', group: 'storage', icon: HardDrive, decimals: 1 },
  nvme_temp: { kind: 'nvme_temp', label: 'NVMe Temperature', unit: '°C', group: 'storage', icon: MemoryStick, decimals: 1 },
  nic_temp: { kind: 'nic_temp', label: 'NIC Temperature', unit: '°C', group: 'chip', icon: Network, decimals: 1 },
};

export const SENSOR_ORDER: SensorKind[] = [
  'cpu_temp',
  'gpu_temp',
  'gpu_usage',
  'gpu_power',
  'fan_rpm',
  'fan_speed',
  'power_consumption',
  'disk_temp',
  'nvme_temp',
  'nic_temp',
];

/** Which tone a live sensor value maps to (from its own thresholds). */
export function sensorTone(reading: SensorReading): Tone {
  if (!reading.available || reading.value === null) return 'neutral';
  const v = reading.value;
  if (reading.criticalThreshold !== undefined && v >= reading.criticalThreshold) return 'crit';
  if (reading.warningThreshold !== undefined && v >= reading.warningThreshold) return 'warn';
  return 'good';
}

/** Stable color per tone for hardware tiles. */
export const SENSOR_TONE_COLOR: Record<Tone, string> = {
  good: '#34D399',
  warn: '#F59E0B',
  crit: '#EF4444',
  neutral: '#6B6B6B',
};

export function formatSensorValue(reading: SensorReading, def: SensorDef): string {
  if (!reading.available || reading.value === null) return '';
  return reading.value.toFixed(def.decimals);
}
