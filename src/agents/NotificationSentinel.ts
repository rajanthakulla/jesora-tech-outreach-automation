import { BaseAgent } from './BaseAgent.js';
import { AppDatabase } from '../db/database.js';
import { Lead, Meeting, InboundReply } from '../types/index.js';

export class NotificationSentinel extends BaseAgent {
  private sseClients: Set<(event: string, data: any) => void> = new Set();

  constructor(db: AppDatabase) {
    super(
      'notification_sentinel',
      'Notification Sentinel Agent',
      'Real-Time Channel Alert Dispatcher',
      'Delivers instant notifications across Telegram, Webhooks, and Live Dashboard streams for hot replies and booked meetings.',
      db
    );
  }

  public registerSSEClient(callback: (event: string, data: any) => void): () => void {
    this.sseClients.add(callback);
    return () => {
      this.sseClients.delete(callback);
    };
  }

  public broadcast(event: string, data: any): void {
    for (const client of this.sseClients) {
      try {
        client(event, data);
      } catch {
        // client may have disconnected
      }
    }
  }

  protected async executeCycle(): Promise<{ actionsTaken: number; message: string }> {
    this.setTask('Sentinel standing by for real-time dispatch alerts.');
    return {
      actionsTaken: 0,
      message: `Active on ${this.sseClients.size} live dashboard listener(s).`
    };
  }

  /**
   * Dispatches urgent alert for an interested lead
   */
  public async notifyHotLead(lead: Lead, reply: InboundReply): Promise<void> {
    const title = `🔥 HOT LEAD ALERT: ${lead.companyName} is Interested!`;
    const message = `• Prospect: ${lead.contactName} (${lead.email})\n• Company: ${lead.companyName} (${lead.industry})\n• Sentiment: ${reply.sentiment}\n• Summary: ${reply.aiSummary}\n• Reply: "${reply.body.slice(0, 150)}..."`;

    this.log('success', title, { leadId: lead.id, sentiment: reply.sentiment });
    this.broadcast('hot_lead', { lead, reply });

    await this.sendTelegramNotification(`<b>${title}</b>\n\n${message}`);
  }

  /**
   * Dispatches alert for a newly booked meeting
   */
  public async notifyMeetingBooked(lead: Lead, meeting: Meeting): Promise<void> {
    const title = `📅 NEW DISCOVERY CALL BOOKED: ${lead.companyName}!`;
    const message = `• Contact: ${lead.contactName} (${lead.email})\n• Time: ${new Date(meeting.scheduledTime).toLocaleString()}\n• Meet Link: ${meeting.meetUrl}\n• Agenda: ${meeting.agenda}`;

    this.log('success', title, { leadId: lead.id, meetingId: meeting.id });
    this.broadcast('meeting_booked', { lead, meeting });

    await this.sendTelegramNotification(`<b>${title}</b>\n\n${message}`);
  }

  /**
   * Delivers message via Telegram Bot API if configured
   */
  public async sendTelegramNotification(htmlText: string): Promise<boolean> {
    const settings = this.db.getSettings();
    if (!settings.telegram.enabled || !settings.telegram.botToken || !settings.telegram.chatId) {
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.telegram.chatId,
          text: htmlText,
          parse_mode: 'HTML'
        })
      });

      if (res.ok) {
        this.log('info', 'Telegram alert delivered successfully.');
        return true;
      } else {
        const errorText = await res.text();
        this.log('warn', `Telegram notification failed: ${errorText}`);
        return false;
      }
    } catch (err: any) {
      this.log('error', `Failed to send Telegram message: ${err.message}`);
      return false;
    }
  }
}
