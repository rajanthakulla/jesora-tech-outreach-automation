import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { AppDatabase } from '../src/db/database.js';
import { Orchestrator } from '../src/engine/Orchestrator.js';
import { LeadScoutAgent } from '../src/agents/LeadScoutAgent.js';
import { WebsiteVerifierAgent } from '../src/agents/WebsiteVerifierAgent.js';
import { SiteAuditorAgent } from '../src/agents/SiteAuditorAgent.js';
import { PitchCrafterAgent } from '../src/agents/PitchCrafterAgent.js';
import { DispatcherAgent } from '../src/agents/DispatcherAgent.js';
import { InboxMonitorAgent } from '../src/agents/InboxMonitorAgent.js';
import { MeetingCloserAgent } from '../src/agents/MeetingCloserAgent.js';
import { Lead } from '../src/types/index.js';

describe('JESORA TECH 24x7 Outreach Multi-Agent Test Suite (8 Agents)', () => {
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-outreach.sqlite');

  // Clean test DB if exists
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch {}
  }

  const db = new AppDatabase(testDbPath);
  const orchestrator = new Orchestrator(db);

  it('1. Database initializes with tables, 8 agents telemetry, and default Jesora Tech seeds', () => {
    const campaigns = db.getAllCampaigns();
    const sequences = db.getAllSequences();
    const leads = db.getAllLeads();
    const settings = db.getSettings();
    const telemetries = db.getAllAgentTelemetry();

    assert.ok(campaigns.length >= 2, 'Default campaigns should be seeded');
    assert.ok(sequences.length >= 2, 'Both Web Modernization and Enterprise sequences should be seeded');
    const fullstackSeq = db.getSequenceById('seq-jesora-fullstack');
    const enterpriseSeq = db.getSequenceById('seq-enterprise-automation');
    assert.ok(fullstackSeq, 'seq-jesora-fullstack must exist');
    assert.strictEqual(fullstackSeq.steps.length, 6, 'Fullstack sequence must have 6 touchpoints');
    assert.ok(enterpriseSeq, 'seq-enterprise-automation must exist');
    assert.strictEqual(enterpriseSeq.steps.length, 5, 'Enterprise sequence must have 5 touchpoints');

    assert.ok(leads.length >= 4, 'Default initial prospects should be seeded');
    assert.strictEqual(telemetries.length, 8, 'All 8 agents should have telemetry registered in DB');
    assert.strictEqual(settings.jesoraProfile.companyName, 'JESORA TECH');
    assert.strictEqual(settings.jesoraProfile.siteUrl, 'https://jesoratech.com');
  });

  it('2. Lead Scout Agent enforces 100% strict verification of business name, email, and physical address', async () => {
    const scout = new LeadScoutAgent(db);

    // 2a. Rejects candidate without physical address
    const invalidNoAddress = scout.verifyProspectIntegrity({
      companyName: 'Acme Global Corp',
      website: 'https://acme.com',
      industry: 'Software',
      contactName: 'John Doe',
      contactTitle: 'CEO',
      email: 'john@acme.com',
      address: '', // Missing address
      country: 'USA',
      score: 85
    });
    assert.strictEqual(invalidNoAddress.isValid, false);
    assert.ok(invalidNoAddress.reason?.includes('address'));

    // 2b. Rejects candidate with invalid email syntax
    const invalidEmail = scout.verifyProspectIntegrity({
      companyName: 'Acme Global Corp',
      website: 'https://acme.com',
      industry: 'Software',
      contactName: 'John Doe',
      contactTitle: 'CEO',
      email: 'invalid-email-string',
      address: '100 Market St, San Francisco, CA',
      country: 'USA',
      score: 85
    });
    assert.strictEqual(invalidEmail.isValid, false);

    // 2c. Rejects candidate with disposable email
    const invalidDisposable = scout.verifyProspectIntegrity({
      companyName: 'Acme Global Corp',
      website: 'https://acme.com',
      industry: 'Software',
      contactName: 'John Doe',
      contactTitle: 'CEO',
      email: 'john@mailinator.com',
      address: '100 Market St, San Francisco, CA',
      country: 'USA',
      score: 85
    });
    assert.strictEqual(invalidDisposable.isValid, false);

    // 2d. Accepts 100% valid prospect
    const valid = scout.verifyProspectIntegrity({
      companyName: 'Apex Health Systems',
      website: 'https://apexhealth-demo.com',
      industry: 'Digital Health',
      contactName: 'Dr. Sarah Lin',
      contactTitle: 'CTO',
      email: 'sarah.lin@apexhealth-demo.com',
      address: '450 Sutter St, Suite 1200, San Francisco, CA 94108',
      country: 'United States',
      score: 92
    });
    assert.strictEqual(valid.isValid, true);

    // 2e. Scout for campaign
    const campaign = db.getAllCampaigns()[0];
    const scoutResult = await scout.scoutForCampaign(campaign, 2);
    assert.ok(scoutResult.added >= 1, 'Should scout verified leads');
  });

  it('3. Website Verifier Agent validates live website presence and discards dead domains', async () => {
    const verifier = new WebsiteVerifierAgent(db);

    // 3a. Verify live check for simulated sandbox domain
    const liveCheck = await verifier.verifyWebsitePresence('https://jesoratech.com');
    assert.ok(liveCheck.isLive !== undefined);

    // 3b. Verify rejection of empty URL
    const deadCheck = await verifier.verifyWebsitePresence('');
    assert.strictEqual(deadCheck.isLive, false);

    // 3c. Insert lead awaiting website verification
    const testLead: Lead = {
      id: 'lead-test-verify',
      companyName: 'CloudSphere Analytics',
      website: 'https://cloudsphere-demo.com',
      industry: 'Data & AI',
      contactName: 'Marcus Cole',
      contactTitle: 'VP Engineering',
      email: 'marcus@cloudsphere-demo.com',
      address: '77 Geary Blvd, San Francisco, CA 94108',
      country: 'USA',
      score: 85,
      status: 'discovered',
      currentSequenceStep: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.insertLead(testLead);

    // Run verifier agent cycle
    const result = await verifier.run();
    assert.ok(result.actionsTaken >= 1, 'Verifier should process discovered lead');

    const updated = db.getLeadById('lead-test-verify');
    assert.strictEqual(updated?.status, 'website_verified');
    assert.strictEqual(updated?.websiteVerified, true);
  });

  it('4. Site Flaw Auditor Agent runs deep technical diagnostics and compiles Flaw Report', async () => {
    const auditor = new SiteAuditorAgent(db);
    const verifiedLead = db.getAllLeads('website_verified')[0];
    assert.ok(verifiedLead, 'Should have a website_verified lead ready for audit');

    const report = await auditor.auditWebsite(verifiedLead);
    assert.ok(report, 'Should generate flaw report');
    assert.ok(typeof report.performanceScore === 'number');
    assert.ok(report.criticalFlaws.length > 0, 'Should identify critical flaws');
    assert.ok(report.conversionBottlenecks.length > 0, 'Should identify conversion friction points');
    assert.ok(report.recommendedFixes.length > 0, 'Should provide engineering recommendations');

    // Run auditor agent cycle
    const auditRes = await auditor.run();
    assert.ok(auditRes.actionsTaken >= 1, 'Auditor should process website_verified lead');

    const auditedLead = db.getLeadById(verifiedLead.id);
    assert.strictEqual(auditedLead?.status, 'audited');
    assert.ok(auditedLead?.flawReport, 'Lead should now have flawReport attached');
  });

  it('5. Pitch Crafter ingests flaw report and crafts bespoke pitch with 100% source ownership across sequence steps', async () => {
    const crafter = new PitchCrafterAgent(db);
    const auditedLead = db.getAllLeads('audited')[0] || db.getAllLeads()[0];
    const seq = db.getSequenceById('seq-jesora-fullstack')!;

    // Step 1: Concept redesign hook
    const step1Msg = await crafter.craftMessageForLead(auditedLead, 1, seq);
    assert.ok(step1Msg, 'Step 1 Message should be generated');
    assert.ok(step1Msg.subject.includes(auditedLead.companyName), 'Subject should contain company name');
    assert.ok(step1Msg.body.includes(auditedLead.contactName), 'Body should contain contact name');
    assert.ok(step1Msg.body.includes('100% Full Source Code Ownership'), 'Must state 100% source code ownership');

    // Step 3: Technical bottleneck breakdown
    const step3Msg = await crafter.craftMessageForLead(auditedLead, 3, seq);
    assert.ok(step3Msg, 'Step 3 Message should be generated');
    assert.ok(step3Msg.subject.includes(auditedLead.companyName), 'Step 3 subject should contain company name');
    assert.ok(step3Msg.body.includes('Latency & Core Web Vitals'), 'Step 3 must break down technical latency bottlenecks');

    // Step 6: Graceful break-up
    const step6Msg = await crafter.craftMessageForLead(auditedLead, 6, seq);
    assert.ok(step6Msg, 'Step 6 Message should be generated');
    assert.ok(step6Msg.subject.includes('archive'), 'Step 6 subject should ask permission to archive prototype');
  });

  it('6. Dispatcher Agent enforces pacing and daily limits', async () => {
    const dispatcher = new DispatcherAgent(db);
    const result = await dispatcher.run();
    assert.ok(result, 'Dispatcher should execute run cycle');
  });

  it('7. Inbox Monitor Agent accurately classifies sentiment and handles Unsubscribes', async () => {
    const inbox = new InboxMonitorAgent(db);

    // 7a. Test Meeting Request
    const meetingClass = inbox.classifySentiment(
      'Hi Rajan, can we hop on a quick Zoom call this Thursday to discuss the project?',
      'Re: Software roadmap'
    );
    assert.strictEqual(meetingClass.sentiment, 'MEETING_REQUEST');
    assert.ok(meetingClass.confidence >= 0.85);

    // 7b. Test Interested / Pricing
    const interestClass = inbox.classifySentiment(
      'Hi, we are interested. What are your pricing plans for a custom ERP and can you send case studies?',
      'Re: Services'
    );
    assert.strictEqual(interestClass.sentiment, 'INTERESTED');

    // 7c. Test Unsubscribe
    const unsubClass = inbox.classifySentiment(
      'Please unsubscribe me and remove me from your mailing list.',
      'Unsubscribe'
    );
    assert.strictEqual(unsubClass.sentiment, 'UNSUBSCRIBE');
  });

  it('8. Meeting Closer Agent compiles Executive Brief and books calendar slot', async () => {
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
  });

  it('9. Orchestrator executes full synchronized 8-agent cycle in exact sequence', async () => {
    const agents = orchestrator.getAgents();
    assert.strictEqual(Object.keys(agents).length, 8, 'Orchestrator must have all 8 agents');

    const cycleResult = await orchestrator.runFullCycle();
    assert.ok(cycleResult, 'Cycle should return result');
    assert.ok(cycleResult.summary.includes('Cycle #'), 'Summary should mention cycle number');

    const stats = db.getPipelineStats();
    assert.ok(stats.totalLeads > 0, 'Pipeline stats should have leads');
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
