import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: int(process.env.PORT, 4000),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  dataDir: process.env.DATA_DIR ?? path.resolve(__dirname, '../data'),
  mockMode: (process.env.MOCK_MODE ?? 'true').toLowerCase() === 'true',
  telemetryIntervalMs: int(process.env.TELEMETRY_INTERVAL_MS, 2000),
  historyRetentionHours: int(process.env.HISTORY_RETENTION_HOURS, 24),
};
