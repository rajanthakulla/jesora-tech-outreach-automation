// Autonomous 24x7 Cloud Cycle Runner for JESORA TECH Outreach Fleet
// Runs in Cloud (GitHub Actions, Vercel Cron, or cloud runners)
// Operates 24x7 independent of local laptop state

import 'dotenv/config';
import { AppDatabase } from '../dist/db/database.js';
import { Orchestrator } from '../dist/engine/Orchestrator.js';

async function runCloudCycle() {
  const timestamp = new Date().toISOString();
  console.log(`\n======================================================`);
  console.log(`⚡ [JESORA TECH 24x7 CLOUD RUNNER] Cycle Started at ${timestamp}`);
  console.log(`======================================================\n`);

  try {
    const db = new AppDatabase();
    const orchestrator = new Orchestrator(db);

    console.log(`• Connected to Database (Replicating to Neon Cloud DB)`);
    console.log(`• Active Campaigns: ${db.getAllCampaigns().length}`);
    console.log(`• Total Leads Tracked: ${db.getAllLeads().length}`);

    console.log(`\n[Cloud Fleet] Executing synchronized 8-agent autonomous loop...`);
    const result = await orchestrator.runFullCycle();

    console.log(`\n✓ [Cloud Fleet] Cycle execution complete!`);
    console.log(`• Summary: ${result.summary}`);
    console.log(`• Actions Taken: ${result.actions}`);
    console.log(`• Finished at: ${new Date().toISOString()}\n`);

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ [Cloud Fleet] Execution error:`, err);
    process.exit(1);
  }
}

runCloudCycle();
