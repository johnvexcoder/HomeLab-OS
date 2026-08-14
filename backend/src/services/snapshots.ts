import { randomBytes } from 'node:crypto';
import { getDb } from '../db/database';
import { getAllSettings, getFeaturesMap, setSetting, getBoolSetting, type SettingsMap } from '../security/settings';

export interface SnapshotData {
  version: number;
  capturedAt: number;
  settings: SettingsMap;
  features: Record<string, boolean>;
  integrations: Array<{
    id: string;
    name: string;
    kind: string;
    enabled: boolean;
    configured: boolean;
    config: unknown;
  }>;
  security: {
    readOnly: boolean;
    safeMode: boolean;
    emergencyLock: boolean;
  };
}

export interface SnapshotMeta {
  id: string;
  name: string;
  note: string | null;
  createdAt: number;
  createdBy: string | null;
}

export function captureSnapshot(name: string, createdBy: string | null, note?: string): SnapshotMeta {
  const integrations = (getDb().prepare('SELECT id, name, kind, enabled, configured, config FROM integrations').all() as Array<{
    id: string;
    name: string;
    kind: string;
    enabled: number;
    configured: number;
    config: string | null;
  }>).map((i) => ({
    id: i.id,
    name: i.name,
    kind: i.kind,
    enabled: i.enabled === 1,
    configured: i.configured === 1,
    config: i.config ? JSON.parse(i.config) : null,
  }));

  const data: SnapshotData = {
    version: 1,
    capturedAt: Date.now(),
    settings: getAllSettings(),
    features: getFeaturesMap(),
    integrations,
    security: {
      readOnly: getBoolSetting('security.readOnly'),
      safeMode: getBoolSetting('security.safeMode'),
      emergencyLock: getBoolSetting('security.emergencyLock'),
    },
  };

  const id = randomBytes(8).toString('hex');
  getDb()
    .prepare('INSERT INTO config_snapshots (id, name, note, created_at, created_by, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name.slice(0, 120), note?.slice(0, 500) ?? null, Date.now(), createdBy, JSON.stringify(data));
  return { id, name, createdAt: Date.now(), createdBy, note: note ?? null };
}

export function listSnapshots(limit = 50): SnapshotMeta[] {
  return getDb()
    .prepare('SELECT id, name, note, created_at, created_by FROM config_snapshots ORDER BY created_at DESC LIMIT ?')
    .all(limit) as SnapshotMeta[];
}

export function getSnapshot(id: string): SnapshotData | null {
  const row = getDb().prepare('SELECT data FROM config_snapshots WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data) as SnapshotData;
  } catch {
    return null;
  }
}

export function deleteSnapshot(id: string): boolean {
  return getDb().prepare('DELETE FROM config_snapshots WHERE id = ?').run(id).changes > 0;
}

/**
 * Restore a snapshot's settings/features/integration configs.
 * Secrets are preserved for integrations that already exist; new integrations
 * are created disabled without secrets.
 */
export function restoreSnapshot(id: string, by: string | null): { restored: boolean; integrationCount: number } {
  const snapshot = getSnapshot(id);
  if (!snapshot) return { restored: false, integrationCount: 0 };
  const db = getDb();
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(snapshot.settings)) setSetting(key, value);
    for (const [featureId, enabled] of Object.entries(snapshot.features)) setSetting(`feature.${featureId}`, String(enabled));

    const existing = db.prepare('SELECT id FROM integrations').all() as Array<{ id: string }>;
    const existingIds = new Set(existing.map((e) => e.id));
    const upsert = db.prepare(
      `INSERT INTO integrations (id, name, kind, enabled, configured, config, secrets, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'disabled', ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, kind = excluded.kind, enabled = excluded.enabled,
         configured = excluded.configured, config = excluded.config, updated_at = excluded.updated_at`,
    );
    for (const integration of snapshot.integrations) {
      upsert.run(
        integration.id,
        integration.name,
        integration.kind,
        integration.enabled ? 1 : 0,
        integration.configured ? 1 : 0,
        integration.config ? JSON.stringify(integration.config) : null,
        Date.now(),
      );
      void existingIds;
    }
  });
  tx();
  return { restored: true, integrationCount: snapshot.integrations.length };
}
