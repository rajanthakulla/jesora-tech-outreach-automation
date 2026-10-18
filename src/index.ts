import 'dotenv/config';
import { AppDatabase } from './db/database.js';
import { Orchestrator } from './engine/Orchestrator.js';
import { createServer } from './server/app.js';

const PORT = Number(process.env.PORT) || 3800;

async function bootstrap() {
  console.log('\n======================================================');
  console.log('   JESORA TECH (jesoratech.com) - 24x7 OUTREACH AI    ');
  console.log('   Autonomous Multi-Agent Client Acquisition System   ');
  console.log('======================================================\n');

  const db = new AppDatabase();
  const orchestrator = new Orchestrator(db);
  const app = createServer(orchestrator);

  const server = app.listen(PORT, () => {
    console.log(`[🚀 SYSTEM ONLINE] Executive Dashboard live at: http://localhost:${PORT}`);
    console.log(`[📊 API & SSE Stream] Ready on port ${PORT}`);

    const settings = db.getSettings();
    if (settings.autonomous.enabled) {
      console.log(`[🤖 24x7 AUTO-PILOT] Activating autonomous agent loop (Cycle: ${settings.autonomous.cycleIntervalMinutes}m)...`);
      orchestrator.start24x7();
    } else {
      console.log('[⏸️ AUTO-PILOT] In standby mode. Toggle ON from dashboard.');
    }
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.log('\n[🛑 SHUTDOWN] Terminating agent loop and closing connections gracefully...');
    orchestrator.stop24x7();
    server.close(() => {
      console.log('[✅ SHUTDOWN COMPLETE] Outreach database safe. Goodbye!');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('uncaughtException', (err: any) => {
    console.error('[Process Warning - Recovered]', err?.message || err);
  });
  process.on('unhandledRejection', (reason: any) => {
    console.error('[Unhandled Rejection - Recovered]', reason?.message || reason);
  });
}

bootstrap().catch(err => {
  console.error('[FATAL BOOTSTRAP ERROR]', err);
  process.exit(1);
});
