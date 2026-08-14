/**
 * Standalone seeding script: `npm run seed -w backend`
 * Drops history and regenerates HISTORY_RETENTION_HOURS of fake telemetry.
 */
import { getDb, insertMetrics, queryMetrics, countMetrics } from '../db/database';
import { seedHistory } from '../services/simulator';
import { config } from '../config';

const db = getDb();
db.prepare(`DELETE FROM metrics`).run();

const seeded = seedHistory({ insertMetrics, queryMetrics });
console.log(`Seeded ${seeded} history points (${config.historyRetentionHours}h @ 30s).`);
console.log(`Total in db: ${countMetrics()}`);
