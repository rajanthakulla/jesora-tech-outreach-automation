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
    return {
      smtp: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        user: process.env.SMTP_USER || 'techjesora@gmail.com',
        pass: process.env.SMTP_PASS || '',
        fromName: 'JESORA TECH Team',
        fromEmail: 'techjesora@gmail.com',
        dryRun: true // Default safe simulation mode so user can test immediately without accidental spam
      },
      imap: {
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: 993,
        user: process.env.IMAP_USER || 'techjesora@gmail.com',
        pass: process.env.IMAP_PASS || '',
        enabled: false
      },
      ai: {
        provider: 'builtin',
        apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
        modelName: 'gemini-1.5-flash'
      },
      telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        enabled: false,
        notifyOnHotLead: true,
        notifyOnMeeting: true,
        notifyOnSend: false
      },
      pacing: {
        maxEmailsPerDay: 40,
        minDelayMinutesBetweenSends: 8,
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
        calendarBookingUrl: 'https://calendly.com/jesoratech/intro-call',
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
      country: r.country,
      techStack: r.tech_stack || undefined,
      painPoints: r.pain_points || undefined,
      score: r.score,
      status: r.status,
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
        email, phone, country, tech_stack, pain_points, score, status,
        notes, campaign_id, current_sequence_step, last_contacted_at,
        next_follow_up_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      lead.country,
      lead.techStack || null,
      lead.painPoints || null,
      lead.score,
      lead.status,
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
        contact_title = ?, email = ?, phone = ?, country = ?, tech_stack = ?,
        pain_points = ?, score = ?, status = ?, notes = ?, campaign_id = ?,
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
      merged.country,
      merged.techStack || null,
      merged.painPoints || null,
      merged.score,
      merged.status,
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

  public insertSequence(seq: EmailSequence): void {
    const stmt = this.db.prepare(`
      INSERT INTO sequences (id, name, description, target_audience, steps_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
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

  // --- Defaults Seed ---
  private seedDefaultsIfEmpty(): void {
    const campaignCount = (this.db.prepare('SELECT COUNT(*) as c FROM campaigns').get() as any).c;
    if (campaignCount > 0) return;

    // Seed default Sequence
    const defaultSeq: EmailSequence = {
      id: 'seq-jesora-fullstack',
      name: 'Jesora Tech High-Value Engineering Outreach',
      description: '4-touch consultative sequence highlighting 100% source code ownership and proven SaaS/ERP case studies',
      targetAudience: 'Startups, Agencies, Mid-market businesses looking for tech dev partners',
      steps: [
        {
          stepNumber: 1,
          delayDays: 0,
          purpose: 'Initial consultative angle & tech stack audit',
          subjectTemplate: 'Quick question regarding {{companyName}}\'s software roadmap',
          bodyTemplate: `Hi {{contactName}},

I noticed your work at {{companyName}} in the {{industry}} space. 

At JESORA TECH (jesoratech.com), we partner with ambitious companies to build high-performance custom web applications, mobile apps, and scalable cloud systems. 

Unlike typical agencies that lock you in, we provide:
• 100% full source code ownership handed directly to you
• Agile 2-week sprints with demonstrable milestone demos
• Production-grade engineering with Next.js, React, Node.js, and Python at a 40-60% cost efficiency

Recently, we engineered WriteWell (an AI SaaS platform with real-time text processing) and MotoFix (a live workshop service & booking system).

Would you be open to a 10-minute introductory call this week to see if we might be a strong engineering fit for {{companyName}}?

Best regards,
Rajan Thakulla & The JESORA TECH Team
Kathmandu, Nepal | techjesora@gmail.com | jesoratech.com`
        },
        {
          stepNumber: 2,
          delayDays: 3,
          purpose: 'Case study proof & technical capability showcase',
          subjectTemplate: 'Re: Quick question regarding {{companyName}}\'s software roadmap',
          bodyTemplate: `Hi {{contactName}},

Following up briefly on my previous note. 

I wanted to share a relevant case study: we recently engineered WriteWell (writewell.space), an AI writing refinement SaaS with zero latency and high retention, along with custom cloud ERP platforms for growing enterprises.

Whether you are looking to build a new MVP, modernize an existing legacy platform, or scale your backend architecture, our team handles end-to-end design, code, and 24/7 SLA maintenance.

Do you have 10 minutes on Thursday or Friday for a quick chat?

You can also book directly at our calendar if convenient:
{{calendarBookingUrl}}

Warm regards,
JESORA TECH Solutions Team`
        },
        {
          stepNumber: 3,
          delayDays: 4,
          purpose: 'Value offering: Free discovery & technical architecture scope',
          subjectTemplate: 'Free technical architecture & feasibility audit for {{companyName}}',
          bodyTemplate: `Hi {{contactName}},

I know you have a busy schedule leading {{companyName}}. 

To make this completely risk-free for you, we would love to offer a free 30-minute discovery & architectural review of your upcoming web/software roadmap. 

Our senior architects will review your requirements, suggest an optimal tech stack, and deliver a transparent milestone estimation — zero obligations.

Let me know if this sounds helpful, or feel free to pick a time here:
{{calendarBookingUrl}}

Best,
JESORA TECH Engineering Team`
        },
        {
          stepNumber: 4,
          delayDays: 5,
          purpose: 'Graceful break-up & long-term connection',
          subjectTemplate: 'Permission to close {{companyName}}\'s file for now?',
          bodyTemplate: `Hi {{contactName}},

I haven't heard back, so I assume custom software or web engineering is not a top priority for {{companyName}} right now.

I won't clutter your inbox further. If your engineering needs ever expand or you need a reliable dev team for a sprint, feel free to keep our site handy: https://jesoratech.com

Wishing you and {{companyName}} continued success!

Best regards,
Rajan Thakulla
JESORA TECH | Tinkune, Kathmandu`
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.insertSequence(defaultSeq);

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
      sequenceId: defaultSeq.id,
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
      sequenceId: defaultSeq.id,
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

    // Seed sample initial prospective leads to immediately demonstrate the pipeline
    const sampleLeads: Lead[] = [
      {
        id: 'lead-sample-1',
        companyName: 'Apex Health Systems',
        website: 'https://apexhealth-example.com',
        industry: 'Healthcare & MedTech',
        contactName: 'Dr. Sarah Jenkins',
        contactTitle: 'Chief Medical Officer',
        email: 'sarah.jenkins@apexhealth-example.com',
        country: 'United States',
        techStack: 'Legacy WordPress, slow page speed (4.2s), missing patient portal',
        painPoints: 'Needs HIPAA-compliant digital patient portal and automated consultation scheduling',
        score: 92,
        status: 'discovered',
        campaignId: 'camp-enterprise-erp-retail',
        currentSequenceStep: 0,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'lead-sample-2',
        companyName: 'Veloce Logistics Corp',
        website: 'https://velocelogistics-demo.com',
        industry: 'Logistics & Supply Chain',
        contactName: 'Marcus Chen',
        contactTitle: 'Head of Operations',
        email: 'marcus.chen@velocelogistics-demo.com',
        country: 'Singapore',
        techStack: 'Manual spreadsheets, no driver mobile app',
        painPoints: 'Real-time GPS fleet tracking, dispatch routing automation, warehouse sync',
        score: 88,
        status: 'scouted',
        campaignId: 'camp-enterprise-erp-retail',
        currentSequenceStep: 0,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'lead-sample-3',
        companyName: 'Aura Bloom Cosmetics',
        website: 'https://aurabloom-demo.com',
        industry: 'Retail & E-Commerce',
        contactName: 'Elena Rostova',
        contactTitle: 'E-Commerce Director',
        email: 'elena@aurabloom-demo.com',
        country: 'United Kingdom',
        techStack: 'Shopify basic theme, high cart abandonment, unoptimized checkout',
        painPoints: 'Custom headless storefront, multi-currency checkout, salon booking integration',
        score: 85,
        status: 'discovered',
        campaignId: 'camp-global-startups',
        currentSequenceStep: 0,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'lead-sample-4',
        companyName: 'Hyperion AI Labs',
        website: 'https://hyperion-ai-demo.io',
        industry: 'AI & SaaS Startup',
        contactName: 'David Vance',
        contactTitle: 'Co-Founder & CEO',
        email: 'david@hyperion-ai-demo.io',
        country: 'Canada',
        techStack: 'Python backend, lacking modern frontend UI and user dashboard',
        painPoints: 'Needs full Next.js responsive web app with Stripe billing and interactive data graphs',
        score: 95,
        status: 'discovered',
        campaignId: 'camp-global-startups',
        currentSequenceStep: 0,
        createdAt: now,
        updatedAt: now
      }
    ];

    for (const lead of sampleLeads) {
      this.insertLead(lead);
    }
  }
}
