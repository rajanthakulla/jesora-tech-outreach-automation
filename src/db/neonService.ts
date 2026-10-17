import pg from 'pg';
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

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export function getNeonPool(): pg.Pool {
  if (poolInstance) return poolInstance;

  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_URL environment variable is required to connect to Neon PostgreSQL.');
  }

  poolInstance = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  return poolInstance;
}

export class NeonDatabase {
  private get pool(): pg.Pool {
    return getNeonPool();
  }

  // --- Settings ---
  public async getSettings(): Promise<SystemSettings> {
    const res = await this.pool.query('SELECT value FROM settings WHERE key = $1', ['system_settings']);
    if (res.rows.length > 0) {
      try {
        return JSON.parse(res.rows[0].value) as SystemSettings;
      } catch {}
    }

    return {
      smtp: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        fromName: process.env.FROM_NAME || 'Rajan Thakulla | JESORA TECH',
        fromEmail: process.env.FROM_EMAIL || 'rajanthakulla@jesoratech.com',
        dryRun: false
      },
      imap: {
        host: process.env.IMAP_HOST || 'imap.gmail.com',
        port: Number(process.env.IMAP_PORT) || 993,
        user: process.env.IMAP_USER || '',
        pass: process.env.IMAP_PASS || '',
        enabled: true
      },
      ai: {
        provider: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || '',
        modelName: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
      },
      telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        enabled: true,
        notifyOnHotLead: true,
        notifyOnMeeting: true,
        notifyOnSend: false
      },
      pacing: {
        maxEmailsPerDay: 45,
        minDelayMinutesBetweenSends: 15,
        businessHoursOnly: true,
        businessHoursStart: 8,
        businessHoursEnd: 18,
        timezone: 'UTC'
      },
      autonomous: {
        enabled: true,
        cycleIntervalMinutes: 30,
        autoReplyInterested: true,
        requireApprovalForMeetings: false
      },
      jesoraProfile: {
        companyName: 'JESORA TECH',
        tagline: 'High-Impact Web Applications, Cloud Scalability & Intelligent Systems',
        siteUrl: 'https://jesoratech.com',
        headquarters: 'Global Engineering Headquarters · Kathmandu & London',
        contactEmail: 'contact@jesoratech.com',
        contactPhone: '+977 9800000000',
        calendarBookingUrl: 'https://calendly.com/jesoratech/strategy',
        keySellingPoints: [
          'Enterprise Next.js, React, Node.js & Python full-stack engineering',
          'Production-grade architecture with zero tech debt and sub-1s Core Web Vitals',
          'Bespoke multi-agent automation fleets reducing operational costs by 65%'
        ],
        caseStudies: [
          {
            title: 'SaaS Platform Modernization',
            category: 'Full-Stack Architecture',
            url: 'https://jesoratech.com/work/saas-platform',
            highlight: 'Refactored legacy monolith into Next.js + Microservices; 4x faster load speeds.'
          },
          {
            title: 'Autonomous Workflow Engine',
            category: 'AI & Systems Engineering',
            url: 'https://jesoratech.com/work/workflow-engine',
            highlight: 'Designed 24x7 intelligent pipeline eliminating 120 hrs/week manual operations.'
          }
        ]
      }
    };
  }

  public async saveSettings(settings: SystemSettings): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3`,
      ['system_settings', JSON.stringify(settings), now]
    );
  }

  // --- Leads CRUD ---
  public async getAllLeads(statusFilter?: string): Promise<Lead[]> {
    let query = 'SELECT * FROM leads ORDER BY created_at DESC';
    let params: any[] = [];
    if (statusFilter && statusFilter !== 'all') {
      query = 'SELECT * FROM leads WHERE status = $1 ORDER BY created_at DESC';
      params = [statusFilter];
    }
    const res = await this.pool.query(query, params);
    return res.rows.map(r => this.mapLeadRow(r));
  }

  public async getLeadById(id: string): Promise<Lead | null> {
    const res = await this.pool.query('SELECT * FROM leads WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapLeadRow(res.rows[0]);
  }

  public async getLeadByEmail(email: string): Promise<Lead | null> {
    const res = await this.pool.query('SELECT * FROM leads WHERE LOWER(email) = LOWER($1)', [email]);
    if (res.rows.length === 0) return null;
    return this.mapLeadRow(res.rows[0]);
  }

  public async insertLead(lead: Lead): Promise<void> {
    await this.pool.query(
      `INSERT INTO leads (
        id, company_name, website, industry, contact_name, contact_title,
        email, phone, country, tech_stack, pain_points, score, status,
        notes, campaign_id, current_sequence_step, address, website_verified,
        flaw_report_json, last_contacted_at, next_follow_up_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      ON CONFLICT (id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        website = EXCLUDED.website,
        industry = EXCLUDED.industry,
        contact_name = EXCLUDED.contact_name,
        contact_title = EXCLUDED.contact_title,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        country = EXCLUDED.country,
        tech_stack = EXCLUDED.tech_stack,
        pain_points = EXCLUDED.pain_points,
        score = EXCLUDED.score,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        campaign_id = EXCLUDED.campaign_id,
        current_sequence_step = EXCLUDED.current_sequence_step,
        address = EXCLUDED.address,
        website_verified = EXCLUDED.website_verified,
        flaw_report_json = EXCLUDED.flaw_report_json,
        last_contacted_at = EXCLUDED.last_contacted_at,
        next_follow_up_at = EXCLUDED.next_follow_up_at,
        updated_at = EXCLUDED.updated_at`,
      [
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
        lead.address || null,
        lead.websiteVerified ? 1 : 0,
        lead.flawReport ? JSON.stringify(lead.flawReport) : null,
        lead.lastContactedAt || null,
        lead.nextFollowUpAt || null,
        lead.createdAt,
        lead.updatedAt
      ]
    );
  }

  public async updateLead(id: string, updates: Partial<Lead>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.companyName !== undefined) { fields.push(`company_name = $${idx++}`); values.push(updates.companyName); }
    if (updates.website !== undefined) { fields.push(`website = $${idx++}`); values.push(updates.website); }
    if (updates.industry !== undefined) { fields.push(`industry = $${idx++}`); values.push(updates.industry); }
    if (updates.contactName !== undefined) { fields.push(`contact_name = $${idx++}`); values.push(updates.contactName); }
    if (updates.contactTitle !== undefined) { fields.push(`contact_title = $${idx++}`); values.push(updates.contactTitle); }
    if (updates.email !== undefined) { fields.push(`email = $${idx++}`); values.push(updates.email); }
    if (updates.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(updates.phone); }
    if (updates.address !== undefined) { fields.push(`address = $${idx++}`); values.push(updates.address); }
    if (updates.country !== undefined) { fields.push(`country = $${idx++}`); values.push(updates.country); }
    if (updates.techStack !== undefined) { fields.push(`tech_stack = $${idx++}`); values.push(updates.techStack); }
    if (updates.painPoints !== undefined) { fields.push(`pain_points = $${idx++}`); values.push(updates.painPoints); }
    if (updates.score !== undefined) { fields.push(`score = $${idx++}`); values.push(updates.score); }
    if (updates.status !== undefined) { fields.push(`status = $${idx++}`); values.push(updates.status); }
    if (updates.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(updates.notes); }
    if (updates.campaignId !== undefined) { fields.push(`campaign_id = $${idx++}`); values.push(updates.campaignId); }
    if (updates.currentSequenceStep !== undefined) { fields.push(`current_sequence_step = $${idx++}`); values.push(updates.currentSequenceStep); }
    if (updates.websiteVerified !== undefined) { fields.push(`website_verified = $${idx++}`); values.push(updates.websiteVerified ? 1 : 0); }
    if (updates.flawReport !== undefined) { fields.push(`flaw_report_json = $${idx++}`); values.push(JSON.stringify(updates.flawReport)); }
    if (updates.lastContactedAt !== undefined) { fields.push(`last_contacted_at = $${idx++}`); values.push(updates.lastContactedAt); }
    if (updates.nextFollowUpAt !== undefined) { fields.push(`next_follow_up_at = $${idx++}`); values.push(updates.nextFollowUpAt); }

    fields.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());

    values.push(id);
    await this.pool.query(
      `UPDATE leads SET ${fields.join(', ')} WHERE id = $${idx}`,
      values
    );
  }

  public async deleteLead(id: string): Promise<void> {
    await this.pool.query('DELETE FROM messages WHERE lead_id = $1', [id]);
    await this.pool.query('DELETE FROM replies WHERE lead_id = $1', [id]);
    await this.pool.query('DELETE FROM meetings WHERE lead_id = $1', [id]);
    await this.pool.query('DELETE FROM leads WHERE id = $1', [id]);
  }

  // --- Campaigns CRUD ---
  public async getAllCampaigns(): Promise<Campaign[]> {
    const res = await this.pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
    return res.rows.map(r => this.mapCampaignRow(r));
  }

  public async getCampaignById(id: string): Promise<Campaign | null> {
    const res = await this.pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapCampaignRow(res.rows[0]);
  }

  public async insertCampaign(campaign: Campaign): Promise<void> {
    await this.pool.query(
      `INSERT INTO campaigns (
        id, name, description, target_niche, target_locations, keywords,
        status, sequence_id, daily_limit, leads_targeted, leads_contacted,
        leads_replied, meetings_booked, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        target_niche = EXCLUDED.target_niche,
        target_locations = EXCLUDED.target_locations,
        keywords = EXCLUDED.keywords,
        status = EXCLUDED.status,
        sequence_id = EXCLUDED.sequence_id,
        daily_limit = EXCLUDED.daily_limit,
        updated_at = EXCLUDED.updated_at`,
      [
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
      ]
    );
  }

  // --- Sequences CRUD ---
  public async getAllSequences(): Promise<EmailSequence[]> {
    const res = await this.pool.query('SELECT * FROM sequences ORDER BY created_at ASC');
    return res.rows.map(r => this.mapSequenceRow(r));
  }

  public async getSequenceById(id: string): Promise<EmailSequence | null> {
    const res = await this.pool.query('SELECT * FROM sequences WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapSequenceRow(res.rows[0]);
  }

  public async insertSequence(sequence: EmailSequence): Promise<void> {
    await this.pool.query(
      `INSERT INTO sequences (id, name, description, target_audience, steps_json, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         target_audience = EXCLUDED.target_audience,
         steps_json = EXCLUDED.steps_json,
         updated_at = EXCLUDED.updated_at`,
      [
        sequence.id,
        sequence.name,
        sequence.description,
        sequence.targetAudience,
        JSON.stringify(sequence.steps),
        sequence.createdAt,
        sequence.updatedAt
      ]
    );
  }

  // --- Messages CRUD ---
  public async getRecentMessages(limit: number = 100): Promise<OutreachMessage[]> {
    const res = await this.pool.query('SELECT * FROM messages ORDER BY scheduled_for DESC LIMIT $1', [limit]);
    return res.rows.map(r => this.mapMessageRow(r));
  }

  public async getMessagesForLead(leadId: string): Promise<OutreachMessage[]> {
    const res = await this.pool.query('SELECT * FROM messages WHERE lead_id = $1 ORDER BY sequence_step_number ASC', [leadId]);
    return res.rows.map(r => this.mapMessageRow(r));
  }

  public async insertMessage(msg: OutreachMessage): Promise<void> {
    await this.pool.query(
      `INSERT INTO messages (
        id, lead_id, campaign_id, sequence_step_number, subject, body,
        status, scheduled_for, sent_at, delivered_at, opened_at, replied_at,
        error_message, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO NOTHING`,
      [
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
      ]
    );
  }

  // --- Replies & Meetings ---
  public async getAllReplies(): Promise<InboundReply[]> {
    const res = await this.pool.query('SELECT * FROM replies ORDER BY received_at DESC');
    return res.rows.map(r => ({
      id: r.id,
      leadId: r.lead_id,
      outreachMessageId: r.outreach_message_id || undefined,
      fromEmail: r.from_email,
      subject: r.subject,
      body: r.body,
      sentiment: r.sentiment,
      sentimentConfidence: Number(r.sentiment_confidence) || 0.9,
      aiSummary: r.ai_summary,
      aiSuggestedReply: r.ai_suggested_reply,
      status: r.status,
      receivedAt: r.received_at,
      repliedAt: r.replied_at || undefined
    }));
  }

  public async insertReply(reply: InboundReply): Promise<void> {
    await this.pool.query(
      `INSERT INTO replies (
        id, lead_id, outreach_message_id, from_email, subject, body,
        sentiment, sentiment_confidence, ai_summary, ai_suggested_reply,
        status, received_at, replied_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO NOTHING`,
      [
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
      ]
    );
  }

  public async getAllMeetings(): Promise<Meeting[]> {
    const res = await this.pool.query('SELECT * FROM meetings ORDER BY start_time ASC');
    return res.rows.map(r => ({
      id: r.id,
      leadId: r.lead_id,
      scheduledTime: r.start_time || r.created_at,
      durationMinutes: 30,
      meetUrl: r.meet_url || 'https://meet.google.com/jesora-strategy',
      agenda: r.description || r.title || 'Technical Architecture Strategy Session',
      status: r.status,
      executiveBrief: r.executive_brief || undefined,
      createdAt: r.created_at
    }));
  }

  // --- Agent Telemetry & Logs ---
  public async getAllAgentTelemetry(): Promise<AgentTelemetry[]> {
    const res = await this.pool.query('SELECT * FROM agent_telemetry ORDER BY agent_id ASC');
    return res.rows.map(r => ({
      agentId: r.agent_id as AgentRole,
      name: r.name,
      role: r.role,
      description: r.description,
      status: r.status,
      lastRunAt: r.last_run_at || undefined,
      nextRunAt: r.next_run_at || undefined,
      totalRuns: r.total_runs || 0,
      totalActions: r.total_actions || 0,
      currentTask: r.current_task || 'Idle',
      lastErrorMessage: r.last_error_message || undefined
    }));
  }

  public async getRecentLogs(limit: number = 100): Promise<AgentLog[]> {
    const res = await this.pool.query('SELECT * FROM agent_logs ORDER BY timestamp DESC LIMIT $1', [limit]);
    return res.rows.map(r => {
      let details: any = undefined;
      try {
        if (r.details_json) details = JSON.parse(r.details_json);
      } catch {}
      return {
        id: r.id,
        agentId: r.agent_id as any,
        level: r.level,
        message: r.message,
        details,
        timestamp: r.timestamp
      };
    });
  }

  public async insertAgentLog(log: AgentLog): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_logs (id, agent_id, level, message, details_json, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        log.id,
        log.agentId,
        log.level,
        log.message,
        log.details ? JSON.stringify(log.details) : null,
        log.timestamp
      ]
    );
  }

  // --- Pipeline Statistics ---
  public async getPipelineStats(): Promise<PipelineStats> {
    const [leadsRes, msgsRes, campRes] = await Promise.all([
      this.pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status IN ('scouted', 'website_verified', 'audited') THEN 1 END) as scouted,
          COUNT(CASE WHEN status = 'contacted' THEN 1 END) as contacted,
          COUNT(CASE WHEN status = 'replied' THEN 1 END) as replied,
          COUNT(CASE WHEN status = 'meeting_scheduled' THEN 1 END) as meetings,
          COUNT(CASE WHEN status = 'unsubscribed' THEN 1 END) as unsubscribed
        FROM leads
      `),
      this.pool.query("SELECT COUNT(*) as sent FROM messages WHERE status IN ('sent', 'delivered', 'opened', 'replied')"),
      this.pool.query("SELECT COUNT(*) as active FROM campaigns WHERE status = 'active'")
    ]);

    const l = leadsRes.rows[0];
    const totalLeads = Number(l.total) || 0;
    const scoutedLeads = Number(l.scouted) || 0;
    const contactedLeads = Number(l.contacted) || 0;
    const repliedLeads = Number(l.replied) || 0;
    const meetingsBooked = Number(l.meetings) || 0;
    const unsubscribedLeads = Number(l.unsubscribed) || 0;
    const totalEmailsSent = Number(msgsRes.rows[0]?.sent) || 0;
    const activeCampaigns = Number(campRes.rows[0]?.active) || 0;

    const replyRatePercent = contactedLeads > 0 ? Number(((repliedLeads / contactedLeads) * 100).toFixed(1)) : 0;
    const conversionRatePercent = contactedLeads > 0 ? Number(((meetingsBooked / contactedLeads) * 100).toFixed(1)) : 0;

    return {
      totalLeads,
      scoutedLeads,
      contactedLeads,
      repliedLeads,
      meetingsBooked,
      unsubscribedLeads,
      totalEmailsSent,
      activeCampaigns,
      replyRatePercent,
      conversionRatePercent
    };
  }

  // --- Private Mappers ---
  private mapLeadRow(r: any): Lead {
    let flawReport: any = undefined;
    if (r.flaw_report_json) {
      try { flawReport = JSON.parse(r.flaw_report_json); } catch {}
    }
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
      flawReport,
      notes: r.notes || undefined,
      campaignId: r.campaign_id || undefined,
      currentSequenceStep: r.current_sequence_step,
      lastContactedAt: r.last_contacted_at || undefined,
      nextFollowUpAt: r.next_follow_up_at || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  private mapCampaignRow(r: any): Campaign {
    let targetLocations: string[] = [];
    let keywords: string[] = [];
    try { targetLocations = JSON.parse(r.target_locations); } catch {}
    try { keywords = JSON.parse(r.keywords); } catch {}
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      targetNiche: r.target_niche,
      targetLocations,
      keywords,
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

  private mapSequenceRow(r: any): EmailSequence {
    let steps: any[] = [];
    try { steps = JSON.parse(r.steps_json); } catch {}
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      targetAudience: r.target_audience,
      steps,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  private mapMessageRow(r: any): OutreachMessage {
    return {
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
    };
  }
}
