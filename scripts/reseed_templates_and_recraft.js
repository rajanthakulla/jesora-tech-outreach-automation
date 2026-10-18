import Database from 'better-sqlite3';
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

console.log('--- PURGING STALE SCHEDULED MESSAGES & RESEEDING EXACT USER TEMPLATES ---');

// 1. SQLite
const sqlite = new Database('./data/outreach.sqlite');

const scheduledBefore = sqlite.prepare("SELECT count(*) as count FROM messages WHERE status = 'scheduled' AND sent_at IS NULL").get();
console.log(`[SQLite] Found ${scheduledBefore.count} stale scheduled messages.`);

// Collect lead IDs that were scheduled so we can set them to 'audited'
const leadsToReset = sqlite.prepare("SELECT DISTINCT lead_id FROM messages WHERE status = 'scheduled' AND sent_at IS NULL").all();

sqlite.prepare("DELETE FROM messages WHERE status = 'scheduled' AND sent_at IS NULL").run();
console.log(`[SQLite] Deleted stale scheduled messages.`);

if (leadsToReset.length > 0) {
  const ids = leadsToReset.map(r => `'${r.lead_id}'`).join(',');
  sqlite.prepare(`UPDATE leads SET status = 'audited', current_sequence_step = 0 WHERE id IN (${ids}) AND status != 'contacted'`).run();
  console.log(`[SQLite] Reset ${leadsToReset.length} leads back to 'audited' for re-crafting.`);
}

// 2. Neon PostgreSQL (if DATABASE_URL present)
if (process.env.DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const pgRes = await pool.query("SELECT count(*) as count FROM messages WHERE status = 'scheduled' AND sent_at IS NULL");
    console.log(`[Neon PG] Found ${pgRes.rows[0].count} stale scheduled messages.`);
    await pool.query("DELETE FROM messages WHERE status = 'scheduled' AND sent_at IS NULL");
    console.log(`[Neon PG] Deleted stale scheduled messages in Neon.`);

    if (leadsToReset.length > 0) {
      const ids = leadsToReset.map(r => `'${r.lead_id}'`).join(',');
      await pool.query(`UPDATE leads SET status = 'audited', current_sequence_step = 0 WHERE id IN (${ids}) AND status != 'contacted'`);
      console.log(`[Neon PG] Reset leads back to 'audited' in Neon.`);
    }
  } catch (err) {
    console.warn('[Neon PG] Error during Neon sync:', err.message);
  } finally {
    await pool.end();
  }
}

console.log('--- PURGE & RESET COMPLETE ---');
