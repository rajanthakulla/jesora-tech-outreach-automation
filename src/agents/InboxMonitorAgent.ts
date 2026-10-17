import { BaseAgent } from './BaseAgent.js';
import { AppDatabase } from '../db/database.js';
import { InboundReply, ReplySentiment, Lead } from '../types/index.js';
import crypto from 'node:crypto';

export class InboxMonitorAgent extends BaseAgent {
  constructor(db: AppDatabase) {
    super(
      'inbox_monitor',
      'Inbox Sentinel & Sentiment Agent',
      '24x7 Inbound Listening & AI Intent Classifier',
      'Monitors incoming prospect responses, runs sentiment classification, handles unsubscribes, and triggers instant hot-lead alerts.',
      db
    );
  }

  protected async executeCycle(): Promise<{ actionsTaken: number; message: string }> {
    this.setTask('Scanning inbox for prospective client replies...');
    const settings = this.db.getSettings();

    // If IMAP is enabled and credentials configured, real IMAP polling can occur.
    // In default or simulation mode, check pending replies or process queue.
    const pendingReplies = this.db.getAllReplies().filter(r => r.status === 'pending_review');
    
    return {
      actionsTaken: pendingReplies.length,
      message: `Monitoring active. ${pendingReplies.length} reply thread(s) pending review.`
    };
  }

