import { BaseAgent } from './BaseAgent.js';
import { AppDatabase } from '../db/database.js';
import { Lead, Meeting } from '../types/index.js';
import crypto from 'node:crypto';

export class MeetingCloserAgent extends BaseAgent {
  constructor(db: AppDatabase) {
    super(
      'meeting_closer',
      'Meeting Closer & Scheduler Agent',
      'Calendar Orchestration & Deal Preparation',
      'Turns interested replies into booked discovery calls, provides scheduling links, and compiles Executive Briefs for the Jesora Tech team.',
      db
    );
  }

  protected async executeCycle(): Promise<{ actionsTaken: number; message: string }> {
    this.setTask('Checking interested replies ready for meeting booking...');
    const settings = this.db.getSettings();

    // Check for replies with MEETING_REQUEST that haven't been booked yet
    const replies = this.db.getAllReplies().filter(
      r => r.sentiment === 'MEETING_REQUEST' && r.status === 'pending_review'
    );

    let bookedCount = 0;

    for (const reply of replies) {
      const lead = this.db.getLeadById(reply.leadId);
      if (!lead) continue;

      // Check if meeting already created for this lead
      const existingMeetings = this.db.getAllMeetings().filter(m => m.leadId === lead.id);
      if (existingMeetings.length > 0) continue;

      if (settings.autonomous.autoReplyInterested) {
        this.setTask(`Scheduling meeting and generating executive brief for ${lead.companyName}...`);
        const meeting = await this.scheduleMeetingForLead(lead, reply.body);
        bookedCount += 1;
        this.db.updateReplyStatus(reply.id, 'auto_replied', new Date().toISOString());
        this.log('success', `Booked discovery meeting with ${lead.companyName} (${lead.contactName})`, {
          meetingId: meeting.id,
          scheduledTime: meeting.scheduledTime
        });
      }
    }

    return {
      actionsTaken: bookedCount,
      message: `Processed meetings: ${bookedCount} new meeting(s) booked with executive briefs.`
    };
  }

  /**
   * Schedules a discovery meeting and produces an Executive Briefing Dossier
   */
  public async scheduleMeetingForLead(lead: Lead, prospectNote?: string): Promise<Meeting> {
    const settings = this.db.getSettings();
    
    // Propose slot 2 days out at 2:00 PM
    const meetingDate = new Date();
    meetingDate.setDate(meetingDate.getDate() + 2);
    meetingDate.setHours(14, 0, 0, 0);

    const executiveBrief = this.generateExecutiveBrief(lead, prospectNote);

    const meeting: Meeting = {
      id: `meet-${crypto.randomUUID().slice(0, 8)}`,
      leadId: lead.id,
      scheduledTime: meetingDate.toISOString(),
      durationMinutes: 30,
      meetUrl: `https://meet.google.com/jesora-${crypto.randomUUID().slice(0, 4)}-call`,
      agenda: `Jesora Tech Discovery Call: Custom Software & Web Engineering Roadmap for ${lead.companyName}`,
      status: 'confirmed',
      executiveBrief,
      createdAt: new Date().toISOString()
    };

    this.db.insertMeeting(meeting);
    this.db.updateLead(lead.id, {
      status: 'meeting_scheduled',
      score: 100
    });

    if (lead.campaignId) {
      this.db.updateCampaignStats(lead.campaignId);
    }

    return meeting;
  }

  /**
   * Compiles an executive brief for Rajan Thakulla & the Jesora Tech engineering team
   */
  private generateExecutiveBrief(lead: Lead, prospectNote?: string): string {
    return `### EXECUTIVE CLIENT BRIEF: ${lead.companyName.toUpperCase()}
• **Primary Contact:** ${lead.contactName} (${lead.contactTitle || 'Decision Maker'})
• **Direct Email:** ${lead.email}
• **Company Website:** ${lead.website}
• **Industry:** ${lead.industry} | Location: ${lead.country}

#### 1. Detected Technical Pain Points & Opportunity:
${lead.painPoints || 'Looking to modernize web software workflows and build custom features.'}

#### 2. Existing Tech Stack Audit:
${lead.techStack || 'Legacy stack with room for performance and UI/UX modernization.'}

#### 3. Client's Inbound Note / Questions:
"${prospectNote || 'Interested in scheduling an initial discovery call.'}"

#### 4. Recommended Jesora Tech Pitch Strategy:
• Emphasize **100% full source code ownership handover** and zero agency lock-in.
• Highlight agile **2-week milestone sprints** with demonstrable live staging demos.
• Showcase relevant case studies: **WriteWell** (AI SaaS) or **MotoFix** (Automated Booking & Portal).
• Offer our free technical scope & architecture blueprint as the next immediate step.`;
  }
}
