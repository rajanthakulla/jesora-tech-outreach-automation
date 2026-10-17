import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import {
  Lead,
  Campaign,
  EmailSequence,
  OutreachMessage,
  InboundReply,
  Meeting,
  AgentTelemetry,
  AgentLog,
  SystemSettings,
  PipelineStats,
  AgentRole
} from '../types/index.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'outreach.sqlite');

export class AppDatabase {
  public db: Database.Database;

  constructor(customPath?: string) {
    this.db = new Database(customPath || DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initTables();
    this.seedDefaultsIfEmpty();
    this.syncDefaultSequences();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        company_name TEXT NOT NULL,
        website TEXT NOT NULL,
        industry TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        contact_title TEXT,
        email TEXT NOT NULL UNIQUE,
        phone TEXT,
        country TEXT NOT NULL,
        tech_stack TEXT,
        pain_points TEXT,
        score INTEGER NOT NULL DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'discovered',
        notes TEXT,
        campaign_id TEXT,
        current_sequence_step INTEGER NOT NULL DEFAULT 0,
        address TEXT,
        website_verified INTEGER NOT NULL DEFAULT 0,
        flaw_report_json TEXT,
        last_contacted_at TEXT,
        next_follow_up_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        target_niche TEXT NOT NULL,
        target_locations TEXT NOT NULL,
        keywords TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        sequence_id TEXT NOT NULL,
        daily_limit INTEGER NOT NULL DEFAULT 30,
        leads_targeted INTEGER NOT NULL DEFAULT 0,
        leads_contacted INTEGER NOT NULL DEFAULT 0,
        leads_replied INTEGER NOT NULL DEFAULT 0,
        meetings_booked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sequences (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        target_audience TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        sequence_step_number INTEGER NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        scheduled_for TEXT NOT NULL,
        sent_at TEXT,
        delivered_at TEXT,
        opened_at TEXT,
        replied_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS replies (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        outreach_message_id TEXT,
        from_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        sentiment TEXT NOT NULL,
        sentiment_confidence REAL NOT NULL DEFAULT 0.85,
        ai_summary TEXT NOT NULL,
        ai_suggested_reply TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_review',
        received_at TEXT NOT NULL,
        replied_at TEXT,
        FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL,
        scheduled_time TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        meet_url TEXT NOT NULL,
        agenda TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmed',
        executive_brief TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_telemetry (
        agent_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        last_run_at TEXT,
        next_run_at TEXT,
        total_runs INTEGER NOT NULL DEFAULT 0,
        total_actions INTEGER NOT NULL DEFAULT 0,
        current_task TEXT NOT NULL DEFAULT 'Standing by',
        last_error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_logs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
      CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
      CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_logs_timestamp ON agent_logs(timestamp);
    `);

    try { this.db.exec('ALTER TABLE leads ADD COLUMN address TEXT;'); } catch {}
    try { this.db.exec('ALTER TABLE leads ADD COLUMN website_verified INTEGER DEFAULT 0;'); } catch {}
    try { this.db.exec('ALTER TABLE leads ADD COLUMN flaw_report_json TEXT;'); } catch {}
  }

  // --- Settings ---
  public getSettings(): SystemSettings {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('system_config') as
      | { value: string }
      | undefined;

    if (row) {
      try {
        return JSON.parse(row.value) as SystemSettings;
      } catch {
        // Fallback to default
      }
    }
    return this.getDefaultSettings();
  }

  public saveSettings(settings: SystemSettings): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    stmt.run('system_config', JSON.stringify(settings, null, 2), new Date().toISOString());
  }

  public getDefaultSettings(): SystemSettings {
    const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
    const imapPass = (process.env.IMAP_PASS || smtpPass).replace(/\s+/g, '');
    const tgToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const tgChatId = process.env.TELEGRAM_CHAT_ID || '';
    const geminiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';

    return {
      smtp: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || 'techjesora@gmail.com',
        pass: smtpPass,
        fromName: process.env.SMTP_FROM_NAME || 'JESORA TECH Team',
        fromEmail: process.env.SMTP_USER || 'techjesora@gmail.com',
        dryRun: process.env.SMTP_DRY_RUN === 'false' ? false : true
      },
      imap: {
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: Number(process.env.IMAP_PORT) || 993,
        user: process.env.IMAP_USER || process.env.SMTP_USER || 'techjesora@gmail.com',
        pass: imapPass,
        enabled: Boolean(imapPass)
      },
      ai: {
        provider: (process.env.AI_PROVIDER as any) || (geminiKey ? 'gemini' : 'builtin'),
        apiKey: geminiKey,
        modelName: process.env.AI_MODEL || 'gemini-3.8-flash'
      },
      telegram: {
        botToken: tgToken,
        chatId: tgChatId,
        enabled: Boolean(tgToken && tgChatId),
        notifyOnHotLead: true,
        notifyOnMeeting: true,
        notifyOnSend: false
      },
      pacing: {
        maxEmailsPerDay: Number(process.env.MAX_EMAILS_PER_DAY) || 40,
        minDelayMinutesBetweenSends: Number(process.env.MIN_DELAY_MINUTES) || 8,
        businessHoursOnly: true,
        businessHoursStart: 9,
        businessHoursEnd: 18,
        timezone: 'UTC'
      },
      autonomous: {
        enabled: true,
        cycleIntervalMinutes: 10,
        autoReplyInterested: true,
        requireApprovalForMeetings: false
      },
      jesoraProfile: {
        companyName: 'JESORA TECH',
        tagline: '#1 IT & Custom Software Development Partner',
        siteUrl: 'https://jesoratech.com',
        headquarters: 'Tinkune, Kathmandu 44600, Nepal',
        contactEmail: 'techjesora@gmail.com',
        contactPhone: '+977 9740291406',
        calendarBookingUrl: process.env.CALENDLY_URL || 'https://calendly.com/techjesora/30min',
        keySellingPoints: [
          '100% full source code ownership handed over (zero vendor lock-in)',
          '40-60% development cost advantage with uncompromising Silicon Valley quality standards',
          'Agile 2-week sprints with transparent milestone demos',
          'Enterprise OWASP data security compliance and guaranteed 24/7 SLA maintenance',
          'Modern tech stack: Next.js, React, Node.js, Python, Flutter, PostgreSQL, Cloud ERP'
        ],
        caseStudies: [
          {
            title: 'WriteWell — AI Writing Humanizer SaaS',
            category: 'AI SaaS & Web App',
            url: 'https://www.writewell.space',
            highlight: 'Engineered AI prose refinement engine with zero latency and high retention.'
          },
          {
            title: 'MOTOFIX HUB — Service & Booking Platform',
            category: 'Automotive & Booking Web Platform',
            url: 'https://motohubfix.vercel.app',
            highlight: 'Live workshop queue tracking, automated appointment scheduling, package billing.'
          },
          {
            title: 'Radiant Montessori School Web Campus',
            category: 'EdTech & Digital Campus',
            url: 'https://rme.edu.np',
            highlight: 'Full web portal and student notice system serving 2,300+ students.'
          },
          {
            title: 'Razzle Showroom — Retail & Gadgets',
            category: 'E-Commerce & Retail',
            url: 'https://razzletikapur.vercel.app',
            highlight: 'High-speed digital catalog, cart management, and inventory checkout.'
          },
          {
            title: 'We-Cycle Ames Platform (Iowa, USA)',
            category: 'Non-Profit & Community Logistics',
            url: 'https://www.wecycleames.org',
            highlight: 'Community bicycle recycling logistics, donation workflows, and volunteer portal.'
          }
        ]
      }
    };
  }

  // --- Leads CRUD ---
  public getAllLeads(filterStatus?: string): Lead[] {
    let sql = 'SELECT * FROM leads ORDER BY score DESC, created_at DESC';
    let rows: any[];
    if (filterStatus && filterStatus !== 'all') {
      sql = 'SELECT * FROM leads WHERE status = ? ORDER BY score DESC, created_at DESC';
      rows = this.db.prepare(sql).all(filterStatus);
    } else {
      rows = this.db.prepare(sql).all();
    }

    return rows.map(r => ({
      id: r.id,
      companyName: r.company_name,
      website: r.website,
      industry: r.industry,
      contactName: r.contact_name,
      contactTitle: r.contact_title || undefined,
      email: r.email,
      phone: r.phone || undefined,
      country: r.country,
      techStack: r.tech_stack || undefined,
      painPoints: r.pain_points || undefined,
      score: r.score,
      status: r.status,
      address: r.address || undefined,
      websiteVerified: Boolean(r.website_verified),
      flawReport: r.flaw_report_json ? JSON.parse(r.flaw_report_json) : undefined,
      notes: r.notes || undefined,
      campaignId: r.campaign_id || undefined,
      currentSequenceStep: r.current_sequence_step,
      lastContactedAt: r.last_contacted_at || undefined,
      nextFollowUpAt: r.next_follow_up_at || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  public getLeadById(id: string): Lead | null {
    const r = this.db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      companyName: r.company_name,
      website: r.website,
      industry: r.industry,
      contactName: r.contact_name,
      contactTitle: r.contact_title || undefined,
      email: r.email,
      phone: r.phone || undefined,
      address: r.address || undefined,
      country: r.country,
      techStack: r.tech_stack || undefined,
      painPoints: r.pain_points || undefined,
      score: r.score,
      status: r.status,
      websiteVerified: Boolean(r.website_verified),
      flawReport: r.flaw_report_json ? JSON.parse(r.flaw_report_json) : undefined,
      notes: r.notes || undefined,
      campaignId: r.campaign_id || undefined,
      currentSequenceStep: r.current_sequence_step,
      lastContactedAt: r.last_contacted_at || undefined,
      nextFollowUpAt: r.next_follow_up_at || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  public getLeadByEmail(email: string): Lead | null {
    const r = this.db.prepare('SELECT * FROM leads WHERE LOWER(email) = LOWER(?)').get(email) as any;
    if (!r) return null;
    return this.getLeadById(r.id);
  }

  public insertLead(lead: Lead): void {
    const stmt = this.db.prepare(`
      INSERT INTO leads (
        id, company_name, website, industry, contact_name, contact_title,
        email, phone, address, country, tech_stack, pain_points, score, status,
        website_verified, flaw_report_json, notes, campaign_id,
        current_sequence_step, last_contacted_at, next_follow_up_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      lead.id,
      lead.companyName,
      lead.website,
      lead.industry,
      lead.contactName,
      lead.contactTitle || null,
      lead.email,
      lead.phone || null,
      lead.address || null,
      lead.country,
      lead.techStack || null,
      lead.painPoints || null,
      lead.score,
      lead.status,
      lead.websiteVerified ? 1 : 0,
      lead.flawReport ? JSON.stringify(lead.flawReport) : null,
      lead.notes || null,
      lead.campaignId || null,
      lead.currentSequenceStep,
      lead.lastContactedAt || null,
      lead.nextFollowUpAt || null,
      lead.createdAt,
      lead.updatedAt
    );
  }

  public updateLead(id: string, updates: Partial<Lead>): void {
    const existing = this.getLeadById(id);
    if (!existing) return;

    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    const stmt = this.db.prepare(`
      UPDATE leads SET
        company_name = ?, website = ?, industry = ?, contact_name = ?,
        contact_title = ?, email = ?, phone = ?, address = ?, country = ?,
        tech_stack = ?, pain_points = ?, score = ?, status = ?,
        website_verified = ?, flaw_report_json = ?, notes = ?, campaign_id = ?,
        current_sequence_step = ?, last_contacted_at = ?, next_follow_up_at = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      merged.companyName,
      merged.website,
      merged.industry,
      merged.contactName,
      merged.contactTitle || null,
      merged.email,
      merged.phone || null,
      merged.address || null,
      merged.country,
      merged.techStack || null,
      merged.painPoints || null,
      merged.score,
      merged.status,
      merged.websiteVerified ? 1 : 0,
      merged.flawReport ? JSON.stringify(merged.flawReport) : null,
      merged.notes || null,
      merged.campaignId || null,
      merged.currentSequenceStep,
      merged.lastContactedAt || null,
      merged.nextFollowUpAt || null,
      merged.updatedAt,
      id
    );
  }

  public deleteLead(id: string): void {
    this.db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  }

  // --- Campaigns CRUD ---
  public getAllCampaigns(): Campaign[] {
    const rows = this.db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      targetNiche: r.target_niche,
      targetLocations: JSON.parse(r.target_locations || '[]'),
      keywords: JSON.parse(r.keywords || '[]'),
      status: r.status,
      sequenceId: r.sequence_id,
      dailyLimit: r.daily_limit,
      leadsTargeted: r.leads_targeted,
      leadsContacted: r.leads_contacted,
      leadsReplied: r.leads_replied,
      meetingsBooked: r.meetings_booked,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  public getCampaignById(id: string): Campaign | null {
    const r = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      targetNiche: r.target_niche,
      targetLocations: JSON.parse(r.target_locations || '[]'),
      keywords: JSON.parse(r.keywords || '[]'),
      status: r.status,
      sequenceId: r.sequence_id,
      dailyLimit: r.daily_limit,
      leadsTargeted: r.leads_targeted,
      leadsContacted: r.leads_contacted,
      leadsReplied: r.leads_replied,
      meetingsBooked: r.meetings_booked,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  public getCampaign(id: string): Campaign | null {
    return this.getCampaignById(id);
  }

  public insertCampaign(campaign: Campaign): void {
    const stmt = this.db.prepare(`
      INSERT INTO campaigns (
        id, name, description, target_niche, target_locations, keywords,
        status, sequence_id, daily_limit, leads_targeted, leads_contacted,
        leads_replied, meetings_booked, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      campaign.id,
      campaign.name,
      campaign.description,
      campaign.targetNiche,
      JSON.stringify(campaign.targetLocations),
      JSON.stringify(campaign.keywords),
      campaign.status,
      campaign.sequenceId,
      campaign.dailyLimit,
      campaign.leadsTargeted,
      campaign.leadsContacted,
      campaign.leadsReplied,
      campaign.meetingsBooked,
      campaign.createdAt,
      campaign.updatedAt
    );
  }

  public updateCampaignStats(campaignId: string): void {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('contacted', 'replied', 'meeting_scheduled', 'won') THEN 1 ELSE 0 END) as contacted,
        SUM(CASE WHEN status IN ('replied', 'meeting_scheduled', 'won') THEN 1 ELSE 0 END) as replied,
        SUM(CASE WHEN status IN ('meeting_scheduled', 'won') THEN 1 ELSE 0 END) as meetings
      FROM leads
      WHERE campaign_id = ?
    `).get(campaignId) as any;

    if (stats) {
      this.db.prepare(`
        UPDATE campaigns SET
          leads_targeted = ?,
          leads_contacted = ?,
          leads_replied = ?,
          meetings_booked = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        stats.total || 0,
        stats.contacted || 0,
        stats.replied || 0,
        stats.meetings || 0,
        new Date().toISOString(),
        campaignId
      );
    }
  }

  // --- Sequences CRUD ---
  public getAllSequences(): EmailSequence[] {
    const rows = this.db.prepare('SELECT * FROM sequences ORDER BY created_at ASC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      targetAudience: r.target_audience,
      steps: JSON.parse(r.steps_json || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  public getSequenceById(id: string): EmailSequence | null {
    const r = this.db.prepare('SELECT * FROM sequences WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      targetAudience: r.target_audience,
      steps: JSON.parse(r.steps_json || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  public getSequence(id: string): EmailSequence | null {
    return this.getSequenceById(id);
  }

  public insertSequence(seq: EmailSequence): void {
    const stmt = this.db.prepare(`
      INSERT INTO sequences (id, name, description, target_audience, steps_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        target_audience = excluded.target_audience,
        steps_json = excluded.steps_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      seq.id,
      seq.name,
      seq.description,
      seq.targetAudience,
      JSON.stringify(seq.steps),
      seq.createdAt,
      seq.updatedAt
    );
  }

  // --- Messages CRUD ---
  public insertMessage(msg: OutreachMessage): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, lead_id, campaign_id, sequence_step_number, subject, body,
        status, scheduled_for, sent_at, delivered_at, opened_at, replied_at,
        error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      msg.id,
      msg.leadId,
      msg.campaignId,
      msg.sequenceStepNumber,
      msg.subject,
      msg.body,
      msg.status,
      msg.scheduledFor,
      msg.sentAt || null,
      msg.deliveredAt || null,
      msg.openedAt || null,
      msg.repliedAt || null,
      msg.errorMessage || null,
      msg.createdAt
    );
  }

  public updateMessageStatus(id: string, status: OutreachMessage['status'], extra?: { sentAt?: string; error?: string }): void {
    const stmt = this.db.prepare(`
      UPDATE messages SET
        status = ?,
        sent_at = COALESCE(?, sent_at),
        error_message = COALESCE(?, error_message)
      WHERE id = ?
    `);
    stmt.run(status, extra?.sentAt || null, extra?.error || null, id);
  }

  public getMessagesForLead(leadId: string): OutreachMessage[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY sequence_step_number ASC').all(leadId) as any[];
    return rows.map(r => ({
      id: r.id,
      leadId: r.lead_id,
      campaignId: r.campaign_id,
      sequenceStepNumber: r.sequence_step_number,
      subject: r.subject,
      body: r.body,
      status: r.status,
      scheduledFor: r.scheduled_for,
      sentAt: r.sent_at || undefined,
      deliveredAt: r.delivered_at || undefined,
      openedAt: r.opened_at || undefined,
      repliedAt: r.replied_at || undefined,
      errorMessage: r.error_message || undefined,
      createdAt: r.created_at
    }));
  }

  public getPendingMessages(limit: number = 20): OutreachMessage[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM messages
      WHERE status = 'scheduled' AND scheduled_for <= ?
      ORDER BY scheduled_for ASC
      LIMIT ?
    `).all(now, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      leadId: r.lead_id,
      campaignId: r.campaign_id,
      sequenceStepNumber: r.sequence_step_number,
      subject: r.subject,
      body: r.body,
      status: r.status,
      scheduledFor: r.scheduled_for,
      sentAt: r.sent_at || undefined,
      createdAt: r.created_at
    }));
  }

  public getTodaySentCount(): number {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE status IN ('sent', 'delivered', 'opened', 'replied')
      AND sent_at >= ?
    `).get(startOfDay.toISOString()) as any;

    return row?.count || 0;
  }

  public cancelPendingMessagesForLead(leadId: string): void {
    this.db.prepare(`
      UPDATE messages SET status = 'failed', error_message = 'Cancelled: Lead unsubscribed'
      WHERE lead_id = ? AND status = 'scheduled'
    `).run(leadId);
  }

  public getRecentMessages(limit: number = 100): OutreachMessage[] {
    const rows = this.db.prepare('SELECT * FROM messages ORDER BY scheduled_for DESC LIMIT ?').all(limit) as any[];
    return rows.map(r => ({
      id: r.id,
      leadId: r.lead_id,
      campaignId: r.campaign_id,
      sequenceStepNumber: r.sequence_step_number,
      subject: r.subject,
      body: r.body,
      status: r.status,
      scheduledFor: r.scheduled_for,
      sentAt: r.sent_at || undefined,
      deliveredAt: r.delivered_at || undefined,
      openedAt: r.opened_at || undefined,
      repliedAt: r.replied_at || undefined,
      errorMessage: r.error_message || undefined,
      createdAt: r.created_at
    }));
  }

  // --- Inbound Replies CRUD ---
  public insertReply(reply: InboundReply): void {
    const stmt = this.db.prepare(`
      INSERT INTO replies (
        id, lead_id, outreach_message_id, from_email, subject, body,
        sentiment, sentiment_confidence, ai_summary, ai_suggested_reply,
        status, received_at, replied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      reply.id,
      reply.leadId,
      reply.outreachMessageId || null,
      reply.fromEmail,
      reply.subject,
      reply.body,
      reply.sentiment,
      reply.sentimentConfidence,
      reply.aiSummary,
      reply.aiSuggestedReply,
      reply.status,
      reply.receivedAt,
      reply.repliedAt || null
    );
  }

  public getAllReplies(): InboundReply[] {
    const rows = this.db.prepare('SELECT * FROM replies ORDER BY received_at DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      leadId: r.lead_id,
      outreachMessageId: r.outreach_message_id || undefined,
      fromEmail: r.from_email,
      subject: r.subject,
      body: r.body,
      sentiment: r.sentiment,
      sentimentConfidence: r.sentiment_confidence,
      aiSummary: r.ai_summary,
      aiSuggestedReply: r.ai_suggested_reply,
      status: r.status,
      receivedAt: r.received_at,
      repliedAt: r.replied_at || undefined
    }));
  }

  public updateReplyStatus(id: string, status: InboundReply['status'], repliedAt?: string): void {
    this.db.prepare(`
      UPDATE replies SET status = ?, replied_at = COALESCE(?, replied_at)
      WHERE id = ?
    `).run(status, repliedAt || null, id);
  }

  // --- Meetings CRUD ---
  public insertMeeting(m: Meeting): void {
    const stmt = this.db.prepare(`
      INSERT INTO meetings (
        id, lead_id, scheduled_time, duration_minutes, meet_url, agenda,
        status, executive_brief, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      m.id,
      m.leadId,
      m.scheduledTime,
      m.durationMinutes,
      m.meetUrl,
      m.agenda,
      m.status,
      m.executiveBrief || null,
      m.createdAt
    );
  }

  public getAllMeetings(): Meeting[] {
    const rows = this.db.prepare('SELECT * FROM meetings ORDER BY scheduled_time ASC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      leadId: r.lead_id,
      scheduledTime: r.scheduled_time,
      durationMinutes: r.duration_minutes,
      meetUrl: r.meet_url,
      agenda: r.agenda,
      status: r.status,
      executiveBrief: r.executive_brief || undefined,
      createdAt: r.created_at
    }));
  }

  // --- Agent Telemetry & Logs ---
  public upsertAgentTelemetry(telemetry: AgentTelemetry): void {
    const stmt = this.db.prepare(`
      INSERT INTO agent_telemetry (
        agent_id, name, role, description, status, last_run_at, next_run_at,
        total_runs, total_actions, current_task, last_error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        status = excluded.status,
        last_run_at = excluded.last_run_at,
        next_run_at = excluded.next_run_at,
        total_runs = excluded.total_runs,
        total_actions = excluded.total_actions,
        current_task = excluded.current_task,
        last_error_message = excluded.last_error_message
    `);

    stmt.run(
      telemetry.agentId,
      telemetry.name,
      telemetry.role,
      telemetry.description,
      telemetry.status,
      telemetry.lastRunAt || null,
      telemetry.nextRunAt || null,
      telemetry.totalRuns,
      telemetry.totalActions,
      telemetry.currentTask,
      telemetry.lastErrorMessage || null
    );
  }

  public getAllAgentTelemetry(): AgentTelemetry[] {
    const rows = this.db.prepare('SELECT * FROM agent_telemetry ORDER BY agent_id ASC').all() as any[];
    return rows.map(r => ({
      agentId: r.agent_id as AgentRole,
      name: r.name,
      role: r.role,
      description: r.description,
      status: r.status,
      lastRunAt: r.last_run_at || undefined,
      nextRunAt: r.next_run_at || undefined,
      totalRuns: r.total_runs,
      totalActions: r.total_actions,
      currentTask: r.current_task,
      lastErrorMessage: r.last_error_message || undefined
    }));
  }

  public insertAgentLog(log: AgentLog): void {
    const stmt = this.db.prepare(`
      INSERT INTO agent_logs (id, agent_id, level, message, details_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      log.id,
      log.agentId,
      log.level,
      log.message,
      log.details ? JSON.stringify(log.details) : null,
      log.timestamp
    );

    // Keep table compact: prune beyond 1000 items
    this.db.prepare(`
      DELETE FROM agent_logs WHERE id NOT IN (
        SELECT id FROM agent_logs ORDER BY timestamp DESC LIMIT 1000
      )
    `).run();
  }

  public getRecentLogs(limit: number = 100): AgentLog[] {
    const rows = this.db.prepare('SELECT * FROM agent_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as any[];
    return rows.map(r => ({
      id: r.id,
      agentId: r.agent_id,
      level: r.level,
      message: r.message,
      details: r.details_json ? JSON.parse(r.details_json) : undefined,
      timestamp: r.timestamp
    }));
  }

  // --- Pipeline Statistics ---
  public getPipelineStats(): PipelineStats {
    const leadCounts = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'scouted' THEN 1 ELSE 0 END) as scouted,
        SUM(CASE WHEN status IN ('contacted', 'replied', 'meeting_scheduled', 'won') THEN 1 ELSE 0 END) as contacted,
        SUM(CASE WHEN status IN ('replied', 'meeting_scheduled', 'won') THEN 1 ELSE 0 END) as replied,
        SUM(CASE WHEN status = 'meeting_scheduled' THEN 1 ELSE 0 END) as meetings,
        SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) as unsubscribed
      FROM leads
    `).get() as any;

    const emailCount = this.db.prepare(`
      SELECT COUNT(*) as sent FROM messages WHERE status IN ('sent', 'delivered', 'opened', 'replied')
    `).get() as any;

    const activeCampaigns = this.db.prepare(`
      SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'
    `).get() as any;

    const totalLeads = leadCounts?.total || 0;
    const contacted = leadCounts?.contacted || 0;
    const replied = leadCounts?.replied || 0;
    const meetings = leadCounts?.meetings || 0;

    const replyRate = contacted > 0 ? (replied / contacted) * 100 : 0;
    const convRate = contacted > 0 ? (meetings / contacted) * 100 : 0;

    return {
      totalLeads,
      scoutedLeads: leadCounts?.scouted || 0,
      contactedLeads: contacted,
      repliedLeads: replied,
      meetingsBooked: meetings,
      unsubscribedLeads: leadCounts?.unsubscribed || 0,
      totalEmailsSent: emailCount?.sent || 0,
      activeCampaigns: activeCampaigns?.count || 0,
      replyRatePercent: Number(replyRate.toFixed(1)),
      conversionRatePercent: Number(convRate.toFixed(1))
    };
  }

  // --- Sequences & Defaults ---
  public syncDefaultSequences(): void {
    const defaultSeq: EmailSequence = {
      id: 'seq-jesora-fullstack',
      name: 'Jesora Tech 6-Touch High-Value Engineering & Web Modernization Sequence',
      description: '6-touch consultative sequence featuring bespoke concept redesign previews, site flaw diagnostic breakdowns, live production case studies, free architectural blueprints, and 100% full source code ownership.',
      targetAudience: 'Founders, CTOs, and Managing Directors seeking agile full-stack engineers with 100% code handover and 40-60% cost advantage',
      steps: [
        {
          stepNumber: 1,
          delayDays: 0,
          purpose: 'Concept redesign hook & site flaw diagnostic breakdown',
          subjectTemplate: 'Built a concept redesign for {{companyName}} / Quick question',
          bodyTemplate: `Hi {{contactName}},

I didn't want to reach out empty-handed, so our engineering team at JESORA TECH (jesoratech.com) actually put together a rapid concept redesign & performance audit for {{companyName}} after analyzing your current web experience.

Here is the quick diagnostic breakdown of what our audit flagged vs. what we architected:

• OBSERVED BOTTLENECK:
{{painPoints}}

• THE SOLUTION WE ARCHITECTED:
A modern Next.js/React architecture with sub-second page loads, responsive mobile-first UI, and clean API workflows designed to stop visitor bounce rates and maximize conversions.

Unlike traditional agencies that keep your software hostage, we operate with a developer-first ethos:
1. 100% Full Source Code Ownership handed directly to you from Day 1.
2. Agile 2-week delivery sprints with demonstrable live staging demos.
3. 40–60% development cost advantage with Silicon Valley engineering standards.

Would you be against taking a 2-minute peek at the concept prototype we sketched out for you?

Best regards,
Rajan Thakulla
Founder & Lead Engineer | JESORA TECH
Tinkune, Kathmandu | techjesora@gmail.com | jesoratech.com`
        },
        {
          stepNumber: 2,
          delayDays: 3,
          purpose: 'Case study proof & interactive prototype walkthrough',
          subjectTemplate: 'Re: Built a concept redesign for {{companyName}} (Production teardown)',
          bodyTemplate: `Hi {{contactName}},

Following up quickly on my note about the concept prototype we sketched for {{companyName}}.

To give you an idea of our execution standard: we recently engineered WriteWell (writewell.space) — an AI SaaS platform with real-time text processing and zero latency — as well as MotoFix (motohubfix.vercel.app), a live workshop booking & enterprise queue system.

Whether you're looking to turn that concept into reality, build a custom web portal, or automate internal operations, we deliver turnkey production code with zero agency lock-in.

Would love to share the private preview with you. Are you open to a brief 10-minute chat this Thursday?

Alternatively, feel free to pick any slot that fits your schedule:
{{calendarBookingUrl}}

Warm regards,
Rajan Thakulla | JESORA TECH Team`
        },
        {
          stepNumber: 3,
          delayDays: 3,
          purpose: 'Technical site flaw audit teardown & mobile conversion friction',
          subjectTemplate: '3 performance bottlenecks losing {{companyName}} leads (+ Next.js fix)',
          bodyTemplate: `Hi {{contactName}},

While fine-tuning the concept prototype for {{companyName}}, our team ran a deeper technical benchmark on your live site. Three specific friction points jumped out:

1. Latency & Core Web Vitals: Mobile visitors are experiencing rendering delays and layout shift before core call-to-actions load, which silently drives bounce rates up by 30-40%.
2. Interactive Conversion Funnel: The current inquiry/contact pathway requires too many manual steps instead of an instantaneous, friction-free booking flow.
3. Modern Stack Upgrade: Transitioning from legacy CMS/monolithic code to a decoupled Next.js & Tailwind setup would immediately slash hosting overhead and deliver instant sub-second page transitions.

We already addressed all three in the prototype build.

Would it be helpful if I recorded a brief 2-minute Loom video walking through the interactive differences?

Best,
Rajan Thakulla
JESORA TECH | jesoratech.com`
        },
        {
          stepNumber: 4,
          delayDays: 3,
          purpose: 'Value offering: Free technical architecture & feasibility blueprint',
          subjectTemplate: 'Free architecture blueprint for {{companyName}} (Zero obligations)',
          bodyTemplate: `Hi {{contactName}},

I know how demanding your schedule is leading {{companyName}}. 

To remove all friction, we’d love to gift you our complete Technical Architecture & Feasibility Blueprint for {{companyName}} — completely on the house.

Our senior software architects will map out:
• Recommended modern stack (Next.js, Node.js, Python, PostgreSQL)
• Database schema & API integration roadmap
• Realistic 2-week milestone sprint breakdown & cost estimation

Even if you choose to build it internally or with someone else, the blueprint and architecture diagrams are yours to keep.

If this sounds helpful, grab 15 minutes here:
{{calendarBookingUrl}}

Best,
Rajan Thakulla | JESORA TECH`
        },
        {
          stepNumber: 5,
          delayDays: 4,
          purpose: 'Staging preview & transparent sprint pricing breakdown',
          subjectTemplate: 'Quick staging preview & sprint breakdown for {{companyName}}',
          bodyTemplate: `Hi {{contactName}},

I wanted to share how we work with companies like {{companyName}} to eliminate the usual software delivery headaches.

Instead of vague 6-month contracts with bloated agency retainers, we work in focused 2-week sprints:
• Fixed, transparent sprint rates (typically 40-60% below US/Western European agency quotes)
• Production deployment to your own private AWS/Vercel cloud every Friday
• Daily async Loom updates & GitHub PR access from day one
• Zero junior hand-offs — all work is driven by experienced full-stack engineers

If you'd like to review the concept preview we set up for {{companyName}} or discuss any technical roadmap priorities, feel free to book a quick introductory call:
{{calendarBookingUrl}}

Warm regards,
Rajan Thakulla
Founder & Lead Engineer | JESORA TECH`
        },
        {
          stepNumber: 6,
          delayDays: 4,
          purpose: 'Graceful break-up & long-term founder connection',
          subjectTemplate: 'Permission to archive {{companyName}}\'s concept prototype?',
          bodyTemplate: `Hi {{contactName}},

I haven't heard back, so I assume modernizing the web platform or custom software is not on {{companyName}}'s priority list right now.

I will safely archive the concept preview so I don't clutter your inbox further. If your engineering needs ever expand or you need an agile dev team for an urgent sprint, feel free to reach out anytime: techjesora@gmail.com | jesoratech.com

Wishing you and {{companyName}} immense growth!

Warm regards,
Rajan Thakulla
JESORA TECH`
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const enterpriseSeq: EmailSequence = {
      id: 'seq-enterprise-automation',
      name: 'Jesora Tech Enterprise ERP, CRM & Workflow Automation Sequence',
      description: '5-touch high-converting sequence for mid-market retail, healthcare, clinics, logistics, and education businesses needing bespoke workflow automation, internal tools, and high-performance ERP portals.',
      targetAudience: 'Operations Heads, Managing Directors, and Retail/Healthcare executives seeking custom internal software, automated operations, and zero recurring SaaS license fees',
      steps: [
        {
          stepNumber: 1,
          delayDays: 0,
          purpose: 'Operational overhead identification & custom ERP solution',
          subjectTemplate: 'Automating {{companyName}}\'s internal workflows & database operations',
          bodyTemplate: `Hi {{contactName}},

Most growing organizations in {{industry}} reach a threshold where off-the-shelf software and manual spreadsheets become a bottleneck: fragmented records, slow customer response times, and recurring SaaS subscription fees.

At JESORA TECH (jesoratech.com), we architect bespoke, lightweight Cloud ERPs, booking portals, and internal workflow tools tailored 100% to your exact business rules:

• Centralized operations dashboard for {{companyName}}
• Real-time database synchronizing customer inquiries, appointments, and inventory
• Automated WhatsApp & Email notifications triggered on key operational events
• 100% Source Code Ownership with zero recurring per-user SaaS license fees

We've recently engineered custom platforms like MotoFix (motohubfix.vercel.app) to automate live service queues and customer scheduling end-to-end.

Would you be open to a 10-minute discovery call to see where {{companyName}} could eliminate 10+ hours of manual administrative overhead each week?

Best regards,
Rajan Thakulla
Lead Engineer | JESORA TECH
techjesora@gmail.com | jesoratech.com`
        },
        {
          stepNumber: 2,
          delayDays: 3,
          purpose: 'Case study teardown & operational time-savings',
          subjectTemplate: 'How automated queue systems eliminated 15+ hours/wk of manual admin',
          bodyTemplate: `Hi {{contactName}},

Following up on my message regarding workflow automation for {{companyName}}.

To see how this works in practice: we engineered MotoFix (motohubfix.vercel.app), a live workshop booking and queue management system. Before the platform, customer check-ins and job statuses were tracked manually on whiteboards and phone calls.

The automated system introduced:
• Instant customer self-booking and real-time bay queue tracking
• Automated service milestones and digital invoice generation
• Complete cloud-backed database accessible across desktop and mobile

We build and deploy these enterprise tools in 2 to 4-week agile sprints, transferring 100% full source code ownership directly to your company.

Would this Thursday or Friday work for a brief 10-minute introductory call?
{{calendarBookingUrl}}

Warm regards,
Rajan Thakulla | JESORA TECH`
        },
        {
          stepNumber: 3,
          delayDays: 3,
          purpose: 'SaaS subscription cost comparison vs owned bespoke asset',
          subjectTemplate: 'The hidden cost of SaaS subscription tax on {{companyName}}',
          bodyTemplate: `Hi {{contactName}},

A quick financial observation we frequently discuss with operations leaders in {{industry}}:

Off-the-shelf enterprise software often costs $300 to $1,500+ every single month in "per-seat" licensing, yet you're forced to adapt your business around their rigid limitations — and the moment you cancel, you lose everything.

With JESORA TECH, you invest once in a custom Next.js/PostgreSQL web application designed precisely for {{companyName}}:
1. Zero per-user monthly seat licenses.
2. Complete data privacy and sovereignty hosted on your own cloud.
3. Custom workflows and integrations that fit your exact business process.

Would you like us to put together a high-level feasibility outline showing what a custom portal for {{companyName}} would look like?

Best,
Rajan Thakulla
JESORA TECH | jesoratech.com`
        },
        {
          stepNumber: 4,
          delayDays: 3,
          purpose: 'Complimentary system design & ERD architecture map',
          subjectTemplate: 'Complimentary database schema & workflow blueprint for {{companyName}}',
          bodyTemplate: `Hi {{contactName}},

To help you evaluate whether modernizing {{companyName}}'s operational software is feasible this quarter, our architecture team would be happy to draft a complimentary Database & Workflow Architecture Blueprint for you.

This includes:
• Entity Relationship Diagram (ERD) mapping your core data entities
• API integration plan for WhatsApp, Email, Payment, or Accounting gateways
• Phased 2-week sprint implementation roadmap with transparent fixed milestones

No commitment or cost — the blueprint is yours to keep and review with your team.

If you'd like us to prepare this, feel free to book 15 minutes with our lead engineers here:
{{calendarBookingUrl}}

Best regards,
Rajan Thakulla
JESORA TECH`
        },
        {
          stepNumber: 5,
          delayDays: 5,
          purpose: 'Graceful break-up & direct founder rolodex connection',
          subjectTemplate: 'Closing the file on {{companyName}}\'s workflow architecture',
          bodyTemplate: `Hi {{contactName}},

Since we haven't connected, I assume workflow automation and custom operational software are not an immediate priority for {{companyName}} at this moment.

I'm closing out this file so I don't take up any more room in your inbox.

If you ever need an agile full-stack engineering team to build a custom internal tool, ERP, or web platform with 100% code ownership, you have my direct email: techjesora@gmail.com | jesoratech.com.

Wishing you and the entire {{companyName}} team continued success!

Warm regards,
Rajan Thakulla
Founder & Lead Engineer | JESORA TECH`
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.insertSequence(defaultSeq);
    this.insertSequence(enterpriseSeq);

    try {
      this.db.prepare("UPDATE campaigns SET sequence_id = 'seq-enterprise-automation' WHERE id = 'camp-enterprise-erp-retail' AND sequence_id = 'seq-jesora-fullstack'").run();
    } catch {}
  }

  // --- Defaults Seed ---
  private seedDefaultsIfEmpty(): void {
    const campaignCount = (this.db.prepare('SELECT COUNT(*) as c FROM campaigns').get() as any).c;
    if (campaignCount > 0) return;

    // Seed default Campaigns
    const now = new Date().toISOString();
    const campaign1: Campaign = {
      id: 'camp-global-startups',
      name: 'Global Startups & SaaS MVP Development',
      description: 'Outreach to early-stage and growth startups seeking agile full-stack engineers with 100% code handover',
      targetNiche: 'SaaS, Startups, Web Platforms',
      targetLocations: ['US', 'UK', 'Australia', 'Canada', 'Singapore'],
      keywords: ['SaaS', 'MVP', 'Next.js', 'React', 'Mobile App', 'Founder'],
      status: 'active',
      sequenceId: 'seq-jesora-fullstack',
      dailyLimit: 35,
      leadsTargeted: 0,
      leadsContacted: 0,
      leadsReplied: 0,
      meetingsBooked: 0,
      createdAt: now,
      updatedAt: now
    };

    const campaign2: Campaign = {
      id: 'camp-enterprise-erp-retail',
      name: 'Enterprise ERP & High-Conversion E-Commerce',
      description: 'Reaching mid-market retail, logistics, healthcare, and education businesses needing workflow automation and ERPs',
      targetNiche: 'Enterprise ERP, Retail, Healthcare, EdTech',
      targetLocations: ['Nepal', 'India', 'Middle East', 'Global'],
      keywords: ['ERP', 'CRM', 'E-Commerce', 'Inventory', 'Clinic Management', 'School LMS'],
      status: 'active',
      sequenceId: 'seq-enterprise-automation',
      dailyLimit: 25,
      leadsTargeted: 0,
      leadsContacted: 0,
      leadsReplied: 0,
      meetingsBooked: 0,
      createdAt: now,
      updatedAt: now
    };

    this.insertCampaign(campaign1);
    this.insertCampaign(campaign2);

    // Seed initial agents telemetry
    const initialAgents: AgentTelemetry[] = [
      {
        agentId: 'lead_scout',
        name: 'Lead Scout Agent',
        role: 'Prospecting & Market Intelligence',
        description: 'Continuously hunts high-fit companies, scrapes domains, scores tech gaps, and extracts verified contact details.',
        status: 'idle',
        totalRuns: 0,
        totalActions: 0,
        currentTask: 'Standing by for scheduled discovery run'
      },
      {
        agentId: 'website_verifier',
        name: 'Website Presence Verifier Agent',
        role: 'Live Domain & HTTP Availability Verifier',
        description: 'Pings domains, verifies live DNS & SSL connectivity, detects parked domains, and discards businesses without working websites.',
        status: 'idle',
        totalRuns: 0,
        totalActions: 0,
        currentTask: 'Standing by to verify discovered domains'
      },
      {
        agentId: 'site_auditor',
        name: 'Site Flaw & Diagnostics Agent',
        role: 'Technical Audit & Flaw Hunter',
        description: 'Performs deep website audits on verified domains: benchmarks latency/TTFB, finds UI/UX flaws, audits security headers, and compiles structured diagnostic reports.',
        status: 'idle',
        totalRuns: 0,
        totalActions: 0,
        currentTask: 'Standing by for deep website flaw analysis'
      },
      {
        agentId: 'pitch_crafter',
        name: 'Pitch Crafter Agent',
        role: 'AI Personalization & Sequence Architecture',
        description: 'Synthesizes company intelligence, matches Jesora Tech case studies, and drafts anti-spam, highly targeted outreach.',
        status: 'idle',
        totalRuns: 0,
        totalActions: 0,
        currentTask: 'Waiting for qualified leads to sequence'
      },
      {
        agentId: 'dispatcher',
        name: 'Outreach Dispatcher Agent',
        role: 'Email Delivery & Warm-up Throttler',
        description: 'Enforces daily send quotas, human-like random pacing, timezone filtering, and SMTP delivery.',
        status: 'idle',
        totalRuns: 0,
        totalActions: 0,
        currentTask: 'Monitoring message queue'
      },
      {
        agentId: 'inbox_monitor',
        name: 'Inbox Sentinel & Sentiment Agent',
        role: '24x7 Inbound Listening & AI Classification',
        description: 'Scans replies in real time, classifies intent (Hot Lead, Meeting, Question, Unsubscribe), and alerts the team.',
        status: 'idle',
        totalRuns: 0,
        totalActions: 0,
        currentTask: 'Polling inbox for prospective client responses'
      },
      {
        agentId: 'meeting_closer',
        name: 'Meeting Closer & Scheduler Agent',
        role: 'Calendar Orchestration & Executive Briefs',
        description: 'Proposes meeting times, syncs calendar links, and generates client intelligence dossiers before discovery calls.',
        status: 'idle',
        totalRuns: 0,
        totalActions: 0,
        currentTask: 'Ready to convert interested leads into booked meetings'
      },
      {
        agentId: 'notification_sentinel',
        name: 'Notification Sentinel Agent',
        role: 'Real-time Alert Dispatcher',
        description: 'Pushes instant notifications via Telegram, Webhook, and Dashboard live stream for hot replies and booked calls.',
        status: 'idle',
        totalRuns: 0,
        totalActions: 0,
        currentTask: 'Connected to notification channels'
      }
    ];

    for (const a of initialAgents) {
      this.upsertAgentTelemetry(a);
    }
  }
}
