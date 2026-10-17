import { BaseAgent } from './BaseAgent.js';
import { AppDatabase } from '../db/database.js';
import { OutreachMessage, Lead, SystemSettings } from '../types/index.js';
import nodemailer from 'nodemailer';

export class DispatcherAgent extends BaseAgent {
  private lastSendTimestamp: number = 0;

  constructor(db: AppDatabase) {
    super(
      'dispatcher',
      'Outreach Dispatcher Agent',
      'Email Delivery & Deliverability Safeguard',
      'Executes scheduled email dispatches with anti-spam pacing, SMTP delivery, and domain reputation protection.',
      db
    );
  }

  protected async executeCycle(): Promise<{ actionsTaken: number; message: string }> {
    this.setTask('Checking scheduled messages and enforcing deliverability limits...');
    const settings = this.db.getSettings();

    // 1. Business hours check
    if (settings.pacing.businessHoursOnly) {
      const currentHour = new Date().getUTCHours(); // Or local
      if (currentHour < settings.pacing.businessHoursStart || currentHour >= settings.pacing.businessHoursEnd) {
        return {
          actionsTaken: 0,
          message: `Outside business hours (${settings.pacing.businessHoursStart}:00 - ${settings.pacing.businessHoursEnd}:00). Delivery deferred to preserve response rates.`
        };
      }
    }

    // 2. Daily send limit check
    const todaySentCount = this.getTodaySentCount();
    if (todaySentCount >= settings.pacing.maxEmailsPerDay) {
      return {
        actionsTaken: 0,
        message: `Daily send quota reached (${todaySentCount}/${settings.pacing.maxEmailsPerDay}). Preserving domain reputation.`
      };
    }

    // 3. Spacing jitter check
    const minDelayMs = settings.pacing.minDelayMinutesBetweenSends * 60 * 1000;
    const timeSinceLast = Date.now() - this.lastSendTimestamp;
    if (this.lastSendTimestamp > 0 && timeSinceLast < minDelayMs) {
      const waitMinutes = Math.ceil((minDelayMs - timeSinceLast) / 60000);
      return {
        actionsTaken: 0,
        message: `Pacing cooldown in effect: waiting ${waitMinutes}m before next dispatch.`
      };
    }

    // 4. Retrieve pending messages
    const pendingMessages = this.db.getPendingMessages(3);
    if (pendingMessages.length === 0) {
      return { actionsTaken: 0, message: 'No messages currently due for delivery.' };
    }

    let dispatchedCount = 0;

    for (const msg of pendingMessages) {
      const lead = this.db.getLeadById(msg.leadId);
      if (!lead) {
        this.db.updateMessageStatus(msg.id, 'failed', { error: 'Lead not found' });
        continue;
      }

      // Check if lead unsubscribed or bounced in the meantime
      if (lead.status === 'unsubscribed' || lead.status === 'bounced') {
        this.db.updateMessageStatus(msg.id, 'failed', { error: 'Lead unsubscribed/bounced' });
        this.log('warn', `Cancelled message to ${lead.email} - lead status is ${lead.status}`);
        continue;
      }

      this.setTask(`Dispatching email to ${lead.contactName} at ${lead.companyName}...`);
      const success = await this.sendEmail(msg, lead, settings);

      if (success) {
        dispatchedCount += 1;
        this.lastSendTimestamp = Date.now();
        this.db.updateMessageStatus(msg.id, 'sent', { sentAt: new Date().toISOString() });
        this.db.updateLead(lead.id, {
          lastContactedAt: new Date().toISOString(),
          status: lead.status === 'replied' ? 'replied' : 'contacted'
        });
        this.db.updateCampaignStats(msg.campaignId);

        this.log('success', `Sent Step ${msg.sequenceStepNumber} email to ${lead.email} (${lead.companyName})`, {
          messageId: msg.id,
          subject: msg.subject,
          isSimulation: settings.smtp.dryRun
        });

        // Break loop if pacing requires spacing between individual sends
        if (settings.pacing.minDelayMinutesBetweenSends > 0) {
          break;
        }
      } else {
        this.db.updateMessageStatus(msg.id, 'failed', { error: 'Delivery failure' });
      }
    }

    return {
      actionsTaken: dispatchedCount,
      message: `Dispatched ${dispatchedCount} outreach email(s).`
    };
  }

  /**
   * Handles physical or simulated SMTP dispatch
   */
  public async sendEmail(msg: OutreachMessage, lead: Lead, settings: SystemSettings): Promise<boolean> {
    if (settings.smtp.dryRun || !settings.smtp.pass) {
      // Safe dry-run simulation mode: logs exact envelope and headers
      this.log('info', `[SIMULATED DISPATCH] To: ${lead.email} | Subject: "${msg.subject}"`, {
        from: `"${settings.smtp.fromName}" <${settings.smtp.fromEmail}>`,
        to: lead.email,
        subject: msg.subject,
        bodyPreview: msg.body.slice(0, 150) + '...'
      });
      return true;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: settings.smtp.host,
        port: settings.smtp.port,
        secure: settings.smtp.secure,
        auth: {
          user: settings.smtp.user,
          pass: settings.smtp.pass
        }
      });

      const textBody = `${msg.body}\n\n---\nTo unsubscribe, reply with 'unsubscribe' or click: https://jesoratech.com/unsubscribe?email=${encodeURIComponent(lead.email)}`;

      await transporter.sendMail({
        from: `"${settings.smtp.fromName}" <${settings.smtp.fromEmail}>`,
        to: `"${lead.contactName}" <${lead.email}>`,
        subject: msg.subject,
        text: textBody,
        replyTo: settings.jesoraProfile.contactEmail
      });

      return true;
    } catch (err: any) {
      this.log('error', `SMTP transmission error to ${lead.email}: ${err.message}`, { error: err });
      return false;
    }
  }

  private getTodaySentCount(): number {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const row = this.db.db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE status IN ('sent', 'delivered', 'opened', 'replied')
      AND sent_at >= ?
    `).get(startOfDay.toISOString()) as any;

    return row?.count || 0;
  }
}
