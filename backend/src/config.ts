import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

const deploymentProfile = process.env.DEPLOYMENT_PROFILE ?? 'development';

if (!['development', 'lan', 'hardened'].includes(deploymentProfile)) {
  throw new Error('DEPLOYMENT_PROFILE must be development, lan, or hardened');
}

export const config = {
  deploymentProfile: deploymentProfile as 'development' | 'lan' | 'hardened',
  port: int(process.env.PORT, 4000),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  dataDir: process.env.DATA_DIR ?? path.resolve(__dirname, '../data'),
  mockMode: bool(process.env.MOCK_MODE, true),
  demoResetAdmin: bool(process.env.DEMO_RESET_ADMIN, false),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  telemetryIntervalMs: int(process.env.TELEMETRY_INTERVAL_MS, 2000),
  historyRetentionHours: int(process.env.HISTORY_RETENTION_HOURS, 24),
  proxmox: {
    host: process.env.PROXMOX_HOST ?? '',
    tokenId: process.env.PROXMOX_TOKEN_ID ?? '',
    tokenSecret: process.env.PROXMOX_TOKEN_SECRET ?? '',
    verifyTls: bool(process.env.PROXMOX_VERIFY_TLS, false),
    pollIntervalMs: int(process.env.PROXMOX_POLL_INTERVAL_MS, 5000),
    enabled: !!(process.env.PROXMOX_HOST && process.env.PROXMOX_TOKEN_ID && process.env.PROXMOX_TOKEN_SECRET),
  },
  docker: {
    enabled: bool(process.env.DOCKER_ENABLED, false),
    /** unix socket path, or a tcp://host:port DOCKER_HOST-style endpoint */
    host: process.env.DOCKER_HOST ?? '/var/run/docker.sock',
    pollIntervalMs: int(process.env.DOCKER_POLL_INTERVAL_MS, 10000),
    /** name pattern (case-insensitive substring) of the PVE guest that hosts Docker */
    hostGuest: process.env.DOCKER_HOST_GUEST ?? 'docker',
  },
};

/** Refuse configurations that are unsafe for the selected deployment profile. */
export function validateProductionConfig(): void {
  const errors: string[] = [];
  const encryptionKey = process.env.SECRET_ENCRYPTION_KEY ?? '';
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD ?? '';

  if (config.demoResetAdmin && config.deploymentProfile !== 'development') {
    errors.push('DEMO_RESET_ADMIN is only allowed with DEPLOYMENT_PROFILE=development');
  }
  if (config.deploymentProfile !== 'development' && initialPassword === 'homelab-demo') {
    errors.push('the documented demo password cannot be used outside the development profile');
  }
  if (config.deploymentProfile === 'hardened') {
    if (config.mockMode) errors.push('MOCK_MODE must be false in the hardened profile');
    if (!config.cookieSecure) errors.push('COOKIE_SECURE must be true in the hardened profile');
    if (encryptionKey.length < 32) errors.push('SECRET_ENCRYPTION_KEY must contain at least 32 characters in the hardened profile');
    if (config.proxmox.enabled && !config.proxmox.verifyTls) {
      errors.push('PROXMOX_VERIFY_TLS must be true in the hardened profile');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Unsafe deployment configuration:\n- ${errors.join('\n- ')}`);
  }
}
