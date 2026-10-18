import Database from 'better-sqlite3';
import pg from 'pg';
import 'dotenv/config';

async function purgeDomesticLeads() {
  console.log('1. Cleaning SQLite...');
  const db = new Database('data/outreach.sqlite');
  
  db.prepare(`
    DELETE FROM messages WHERE lead_id IN (
      SELECT id FROM leads 
      WHERE LOWER(country) LIKE '%nepal%' 
         OR LOWER(country) LIKE '%india%' 
         OR LOWER(address) LIKE '%nepal%' 
         OR LOWER(address) LIKE '%india%' 
         OR LOWER(email) LIKE '%.np' 
         OR LOWER(email) LIKE '%.in'
    )
  `).run();

  db.prepare(`
    DELETE FROM leads 
    WHERE LOWER(country) LIKE '%nepal%' 
       OR LOWER(country) LIKE '%india%' 
       OR LOWER(address) LIKE '%nepal%' 
       OR LOWER(address) LIKE '%india%' 
       OR LOWER(email) LIKE '%.np' 
       OR LOWER(email) LIKE '%.in'
  `).run();

  db.prepare(`UPDATE campaigns SET leads_targeted = 0, leads_contacted = 0, leads_replied = 0, meetings_booked = 0`).run();

  db.prepare(`
    UPDATE campaigns 
    SET target_locations = ?,
        description = 'Outreach to early-stage and growth startups in US, UK, Canada, Malta & European markets seeking agile full-stack engineers with 100% code handover'
    WHERE id = 'camp-global-startups'
  `).run(JSON.stringify(['US', 'UK', 'Canada', 'Malta', 'Germany', 'Netherlands', 'Ireland']));

  db.prepare(`
    UPDATE campaigns 
    SET target_locations = ?,
        name = 'Enterprise ERP & Digital Modernization (US, UK, Malta & Europe)',
        target_niche = 'Enterprise Services, Logistics, Healthcare, E-Commerce',
        description = 'Reaching mid-market enterprises, logistics, healthcare, and retail businesses in US, Canada, UK, Malta & European markets needing workflow automation and custom ERPs'
    WHERE id = 'camp-enterprise-erp-retail'
  `).run(JSON.stringify(['UK', 'US', 'Canada', 'Malta', 'Germany', 'Netherlands', 'Ireland', 'Australia']));

  console.log('SQLite cleaned and campaigns updated to Foreign Markets!');

  if (process.env.DATABASE_URL) {
    console.log('2. Cleaning Neon PostgreSQL...');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

    await pool.query(`
      DELETE FROM messages WHERE lead_id IN (
        SELECT id FROM leads 
        WHERE LOWER(country) LIKE '%nepal%' 
           OR LOWER(country) LIKE '%india%' 
           OR LOWER(address) LIKE '%nepal%' 
           OR LOWER(address) LIKE '%india%' 
           OR LOWER(email) LIKE '%.np' 
           OR LOWER(email) LIKE '%.in'
      )
    `);

    await pool.query(`
      DELETE FROM leads 
      WHERE LOWER(country) LIKE '%nepal%' 
         OR LOWER(country) LIKE '%india%' 
         OR LOWER(address) LIKE '%nepal%' 
         OR LOWER(address) LIKE '%india%' 
         OR LOWER(email) LIKE '%.np' 
         OR LOWER(email) LIKE '%.in'
    `);

    await pool.query(`UPDATE campaigns SET leads_targeted = 0, leads_contacted = 0, leads_replied = 0, meetings_booked = 0`);

    await pool.query(
      `UPDATE campaigns 
       SET target_locations = $1,
           description = 'Outreach to early-stage and growth startups in US, UK, Canada, Malta & European markets seeking agile full-stack engineers with 100% code handover'
       WHERE id = 'camp-global-startups'`,
      [JSON.stringify(['US', 'UK', 'Canada', 'Malta', 'Germany', 'Netherlands', 'Ireland'])]
    );

    await pool.query(
      `UPDATE campaigns 
       SET target_locations = $1,
           name = 'Enterprise ERP & Digital Modernization (US, UK, Malta & Europe)',
           target_niche = 'Enterprise Services, Logistics, Healthcare, E-Commerce',
           description = 'Reaching mid-market enterprises, logistics, healthcare, and retail businesses in US, Canada, UK, Malta & European markets needing workflow automation and custom ERPs'
       WHERE id = 'camp-enterprise-erp-retail'`,
      [JSON.stringify(['UK', 'US', 'Canada', 'Malta', 'Germany', 'Netherlands', 'Ireland', 'Australia'])]
    );

    await pool.end();
    console.log('Neon PostgreSQL cleaned and campaigns updated to Foreign Markets!');
  }
}

purgeDomesticLeads().catch(console.error);
