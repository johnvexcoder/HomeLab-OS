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
  proxmox: {
    host: process.env.PROXMOX_HOST ?? '',
    tokenId: process.env.PROXMOX_TOKEN_ID ?? '',
    tokenSecret: process.env.PROXMOX_TOKEN_SECRET ?? '',
    verifyTls: (process.env.PROXMOX_VERIFY_TLS ?? 'false').toLowerCase() === 'true',
    pollIntervalMs: int(process.env.PROXMOX_POLL_INTERVAL_MS, 5000),
  },
  docker: {
    enabled: (process.env.DOCKER_ENABLED ?? 'false').toLowerCase() === 'true',
    /** unix socket path, or a tcp://host:port DOCKER_HOST-style endpoint */
    host: process.env.DOCKER_HOST ?? '/var/run/docker.sock',
    pollIntervalMs: int(process.env.DOCKER_POLL_INTERVAL_MS, 10000),
    /** name pattern (case-insensitive substring) of the PVE guest that hosts Docker */
    hostGuest: process.env.DOCKER_HOST_GUEST ?? 'docker',
  },
};
