import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { AppDatabase } from '../src/db/database.js';
import { Orchestrator } from '../src/engine/Orchestrator.js';
import { LeadScoutAgent } from '../src/agents/LeadScoutAgent.js';
import { PitchCrafterAgent } from '../src/agents/PitchCrafterAgent.js';
import { DispatcherAgent } from '../src/agents/DispatcherAgent.js';
import { InboxMonitorAgent } from '../src/agents/InboxMonitorAgent.js';
import { MeetingCloserAgent } from '../src/agents/MeetingCloserAgent.js';

describe('JESORA TECH 24x7 Outreach Multi-Agent Test Suite', () => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-outreach.sqlite');

  // Clean test DB if exists
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const db = new AppDatabase(testDbPath);
  const orchestrator = new Orchestrator(db);

  it('1. Database initializes with tables and default Jesora Tech seeds', () => {
    const campaigns = db.getAllCampaigns();
    const sequences = db.getAllSequences();
    const leads = db.getAllLeads();
    const settings = db.getSettings();

    assert.ok(campaigns.length >= 2, 'Default campaigns should be seeded');
    assert.ok(sequences.length >= 1, 'Default outreach sequence should be seeded');
    assert.ok(leads.length >= 4, 'Default initial prospects should be seeded');
    assert.strictEqual(settings.jesoraProfile.companyName, 'JESORA TECH');
    assert.strictEqual(settings.jesoraProfile.siteUrl, 'https://jesoratech.com');
  });

  it('2. Lead Scout Agent discovers and audits prospective clients', async () => {
    const scout = new LeadScoutAgent(db);
    const campaign = db.getAllCampaigns()[0];
    const initialCount = db.getAllLeads().length;

    const added = await scout.scoutForCampaign(campaign, 2);
    assert.strictEqual(added, 2, 'Should scout 2 new leads');

    const newTotal = db.getAllLeads().length;
    assert.strictEqual(newTotal, initialCount + 2, 'Total leads should increment by 2');
  });

  it('3. Pitch Crafter generates tailored copy matching Jesora Tech case studies', async () => {
    const crafter = new PitchCrafterAgent(db);
    const lead = db.getAllLeads('scouted')[0];
    const seq = db.getAllSequences()[0];

    const message = await crafter.craftMessageForLead(lead, 1, seq);
    assert.ok(message, 'Message should be generated');
    assert.ok(message.subject.includes(lead.companyName), 'Subject should contain company name');
    assert.ok(message.body.includes(lead.contactName), 'Body should contain contact name');
    assert.ok(message.body.includes('JESORA TECH'), 'Body should mention Jesora Tech');
    assert.ok(message.body.includes('100% full source code ownership'), 'Body should highlight 100% code handover');
  });

  it('4. Dispatcher Agent enforces anti-spam and daily limits', async () => {
    const dispatcher = new DispatcherAgent(db);
    const result = await dispatcher.run();
    assert.ok(result, 'Dispatcher should execute run cycle');
  });

  it('5. Inbox Monitor Agent accurately classifies sentiment and handles Unsubscribes', async () => {
    const inbox = new InboxMonitorAgent(db);

    // 5a. Test Meeting Request
    const meetingClass = inbox.classifySentiment(
      'Hi Rajan, can we hop on a quick Zoom call this Thursday to discuss the project?',
      'Re: Software roadmap'
    );
    assert.strictEqual(meetingClass.sentiment, 'MEETING_REQUEST');
    assert.ok(meetingClass.confidence >= 0.85);

    // 5b. Test Interested / Pricing
    const interestClass = inbox.classifySentiment(
      'Hi, we are interested. What are your pricing plans for a custom ERP and can you send case studies?',
      'Re: Services'
    );
    assert.strictEqual(interestClass.sentiment, 'INTERESTED');

    // 5c. Test Unsubscribe
    const unsubClass = inbox.classifySentiment(
      'Please unsubscribe me and remove me from your mailing list.',
      'Unsubscribe'
    );
    assert.strictEqual(unsubClass.sentiment, 'UNSUBSCRIBE');

    // 5d. Ingest real unsubscribe message and verify lead status flips
    const testLead = db.getAllLeads()[0];
    const reply = await inbox.ingestIncomingReply({
      fromEmail: testLead.email,
      subject: 'Remove me',
      body: 'Please unsubscribe me.'
    });

    const updatedLead = db.getLeadById(testLead.id);
    assert.strictEqual(updatedLead?.status, 'unsubscribed', 'Lead should be marked unsubscribed');
  });

  it('6. Meeting Closer Agent compiles Executive Brief and books calendar slot', async () => {
    const closer = new MeetingCloserAgent(db);
    const targetLead = db.getAllLeads().find(l => l.status !== 'unsubscribed')!;

    const meeting = await closer.scheduleMeetingForLead(
      targetLead,
      'Looking to build a custom Next.js portal and mobile app.'
    );

    assert.ok(meeting, 'Meeting record should be created');
    assert.ok(meeting.meetUrl.includes('meet.google.com'), 'Should have Google Meet URL');
    assert.ok(meeting.executiveBrief?.includes('EXECUTIVE CLIENT BRIEF'), 'Should contain executive brief header');
    assert.ok(meeting.executiveBrief?.includes(targetLead.companyName.toUpperCase()), 'Brief should include company name');

    const updatedLead = db.getLeadById(targetLead.id);
    assert.strictEqual(updatedLead?.status, 'meeting_scheduled', 'Lead status should be meeting_scheduled');
  });

  it('7. Orchestrator executes full synchronized 24x7 multi-agent cycle', async () => {
    const cycleResult = await orchestrator.runFullCycle();
    assert.ok(cycleResult, 'Cycle should return result');
    assert.ok(cycleResult.summary.includes('Cycle #'), 'Summary should mention cycle number');

    const stats = db.getPipelineStats();
    assert.ok(stats.totalLeads > 0, 'Pipeline stats should have leads');
    assert.strictEqual(typeof stats.replyRatePercent, 'number');
    assert.strictEqual(typeof stats.conversionRatePercent, 'number');
  });

  after(() => {
    try {
      db.db.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    } catch {
      // Ignore cleanup error
    }
  });
});