  /**
   * Ingests and processes an incoming message from a prospect (via IMAP, Webhook, or Test Simulator)
   */
  public async ingestIncomingReply(payload: {
    fromEmail: string;
    subject: string;
    body: string;
    outreachMessageId?: string;
  }): Promise<InboundReply> {
    this.setTask(`Analyzing incoming message from ${payload.fromEmail}...`);

    let lead = this.db.getLeadByEmail(payload.fromEmail);

    // If lead not found by exact email, check by domain
    if (!lead) {
      const domain = payload.fromEmail.split('@')[1];
      const allLeads = this.db.getAllLeads();
      lead = allLeads.find(l => l.email.includes(domain) || l.website.includes(domain)) || null;
    }

    // If still not found, create a prospect on the fly
    if (!lead) {
      lead = {
        id: `lead-inbound-${crypto.randomUUID().slice(0, 6)}`,
        companyName: payload.fromEmail.split('@')[1]?.replace(/\..+/, '').toUpperCase() || 'Inbound Company',
        website: `https://${payload.fromEmail.split('@')[1] || 'unknown.com'}`,
        industry: 'Inbound Inquiry',
        contactName: payload.fromEmail.split('@')[0] || 'Prospect',
        email: payload.fromEmail,
        country: 'Global',
        score: 95,
        status: 'replied',
        currentSequenceStep: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      this.db.insertLead(lead);
    }

    // AI / NLP Sentiment Classification
    const analysis = this.classifySentiment(payload.body, payload.subject);

    // Generate AI suggested reply tailored to Jesora Tech
    const suggestedReply = this.generateSuggestedReply(analysis.sentiment, lead, payload.body);

    const inboundReply: InboundReply = {
      id: `rep-${crypto.randomUUID().slice(0, 8)}`,
      leadId: lead.id,
      outreachMessageId: payload.outreachMessageId,
      fromEmail: payload.fromEmail,
      subject: payload.subject,
      body: payload.body,
      sentiment: analysis.sentiment,
      sentimentConfidence: analysis.confidence,
      aiSummary: analysis.summary,
      aiSuggestedReply: suggestedReply,
      status: 'pending_review',
      receivedAt: new Date().toISOString()
    };

    this.db.insertReply(inboundReply);

    // Handle Unsubscribe compliance
    if (analysis.sentiment === 'UNSUBSCRIBE') {
      this.db.updateLead(lead.id, {
        status: 'unsubscribed',
        notes: `Unsubscribed on ${new Date().toLocaleDateString()}: "${payload.body.slice(0, 100)}"`
      });
      // Cancel any future scheduled messages
      this.cancelPendingMessagesForLead(lead.id);
      this.log('warn', `Unsubscribed prospect ${lead.email} upon request`, { leadId: lead.id });
    } else if (analysis.sentiment === 'INTERESTED' || analysis.sentiment === 'MEETING_REQUEST') {
      // HOT LEAD: Upgrade status
      this.db.updateLead(lead.id, {
        status: 'replied',
        score: Math.min(100, lead.score + 25)
      });
      this.log('success', `HOT LEAD ALERT! ${lead.companyName} expressed interest (${analysis.sentiment})`, {
        leadId: lead.id,
        summary: analysis.summary
      });
    } else if (analysis.sentiment === 'NOT_NOW') {
      this.db.updateLead(lead.id, {
        status: 'contacted',
        nextFollowUpAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days
        notes: 'Requested follow-up later'
      });
      this.log('info', `Prospect ${lead.companyName} requested follow-up at later date.`);
    }

    if (lead.campaignId) {
      this.db.updateCampaignStats(lead.campaignId);
    }

    return inboundReply;
  }

  /**
   * Deterministic & AI-ready sentiment categorization
   */
  public classifySentiment(body: string, subject: string): {
    sentiment: ReplySentiment;
    confidence: number;
    summary: string;
  } {
    const text = `${subject} ${body}`.toLowerCase();

    // Check Unsubscribe / Opt-out
    if (
      text.includes('unsubscribe') ||
      text.includes('remove me') ||
      text.includes('stop emailing') ||
      text.includes('take me off') ||
      text.includes('not interested') ||
      text.includes('do not contact')
    ) {
      return {
        sentiment: 'UNSUBSCRIBE',
        confidence: 0.98,
        summary: 'Prospect explicitly requested to be unsubscribed or removed from communications.'
      };
    }

    // Check Meeting Request
    if (
      text.includes('calendar') ||
      text.includes('schedule a call') ||
      text.includes('hop on a call') ||
      text.includes('meeting') ||
      text.includes('zoom') ||
      text.includes('google meet') ||
      text.includes('time for a call') ||
      text.includes('thursday') ||
      text.includes('friday') ||
      text.includes('next week') ||
      text.includes('let\'s talk')
    ) {
      return {
        sentiment: 'MEETING_REQUEST',
        confidence: 0.94,
        summary: 'Prospect is open to or requesting an introductory meeting / discovery call.'
      };
    }

    // Check Interested / Pricing request
    if (
      text.includes('how much') ||
      text.includes('pricing') ||
      text.includes('cost') ||
      text.includes('quote') ||
      text.includes('rates') ||
      text.includes('interested') ||
      text.includes('tell me more') ||
      text.includes('portfolio') ||
      text.includes('case studies')
    ) {
      return {
        sentiment: 'INTERESTED',
        confidence: 0.92,
        summary: 'Prospect expressed positive interest in Jesora Tech services and requested rates/details.'
      };
    }

    // Check Information / Tech Stack query
    if (
      text.includes('do you do') ||
      text.includes('can you build') ||
      text.includes('experience with') ||
      text.includes('stack') ||
      text.includes('where are you')
    ) {
      return {
        sentiment: 'INFORMATION_REQUEST',
        confidence: 0.88,
        summary: 'Prospect is inquiring about specific technical capabilities or operational scope.'
      };
    }

    // Check Not Now / Later
    if (
      text.includes('not right now') ||
      text.includes('busy right now') ||
      text.includes('reach back in') ||
      text.includes('next quarter') ||
      text.includes('in a few months')
    ) {
      return {
        sentiment: 'NOT_NOW',
        confidence: 0.85,
        summary: 'Prospect indicates timing is not right, but left door open for future follow-up.'
      };
    }

    // Default other
    return {
      sentiment: 'OTHER',
      confidence: 0.70,
      summary: 'General prospect response requiring contextual review.'
    };
  }

  private generateSuggestedReply(sentiment: ReplySentiment, lead: Lead, body: string): string {
    const settings = this.db.getSettings();
    const bookingUrl = settings.jesoraProfile.calendarBookingUrl;

    if (sentiment === 'MEETING_REQUEST') {
      return `Hi ${lead.contactName},

Thank you for the quick response! I'd be delighted to connect.

How does a 15-minute introductory video call look on Thursday at 2:00 PM EST or Friday at 10:30 AM EST?

Alternatively, feel free to pick any slot that best fits your calendar right here:
${bookingUrl}

Looking forward to discussing ${lead.companyName}'s software objectives.

Best regards,
Rajan Thakulla
JESORA TECH | jesoratech.com`;
    }

    if (sentiment === 'INTERESTED' || sentiment === 'INFORMATION_REQUEST') {
      return `Hi ${lead.contactName},

Glad to hear from you! 

At JESORA TECH, our development model is transparent and milestone-based. We deliver in agile 2-week sprints with 100% full source code ownership handed directly to you. Because our core engineering team is based in Kathmandu, Nepal, our clients typically enjoy Silicon Valley engineering quality at a 40-60% cost efficiency compared to local agencies.

To give you an accurate scope and transparent estimation for ${lead.companyName}, could you let me know if you have 10-15 minutes this week for a brief discovery call?

You can grab a time here: ${bookingUrl}

Best regards,
Rajan Thakulla | JESORA TECH`;
    }

    if (sentiment === 'UNSUBSCRIBE') {
      return `Hi ${lead.contactName}, you have been completely removed from our list. Wishing you the best!`;
    }

    return `Hi ${lead.contactName}, thank you for your note. We would love to learn more about your goals at ${lead.companyName}. Are you free for a brief 10-minute introductory chat this week? (${bookingUrl})`;
  }

  private cancelPendingMessagesForLead(leadId: string): void {
    this.db.db.prepare(`
      UPDATE messages SET status = 'failed', error_message = 'Cancelled: Lead unsubscribed'
      WHERE lead_id = ? AND status = 'scheduled'
    `).run(leadId);
  }
}
