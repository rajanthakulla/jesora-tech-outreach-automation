import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { Orchestrator } from '../engine/Orchestrator.js';
import { AgentRole, Lead, Campaign, SystemSettings } from '../types/index.js';
import crypto from 'node:crypto';

export function createServer(orchestrator: Orchestrator) {
  const app = express();
  const db = orchestrator.db;

  app.use(cors());
  app.use(express.json());

  // Serve static dashboard files
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // --- Real-time SSE Stream ---
  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unregister = orchestrator.notificationSentinel.registerSSEClient((event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });

    // Send initial handshake
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', time: new Date().toISOString() })}\n\n`);

    req.on('close', () => {
      unregister();
    });
  });

  // --- Orchestrator & Telemetry ---
  app.get('/api/status', (req: Request, res: Response) => {
    res.json({
      success: true,
      cycleInfo: orchestrator.getCycleInfo(),
      agents: orchestrator.getTelemetry(),
      pipelineStats: orchestrator.getPipelineStats(),
      recentLogs: db.getRecentLogs(20)
    });
  });

  app.post('/api/orchestrator/toggle', (req: Request, res: Response) => {
    const { enable } = req.body;
    if (enable) {
      orchestrator.start24x7();
    } else {
      orchestrator.stop24x7();
    }
    res.json({ success: true, isRunning24x7: orchestrator.isAutoPilotActive() });
  });

  app.post('/api/orchestrator/cycle', async (req: Request, res: Response) => {
    const result = await orchestrator.runFullCycle();
    res.json({ success: true, ...result });
  });

  app.post('/api/agents/:role/run', async (req: Request, res: Response) => {
    const role = req.params.role as AgentRole;
    try {
      const result = await orchestrator.runAgent(role);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/agents/:role/pause', (req: Request, res: Response) => {
    const role = req.params.role as AgentRole;
    const agent = orchestrator.getAgents()[role];
    if (agent) {
      agent.pause();
      res.json({ success: true, message: `Agent ${role} paused.` });
    } else {
      res.status(404).json({ success: false, error: 'Agent not found' });
    }
  });

  app.post('/api/agents/:role/resume', (req: Request, res: Response) => {
    const role = req.params.role as AgentRole;
    const agent = orchestrator.getAgents()[role];
    if (agent) {
      agent.resume();
      res.json({ success: true, message: `Agent ${role} resumed.` });
    } else {
      res.status(404).json({ success: false, error: 'Agent not found' });
    }
  });

  // --- Leads ---
  app.get('/api/leads', (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const leads = db.getAllLeads(status);
    res.json({ success: true, leads });
  });

  app.get('/api/leads/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    const lead = db.getLeadById(id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    const messages = db.getMessagesForLead(lead.id);
    res.json({ success: true, lead, messages });
  });

  app.post('/api/leads', (req: Request, res: Response) => {
    const body = req.body;
    if (!body.companyName || !body.email) {
      return res.status(400).json({ success: false, error: 'Company name and email are required.' });
    }

    const now = new Date().toISOString();
    const newLead: Lead = {
      id: `lead-${crypto.randomUUID().slice(0, 8)}`,
      companyName: body.companyName,
      website: body.website || 'https://unknown.com',
      industry: body.industry || 'Technology & Services',
      contactName: body.contactName || 'Decision Maker',
      contactTitle: body.contactTitle,
      email: body.email,
      phone: body.phone,
      country: body.country || 'Global',
      techStack: body.techStack,
      painPoints: body.painPoints,
      score: body.score || 80,
      status: body.status || 'scouted',
      campaignId: body.campaignId || 'camp-global-startups',
      currentSequenceStep: 0,
      createdAt: now,
      updatedAt: now
    };

    try {
      db.insertLead(newLead);
      orchestrator.notificationSentinel.log('info', `Manually added lead: ${newLead.companyName}`, { leadId: newLead.id });
      res.json({ success: true, lead: newLead });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.put('/api/leads/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    db.updateLead(id, req.body);
    const updated = db.getLeadById(id);
    res.json({ success: true, lead: updated });
  });

  app.delete('/api/leads/:id', (req: Request, res: Response) => {
    const id = String(req.params.id);
    db.deleteLead(id);
    res.json({ success: true });
  });

  app.post('/api/leads/import-csv', (req: Request, res: Response) => {
    const { items, campaignId } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No lead items provided.' });
    }

    const campaign = campaignId ? db.getCampaignById(campaignId) : db.getAllCampaigns()[0];
    const existingEmails = new Set(db.getAllLeads().map(l => l.email.toLowerCase()));

    let importedCount = 0;
    let discardedCount = 0;
    const discardedReasons: string[] = [];

    for (const item of items) {
      const email = String(item.email || '').trim().toLowerCase();
      const companyName = String(item.companyName || '').trim();
      const website = String(item.website || '').trim();
      const address = String(item.address || '').trim();
      const contactName = String(item.contactName || 'Decision Maker').trim();

      // Integrity validation
      const verification = orchestrator.leadScout.verifyProspectIntegrity({
        companyName,
        email,
        address,
        contactName,
        website: website || 'https://unknown.com',
        industry: item.industry || 'Technology & Services',
        country: item.country || 'Global',
        score: 80
      });

      if (!verification.isValid) {
        discardedCount += 1;
        discardedReasons.push(`"${companyName || 'Unknown'}": ${verification.reason}`);
        continue;
      }

      if (existingEmails.has(email)) {
        discardedCount += 1;
        discardedReasons.push(`"${companyName}": Duplicate email (${email})`);
        continue;
      }

      const now = new Date().toISOString();
      const newLead: Lead = {
        id: `lead-${crypto.randomUUID().slice(0, 8)}`,
        companyName,
        website: website.startsWith('http') ? website : `https://${website}`,
        industry: item.industry || campaign?.targetNiche || 'Technology & Services',
        contactName,
        contactTitle: item.contactTitle || 'Founder / Decision Maker',
        email,
        phone: item.phone,
        address,
        country: item.country || 'Global',
        techStack: item.techStack,
        painPoints: item.painPoints,
        score: 85,
        status: 'discovered', // Advanced to Website Verifier next
        websiteVerified: false,
        campaignId: campaign?.id || 'camp-global-startups',
        currentSequenceStep: 0,
        createdAt: now,
        updatedAt: now
      };

      db.insertLead(newLead);
      existingEmails.add(email);
      importedCount += 1;
    }

    orchestrator.notificationSentinel.log(
      'info',
      `Imported ${importedCount} verified lead(s) via CSV. (Discarded ${discardedCount})`
    );

    res.json({
      success: true,
      importedCount,
      discardedCount,
      discardedReasons: discardedReasons.slice(0, 10)
    });
  });

  app.post('/api/leads/scout-now', async (req: Request, res: Response) => {
    const { campaignId, count } = req.body;
    const campaign = campaignId ? db.getCampaignById(campaignId) : db.getAllCampaigns()[0];
    if (!campaign) {
      return res.status(400).json({ success: false, error: 'No campaign available.' });
    }
    const added = await orchestrator.leadScout.scoutForCampaign(campaign, count || 2);
    res.json({ success: true, leadsAdded: added, campaignName: campaign.name });
  });

  // --- Campaigns ---
  app.get('/api/campaigns', (req: Request, res: Response) => {
    res.json({ success: true, campaigns: db.getAllCampaigns() });
  });

  app.post('/api/campaigns', (req: Request, res: Response) => {
    const body = req.body;
    const now = new Date().toISOString();
    const newCamp: Campaign = {
      id: `camp-${crypto.randomUUID().slice(0, 8)}`,
      name: body.name,
      description: body.description || '',
      targetNiche: body.targetNiche || 'SaaS & Web Platforms',
      targetLocations: body.targetLocations || ['Global'],
      keywords: body.keywords || ['Software', 'Next.js'],
      status: 'active',
      sequenceId: body.sequenceId || 'seq-jesora-fullstack',
      dailyLimit: body.dailyLimit || 30,
      leadsTargeted: 0,
      leadsContacted: 0,
      leadsReplied: 0,
      meetingsBooked: 0,
      createdAt: now,
      updatedAt: now
    };
    db.insertCampaign(newCamp);
    res.json({ success: true, campaign: newCamp });
  });

  // --- Sequences ---
  app.get('/api/sequences', (req: Request, res: Response) => {
    res.json({ success: true, sequences: db.getAllSequences() });
  });

  // --- Messages ---
  app.get('/api/messages', (req: Request, res: Response) => {
    const rows = db.getRecentMessages(100);
    res.json({ success: true, messages: rows });
  });

  // --- Inbound Replies & Conversations ---
  app.get('/api/replies', (req: Request, res: Response) => {
    res.json({ success: true, replies: db.getAllReplies() });
  });

  app.post('/api/simulate/reply', async (req: Request, res: Response) => {
    const { fromEmail, subject, body } = req.body;
    if (!fromEmail || !body) {
      return res.status(400).json({ success: false, error: 'fromEmail and body required' });
    }

    const result = await orchestrator.simulateInboundReply({
      fromEmail,
      subject: subject || 'Re: Software engineering roadmap',
      body
    });

    res.json({ success: true, ...result });
  });

  // --- Meetings ---
  app.get('/api/meetings', (req: Request, res: Response) => {
    res.json({ success: true, meetings: db.getAllMeetings() });
  });

  // --- Logs ---
  app.get('/api/logs', (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 100;
    res.json({ success: true, logs: db.getRecentLogs(limit) });
  });

  // --- Settings ---
  app.get('/api/settings', (req: Request, res: Response) => {
    res.json({ success: true, settings: db.getSettings() });
  });

  app.post('/api/settings', (req: Request, res: Response) => {
    const updates = req.body as SystemSettings;
    db.saveSettings(updates);
    orchestrator.notificationSentinel.log('info', 'System settings updated.');
    res.json({ success: true, settings: db.getSettings() });
  });

  app.post('/api/test/telegram', async (req: Request, res: Response) => {
    const success = await orchestrator.notificationSentinel.sendTelegramNotification(
      '🚀 <b>JESORA TECH 24x7 Automation Reachout Sentinel:</b> Test connection successful! System is active.'
    );
    res.json({ success, message: success ? 'Telegram message sent!' : 'Telegram delivery failed. Check Bot Token & Chat ID.' });
  });

  // Fallback route for SPA dashboard
  app.use((req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}
