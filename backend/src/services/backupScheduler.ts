import { createBackup } from './backups';
import { getBoolSetting, getIntSetting, setSetting, getSetting } from '../security/settings';
import { notifyDispatcher } from './notifyDispatch';

/**
 * Auto-backup scheduler. Checks once per minute whether a scheduled backup is
 * due:
 *   daily   – every day at HH:MM
 *   weekly  – every Sunday at HH:MM
 *   monthly – on the 1st at HH:MM
 * Tracked via settings `backup.last.<type>` (ISO day key) so the schedule
 * survives restarts without needing persistence in a table.
 */

const CHECK_INTERVAL_MS = 60_000;

export function startBackupScheduler(): NodeJS.Timeout {
  const timer = setInterval(runSchedule, CHECK_INTERVAL_MS);
  timer.unref();
  runSchedule().catch(() => undefined);
  return timer;
}

export async function runSchedule(): Promise<void> {
  if (!getBoolSetting('backup.enabled')) return;
  const hour = getIntSetting('backup.hour', 3);
  const minute = getIntSetting('backup.minute', 0);
  const now = new Date();
  if (now.getHours() !== hour || now.getMinutes() !== minute) return;

  const dayKey = now.toISOString().slice(0, 10);
  const schedules: Array<{ type: 'daily' | 'weekly' | 'monthly'; due: boolean }> = [
    { type: 'daily', due: true },
    { type: 'weekly', due: now.getDay() === 0 },
    { type: 'monthly', due: now.getDate() === 1 },
  ];

  for (const schedule of schedules) {
    const key = `backup.last.${schedule.type}`;
    if (!schedule.due) continue;
    if (getSetting(key) === dayKey) continue;
    try {
      await createBackup(schedule.type, `scheduled ${schedule.type} backup`);
      setSetting(key, dayKey);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      notifyDispatcher.notifyBackupFailure(schedule.type, errorMsg);
      // leave key unset so the next minute retries
    }
  }
}

export function backupStatus(): {
  enabled: boolean;
  hour: number;
  minute: number;
  retention: { daily: number; weekly: number; monthly: number };
  lastRun: string | null;
} {
  return {
    enabled: getBoolSetting('backup.enabled'),
    hour: getIntSetting('backup.hour', 3),
    minute: getIntSetting('backup.minute', 0),
    retention: {
      daily: getIntSetting('backup.retentionDaily', 7),
      weekly: getIntSetting('backup.retentionWeekly', 4),
      monthly: getIntSetting('backup.retentionMonthly', 12),
    },
    lastRun: getSetting('backup.last.daily') || null,
  };
}
