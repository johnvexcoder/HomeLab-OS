import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fmtTime, fmtDuration, notifyDispatcher } from '../services/notifyDispatch';
import type { MetricSnapshot } from '../types';

/* ------------------------------------------------------------------ */
/* Timestamp format — canonical YYYY-MM-DD HH:mm:ss, zero-padded      */
/* ------------------------------------------------------------------ */

test('fmtTime renders YYYY-MM-DD HH:mm:ss with zero padding', () => {
  const ms = new Date(2026, 7, 24, 18, 42, 7).getTime(); // local 2026-08-24 18:42:07
  assert.equal(fmtTime(ms), '2026-08-24 18:42:07');
});

test('fmtTime pads single-digit months, days, hours', () => {
  const ms = new Date(2026, 0, 5, 3, 4, 9).getTime(); // 2026-01-05 03:04:09
  assert.equal(fmtTime(ms), '2026-01-05 03:04:09');
});

/* ------------------------------------------------------------------ */
/* Duration formatting                                                 */
/* ------------------------------------------------------------------ */

test('fmtDuration formats seconds under a minute', () => {
  assert.equal(fmtDuration(0, 45_000), '45s');
});

test('fmtDuration formats minutes and seconds', () => {
  // 4m 46s
  assert.equal(fmtDuration(0, (4 * 60 + 46) * 1000), '4m 46s');
});

test('fmtDuration formats hours', () => {
  assert.equal(fmtDuration(0, (2 * 3600 + 3 * 60) * 1000), '2h 03m');
});

test('fmtDuration clamps negative elapsed to zero', () => {
  assert.equal(fmtDuration(10_000, 0), '0s');
});

/* ------------------------------------------------------------------ */
/* State machine behavior                                              */
/* ------------------------------------------------------------------ */

function snap(serverId: string, status: MetricSnapshot['status'], overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    serverId,
    timestamp: Date.now(),
    cpu: status === 'degraded' ? 96 : 12,
    cpuCores: 4,
    ramUsedGb: 2,
    ramTotalGb: 16,
    diskUsedGb: 10,
    diskTotalGb: 100,
    tempC: status === 'degraded' ? 75 : 45,
    netUpMbps: 1,
    netDownMbps: 1,
    load: 0.5,
    uptimeSeconds: 3600,
    processes: 100,
    status,
    reachability: status === 'offline' ? 'unreachable' : 'accessible',
    health: status === 'online' ? 100 : 50,
    sensors: [],
    ...overrides,
  };
}

test('state machine: first observation seeds silently (no crash, no throw)', () => {
  notifyDispatcher.checkStateChanges([snap('srv-a', 'online')]);
});

test('state machine: repeated identical polls do not re-trigger transitions', () => {
  // Same status across many polling cycles must be a silent no-op path.
  for (let i = 0; i < 5; i++) {
    notifyDispatcher.checkStateChanges([snap('srv-dedupe', 'online')]);
  }
});

test('state machine: offline→offline polls stay deduplicated after transition', () => {
  notifyDispatcher.checkStateChanges([snap('srv-off', 'online')]);
  notifyDispatcher.checkStateChanges([snap('srv-off', 'offline')]);
  for (let i = 0; i < 5; i++) {
    notifyDispatcher.checkStateChanges([snap('srv-off', 'offline')]);
  }
});

test('state machine: full lifecycle online→offline→online→degraded→online', () => {
  const id = 'srv-cycle';
  notifyDispatcher.checkStateChanges([snap(id, 'online')]);
  notifyDispatcher.checkStateChanges([snap(id, 'offline')]);
  notifyDispatcher.checkStateChanges([snap(id, 'online')]);
  notifyDispatcher.checkStateChanges([snap(id, 'degraded')]);
  notifyDispatcher.checkStateChanges([snap(id, 'online')]);
});
