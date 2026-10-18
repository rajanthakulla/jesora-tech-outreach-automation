import { BaseAgent } from './BaseAgent.js';
import { AppDatabase } from '../db/database.js';
import { Lead, OutreachMessage, EmailSequence } from '../types/index.js';
import crypto from 'node:crypto';

export type PitchTrack = 'web_development' | 'automation' | 'erp';

const WEB_DEV_TEMPLATE = `Hi {{first_name_or_team}},

I came across {{company_name}} while researching {{industry}} businesses in {{city}}, and {{personalized_observation}} caught my attention.

Today, a business website is more than an online presence. It's often the first place potential customers go to evaluate a company, explore its services, and decide whether to get in touch.

Based on my research into {{company_name}}, I noticed three potential opportunities to strengthen your digital presence:

Where your website could improve

01 — {{website_problem_1}}
{{website_problem_1_business_impact}}

02 — {{website_problem_2}}
{{website_problem_2_business_impact}}

03 — {{website_problem_3}}
{{website_problem_3_business_impact}}

How JESORA TECH can help

At JESORA TECH, we design and develop modern, high-performing websites tailored to each business's goals, audience, and brand identity.

01 — {{website_solution_1_title}}
{{website_solution_1_description_and_benefit}}

02 — {{website_solution_2_title}}
{{website_solution_2_description_and_benefit}}

03 — {{website_solution_3_title}}
{{website_solution_3_description_and_benefit}}

Our goal isn't simply to build a visually appealing website. It's to create a digital experience that communicates your value clearly, builds customer confidence, and makes it easier for potential customers to take the next step.

We'd start by understanding your business objectives and existing website, then recommend practical improvements aligned with your priorities and budget.

Would you be open to a brief 10-minute conversation next week? I'd be happy to share a few website improvement ideas specifically for {{company_name}}.

Best regards,

Rajan Thakulla
Lead Engineer | JESORA TECH
[techjesora@gmail.com](mailto:techjesora@gmail.com)
jesoratech.com`;

const ZERO_WEBSITE_DEV_TEMPLATE = `Hi {{first_name_or_team}},

I came across {{company_name}} while researching {{industry}} businesses in {{city}}, and {{personalized_observation}} caught my attention.

Today, a business website is more than an online presence. It's often the first place potential customers go to evaluate a company, explore its services, and decide whether to get in touch.

Based on my research into {{company_name}}, I noticed three potential opportunities to strengthen your digital presence:

Where an official website would make an immediate difference

01 — {{website_problem_1}}
{{website_problem_1_business_impact}}

02 — {{website_problem_2}}
{{website_problem_2_business_impact}}

03 — {{website_problem_3}}
{{website_problem_3_business_impact}}

How JESORA TECH can help

At JESORA TECH, we design and develop modern, high-performing websites tailored to each business's goals, audience, and brand identity.

01 — {{website_solution_1_title}}
{{website_solution_1_description_and_benefit}}

02 — {{website_solution_2_title}}
{{website_solution_2_description_and_benefit}}

03 — {{website_solution_3_title}}
{{website_solution_3_description_and_benefit}}

Our goal isn't simply to build a visually appealing website. It's to create a digital experience that communicates your value clearly, builds customer confidence, and makes it easier for potential customers to take the next step.

We'd start by understanding your business objectives and service offerings, then design a high-converting website tailored to your brand and budget.

Would you be open to a brief 10-minute conversation next week? I'd be happy to share a few website concepts and ideas specifically for {{company_name}}.

Best regards,

Rajan Thakulla
Lead Engineer | JESORA TECH
[techjesora@gmail.com](mailto:techjesora@gmail.com)
jesoratech.com`;

const AUTOMATION_TEMPLATE = `Hi {{first_name_or_team}},

I came across {{company_name}} while researching {{industry}} businesses in {{city}}, and {{personalized_observation}} caught my attention.

As businesses grow, processes that once worked well can become increasingly time-consuming. Repetitive tasks, manual coordination, and disconnected systems can create operational friction and leave teams with less time to focus on what matters most.

Based on my research, I identified three potential opportunities for {{company_name}} to streamline its operations.

Where automation could make a difference

01 — {{current_process_1}}
{{process_1_challenge_and_impact}}

02 — {{current_process_2}}
{{process_2_challenge_and_impact}}

03 — {{current_process_3}}
{{process_3_challenge_and_impact}}

How JESORA TECH can help

At JESORA TECH, we design and implement custom automation solutions that reduce repetitive work, connect business systems, and simplify everyday operations.

01 — {{automation_solution_1}}
{{solution_1_description_and_benefit}}

02 — {{automation_solution_2}}
{{solution_2_description_and_benefit}}

03 — {{automation_solution_3}}
{{solution_3_description_and_benefit}}

Our approach is simple: understand how your business operates today, identify the bottlenecks worth solving, and implement practical automation that fits your existing workflows.

The goal isn't to automate everything. It's to eliminate unnecessary manual work, improve consistency, and give your team more time to focus on growth.

Would you be open to a quick 10-minute conversation next week? I'd be happy to discuss a few automation opportunities tailored specifically to {{company_name}}.

Best regards,

Rajan Thakulla
Lead Engineer | JESORA TECH
[techjesora@gmail.com](mailto:techjesora@gmail.com)
jesoratech.com`;

const ERP_TEMPLATE = `Hi {{first_name_or_team}},

I came across {{company_name}} while researching {{industry}} businesses in {{city}}, and {{personalized_observation}} caught my attention.

As businesses expand, managing different functions across separate systems, spreadsheets, and manual processes can make it harder to maintain visibility, coordinate teams, and make timely decisions.

Based on my research into {{company_name}}, I identified three potential areas where a more connected business management system could create value.

Where operational challenges may arise

01 — {{erp_problem_1}}
{{erp_problem_1_business_impact}}

02 — {{erp_problem_2}}
{{erp_problem_2_business_impact}}

03 — {{erp_problem_3}}
{{erp_problem_3_business_impact}}

How JESORA TECH can help

At JESORA TECH, we develop customized Enterprise Resource Planning (ERP) solutions that bring essential business operations into one integrated platform, tailored to your company's workflows and growth objectives.

01 — Integrated Business Operations
{{erp_solution_1_description_and_benefit}}

02 — Real-Time Data and Reporting
{{erp_solution_2_description_and_benefit}}

03 — Workflow Automation and Centralized Control
{{erp_solution_3_description_and_benefit}}

Rather than forcing your business to adapt to a rigid, off-the-shelf system, we focus on designing an ERP solution around your actual processes, existing systems, and operational priorities.

The objective is simple: better visibility, smoother coordination, and greater control over your business operations—all through one connected system.

Would you be open to a brief 10–15-minute conversation next week? I'd welcome the opportunity to understand how {{company_name}} currently manages its operations and explore whether a tailored ERP solution would be a worthwhile investment.

Best regards,

Rajan Thakulla
Lead Engineer | JESORA TECH
[techjesora@gmail.com](mailto:techjesora@gmail.com)
jesoratech.com`;

export class PitchCrafterAgent extends BaseAgent {
  constructor(db: AppDatabase) {
    super(
      'pitch_crafter',
      'Pitch Crafter Agent',
      'Consultative Outreach Copywriting & Sequencing',
      'Generates tech-literate, non-technical business proposals in strict accordance with Jesora Tech formats.',
      db
    );
  }

  protected async executeCycle(): Promise<{ actionsTaken: number; message: string }> {
    this.setTask('Finding leads ready for outreach copy generation...');
    const sequences = this.db.getAllSequences();
    const defaultSeq = sequences[0];

    if (!defaultSeq) {
      return { actionsTaken: 0, message: 'No email sequences found in database.' };
    }

    let craftedCount = 0;

    // 1. Process 'audited' and 'scouted' leads (ready for Step 1)
    const auditedLeads = this.db.getAllLeads('audited');
    const scoutedLeads = this.db.getAllLeads('scouted');
    const leadsReadyForStep1 = [...auditedLeads, ...scoutedLeads];

    for (const lead of leadsReadyForStep1.slice(0, 5)) {
      const campaign = lead.campaignId ? this.db.getCampaign(lead.campaignId) : null;
      const targetSeq = (campaign?.sequenceId ? this.db.getSequenceById(campaign.sequenceId) : null) || defaultSeq;

      this.setTask(`Crafting consultative pitch for ${lead.companyName}...`);
      const scheduledMsg = await this.craftMessageForLead(lead, 1, targetSeq);
      if (scheduledMsg) {
        this.db.insertMessage(scheduledMsg);
        this.db.updateLead(lead.id, {
          status: 'pitched',
          currentSequenceStep: 1,
          nextFollowUpAt: this.calculateFollowUpTime(targetSeq, 1)
        });
        craftedCount += 1;
        this.log('info', `Crafted Step 1 email for ${lead.companyName} (${lead.contactName})`, {
          leadId: lead.id,
          sequence: targetSeq.name,
          subject: scheduledMsg.subject
        });
      }
    }

    // 2. Process 'contacted' leads due for follow-ups (Steps 2 through 6)
    const contactedLeads = this.db.getAllLeads('contacted');
    const now = new Date();

    for (const lead of contactedLeads.slice(0, 5)) {
      if (!lead.nextFollowUpAt) continue;
      const nextDue = new Date(lead.nextFollowUpAt);

      if (nextDue <= now) {
        const campaign = lead.campaignId ? this.db.getCampaign(lead.campaignId) : null;
        const targetSeq = (campaign?.sequenceId ? this.db.getSequenceById(campaign.sequenceId) : null) || defaultSeq;
        const nextStepNum = lead.currentSequenceStep + 1;
        const targetStep = targetSeq.steps.find(s => s.stepNumber === nextStepNum);

        if (targetStep) {
          this.setTask(`Crafting Step ${nextStepNum} follow-up for ${lead.companyName}...`);
          const scheduledMsg = await this.craftMessageForLead(lead, nextStepNum, targetSeq);
          if (scheduledMsg) {
            this.db.insertMessage(scheduledMsg);
            this.db.updateLead(lead.id, {
              currentSequenceStep: nextStepNum,
              nextFollowUpAt: this.calculateFollowUpTime(targetSeq, nextStepNum)
            });
            craftedCount += 1;
            this.log('info', `Crafted Step ${nextStepNum} follow-up for ${lead.companyName}`, {
              leadId: lead.id,
              sequence: targetSeq.name,
              subject: scheduledMsg.subject
            });
          }
        } else {
          // Completed all sequence steps
          this.db.updateLead(lead.id, {
            nextFollowUpAt: undefined
          });
          this.log('info', `Completed full sequence for ${lead.companyName}`);
        }
      }
    }

    return {
      actionsTaken: craftedCount,
      message: `Personalized and queued ${craftedCount} outreach sequence emails.`
    };
  }

  /**
   * Crafts tailored email strictly matching the user's 3 designated templates
   */
  public async craftMessageForLead(
    lead: Lead,
    stepNumber: number,
    sequence: EmailSequence
  ): Promise<OutreachMessage | null> {
    const settings = this.db.getSettings();
    const track = this.determinePitchTrack(lead, sequence);
    const city = this.extractCity(lead);
    const firstNameOrTeam = this.extractFirstNameOrTeam(lead);

    let subject = this.getDefaultSubject(lead, track);
    let body = this.buildFallbackTemplate(lead, track, city, firstNameOrTeam);

    // AI enhancement using exact template guidelines
    if (settings.ai?.apiKey && settings.ai.provider !== 'builtin') {
      try {
        const aiResult = await this.enhancePitchWithAI(lead, track, city, firstNameOrTeam, settings);
        if (aiResult?.subject && aiResult?.body) {
          subject = aiResult.subject;
          body = aiResult.body;
        }
      } catch (err: any) {
        this.log('warn', `AI enhancement fallback to standard template: ${err.message}`);
      }
    }

    // Schedule: Stagger sends across minutes
    const scheduledDate = new Date(Date.now() + Math.floor(Math.random() * 15 + 2) * 60 * 1000);

    return {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      leadId: lead.id,
      campaignId: lead.campaignId || 'camp-global-startups',
      sequenceStepNumber: stepNumber,
      subject,
      body,
      status: 'scheduled',
      scheduledFor: scheduledDate.toISOString(),
      createdAt: new Date().toISOString()
    };
  }

  private determinePitchTrack(lead: Lead, sequence: EmailSequence): PitchTrack {
    const ind = (lead.industry || '').toLowerCase();
    const pain = (lead.painPoints || '').toLowerCase();
    const hasNoWebsite = !lead.website || lead.website.toLowerCase().includes('none');

    // 1. Web Development Track (TOP PRIORITY):
    // Default and prioritize across all target verticals (driving schools, tuition centers, language schools,
    // garages, salons, cafes, clinics, schools, mortgage centers, startups, SMBs, local services)
    if (hasNoWebsite || sequence.id === 'seq-jesora-fullstack') {
      return 'web_development';
    }

    // 2. Dedicated ERP Track: ONLY for explicit ERP/SAP enterprise software modernization on enterprise sequence
    if (sequence.id === 'seq-enterprise-automation' && (/\berp\b/i.test(ind) || /\benterprise resource planning\b/i.test(pain) || /\bsap\b/i.test(ind))) {
      return 'erp';
    }

    // 3. Pure Backend Automation Track: ONLY when explicitly requested for internal API/backend sync with no website need
    if (sequence.id === 'seq-enterprise-automation' && (pain.includes('zapier') || pain.includes('webhook automation') || pain.includes('crm database sync'))) {
      return 'automation';
    }

    // Fallback: Prioritize Web Development
    return 'web_development';
  }

  private extractCity(lead: Lead): string {
    if (lead.address) {
      const parts = lead.address.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 3) {
        const candidate = parts[parts.length - 2].replace(/\d+/g, '').trim();
        if (candidate.length > 2) return candidate;
      }
      if (parts.length >= 2) {
        const candidate = parts[parts.length - 2].replace(/\d+/g, '').trim();
        if (candidate.length > 2) return candidate;
      }
    }
    if (lead.country) {
      return lead.country.split(',')[0].replace(/\d+/g, '').trim();
    }
    return 'your area';
  }

  private extractFirstNameOrTeam(lead: Lead): string {
    const raw = (lead.contactName || '').trim();
    if (!raw || 
        raw.toLowerCase().includes('team') || 
        raw.toLowerCase().includes('executive') || 
        raw.toLowerCase().includes('decision') ||
        raw.toLowerCase().includes('director') ||
        raw.toLowerCase().includes('founder') ||
        raw.toLowerCase().includes('owner')) {
      return `${lead.companyName} Team`;
    }
    const firstName = raw.split(' ')[0].trim();
    return firstName.length > 1 ? firstName : `${lead.companyName} Team`;
  }

  private getDefaultSubject(lead: Lead, track: PitchTrack): string {
    if (track === 'web_development') {
      return `${lead.companyName} digital presence & website review`;
    }
    if (track === 'erp') {
      return `Connected business operations for ${lead.companyName}`;
    }
    return `Streamlining operational workflows for ${lead.companyName}`;
  }

  private buildFallbackTemplate(
    lead: Lead,
    track: PitchTrack,
    city: string,
    firstNameOrTeam: string
  ): string {
    const hasNoWebsite = !lead.website || lead.website.toLowerCase().includes('none');

    if (track === 'web_development') {
      if (hasNoWebsite) {
        const p1 = 'Absence of an official website for direct customer evaluation';
        const imp1 = 'Potential clients searching for services in your area cannot view your credentials, service options, or contact details directly online, often choosing competitors with visible websites.';

        const p2 = 'Reliance on manual phone calls for all inquiries';
        const imp2 = 'Without a dedicated website and online booking portal, potential customers browsing outside business hours have no way to request services or book consultations.';

        const p3 = 'Untapped local search and Google presence';
        const imp3 = `Without an official domain and local search optimization, ${lead.companyName} is missing high-intent customers searching for ${lead.industry} services in ${city}.`;

        const s1Title = 'Modern, High-Speed Official Website';
        const s1Desc = `A clean, professional website engineered for instant loading on smartphones, tablets, and computers, ensuring ${lead.companyName} establishes strong online credibility.`;

        const s2Title = 'Automated 24/7 Client Booking & Inquiry System';
        const s2Desc = 'An intuitive, mobile-friendly booking system that allows prospective clients to request appointments or inquiries directly at any time of day.';

        const s3Title = 'Local Search & Google Visibility Optimization';
        const s3Desc = `Structured service pages and Google local search optimization to help ${lead.companyName} attract organic search traffic across ${city}.`;

        return ZERO_WEBSITE_DEV_TEMPLATE
          .replace(/{{first_name_or_team}}/g, firstNameOrTeam)
          .replace(/{{company_name}}/g, lead.companyName)
          .replace(/{{industry}}/g, lead.industry)
          .replace(/{{city}}/g, city)
          .replace(/{{personalized_observation}}/g, `your strong local customer reputation and presence in ${city}`)
          .replace(/{{website_problem_1}}/g, p1)
          .replace(/{{website_problem_1_business_impact}}/g, imp1)
          .replace(/{{website_problem_2}}/g, p2)
          .replace(/{{website_problem_2_business_impact}}/g, imp2)
          .replace(/{{website_problem_3}}/g, p3)
          .replace(/{{website_problem_3_business_impact}}/g, imp3)
          .replace(/{{website_solution_1_title}}/g, s1Title)
          .replace(/{{website_solution_1_description_and_benefit}}/g, s1Desc)
          .replace(/{{website_solution_2_title}}/g, s2Title)
          .replace(/{{website_solution_2_description_and_benefit}}/g, s2Desc)
          .replace(/{{website_solution_3_title}}/g, s3Title)
          .replace(/{{website_solution_3_description_and_benefit}}/g, s3Desc);
      } else {
        const p1 = 'Mobile experience and page response times';
        const imp1 = 'Potential clients browsing on smartphones often experience formatting delays and navigation friction, leading many to drop off before contacting you.';

        const p2 = 'No direct after-hours online appointment or inquiry booking';
        const imp2 = 'Customers wishing to schedule consultations or service visits in the evening or weekends have no automated way to book, forcing all intake onto manual telephone calls.';

        const p3 = 'Clear service positioning and customer trust cues';
        const imp3 = 'First-time visitors need immediate confidence through clean service breakdowns and visible client reviews to take the next step without hesitation.';

        const s1Title = 'Modern, High-Speed Responsive Website Redesign';
        const s1Desc = `A clean, professional website engineered for instant loading on smartphones, tablets, and computers, ensuring ${lead.companyName} makes a strong first impression.`;

        const s2Title = 'Automated 24/7 Client Booking & Inquiry Portal';
        const s2Desc = 'An intuitive, mobile-friendly booking system that allows prospective clients to request appointments or inquiries directly at any time of day.';

        const s3Title = 'Local Search & Google Visibility Optimization';
        const s3Desc = `Structured service pages and Google local search optimization to help ${lead.companyName} attract organic search traffic across ${city}.`;

        return WEB_DEV_TEMPLATE
          .replace(/{{first_name_or_team}}/g, firstNameOrTeam)
          .replace(/{{company_name}}/g, lead.companyName)
          .replace(/{{industry}}/g, lead.industry)
          .replace(/{{city}}/g, city)
          .replace(/{{personalized_observation}}/g, `your strong local customer reputation and presence in ${city}`)
          .replace(/{{website_problem_1}}/g, p1)
          .replace(/{{website_problem_1_business_impact}}/g, imp1)
          .replace(/{{website_problem_2}}/g, p2)
          .replace(/{{website_problem_2_business_impact}}/g, imp2)
          .replace(/{{website_problem_3}}/g, p3)
          .replace(/{{website_problem_3_business_impact}}/g, imp3)
          .replace(/{{website_solution_1_title}}/g, s1Title)
          .replace(/{{website_solution_1_description_and_benefit}}/g, s1Desc)
          .replace(/{{website_solution_2_title}}/g, s2Title)
          .replace(/{{website_solution_2_description_and_benefit}}/g, s2Desc)
          .replace(/{{website_solution_3_title}}/g, s3Title)
          .replace(/{{website_solution_3_description_and_benefit}}/g, s3Desc);
      }
    }

    if (track === 'erp') {
      const p1 = 'Disconnected information across separate tools and spreadsheets';
      const imp1 = 'Managing customer records, service orders, and financials in different places creates manual data-entry overhead and increases the risk of scheduling discrepancies.';

      const p2 = 'Lack of unified operational visibility in real time';
      const imp2 = 'Management must spend time compiling reports across disconnected spreadsheets to understand current pipeline status, pending jobs, and staff allocation.';

      const p3 = 'Manual coordination between administrative staff and service delivery';
      const imp3 = 'Internal communications require frequent back-and-forth phone calls or messages, slowing down response times to new client inquiries.';

      const s1Desc = `A single, central platform that unites client intake, service tracking, and operational records specifically configured for ${lead.companyName}.`;
      const s2Desc = 'Live operational dashboards that give your management team an instant overview of daily appointments, revenue, and active client statuses.';
      const s3Desc = 'Automated workflow triggers that eliminate repetitive manual follow-ups and ensure consistent coordination across your team.';

      return ERP_TEMPLATE
        .replace(/{{first_name_or_team}}/g, firstNameOrTeam)
        .replace(/{{company_name}}/g, lead.companyName)
        .replace(/{{industry}}/g, lead.industry)
        .replace(/{{city}}/g, city)
        .replace(/{{personalized_observation}}/g, `your expanding operations and business standing in ${city}`)
        .replace(/{{erp_problem_1}}/g, p1)
        .replace(/{{erp_problem_1_business_impact}}/g, imp1)
        .replace(/{{erp_problem_2}}/g, p2)
        .replace(/{{erp_problem_2_business_impact}}/g, imp2)
        .replace(/{{erp_problem_3}}/g, p3)
        .replace(/{{erp_problem_3_business_impact}}/g, imp3)
        .replace(/{{erp_solution_1_description_and_benefit}}/g, s1Desc)
        .replace(/{{erp_solution_2_description_and_benefit}}/g, s2Desc)
        .replace(/{{erp_solution_3_description_and_benefit}}/g, s3Desc);
    }

    // Automation Track
    const p1 = 'Manual Appointment Scheduling and Inquiries';
    const imp1 = 'Handling customer bookings and reschedules via phone calls or manual messages consumes valuable staff time and risks missed inquiries during peak business hours.';

    const p2 = 'Disconnected Client Records and Status Tracking';
    const imp2 = 'Relying on separate spreadsheets or paper logs makes it difficult to track client history, lesson schedules, or service queues in real time.';

    const p3 = 'Manual Reminders and Follow-Up Communications';
    const imp3 = 'Without automated confirmation messages, appointment no-shows and last-minute cancellations can disrupt daily scheduling and revenue.';

    const s1Title = 'Automated Self-Service Scheduling';
    const s1Desc = 'A streamlined digital booking system that lets clients view availability and schedule appointments online 24/7, freeing your team from routine phone coordination.';

    const s2Title = 'Centralized Customer & Workflow Dashboard';
    const s2Desc = 'A unified operational dashboard where your staff can view upcoming schedules, client history, and real-time status updates in one organized place.';

    const s3Title = 'Automated Notifications & Reminders';
    const s3Desc = 'Instant confirmation emails and SMS appointment reminders sent automatically, drastically reducing no-shows and keeping clients informed.';

    return AUTOMATION_TEMPLATE
      .replace(/{{first_name_or_team}}/g, firstNameOrTeam)
      .replace(/{{company_name}}/g, lead.companyName)
      .replace(/{{industry}}/g, lead.industry)
      .replace(/{{city}}/g, city)
      .replace(/{{personalized_observation}}/g, `your active customer service presence in ${city}`)
      .replace(/{{current_process_1}}/g, p1)
      .replace(/{{process_1_challenge_and_impact}}/g, imp1)
      .replace(/{{current_process_2}}/g, p2)
      .replace(/{{process_2_challenge_and_impact}}/g, imp2)
      .replace(/{{current_process_3}}/g, p3)
      .replace(/{{process_3_challenge_and_impact}}/g, imp3)
      .replace(/{{automation_solution_1}}/g, s1Title)
      .replace(/{{solution_1_description_and_benefit}}/g, s1Desc)
      .replace(/{{automation_solution_2}}/g, s2Title)
      .replace(/{{solution_2_description_and_benefit}}/g, s2Desc)
      .replace(/{{automation_solution_3}}/g, s3Title)
      .replace(/{{solution_3_description_and_benefit}}/g, s3Desc);
  }

  private async enhancePitchWithAI(
    lead: Lead,
    track: PitchTrack,
    city: string,
    firstNameOrTeam: string,
    settings: any
  ): Promise<{ subject: string; body: string } | null> {
    const hasNoWebsite = !lead.website || lead.website.toLowerCase().includes('none');

    const selectedTemplate =
      track === 'web_development'
        ? (hasNoWebsite ? ZERO_WEBSITE_DEV_TEMPLATE : WEB_DEV_TEMPLATE)
        : track === 'erp'
        ? ERP_TEMPLATE
        : AUTOMATION_TEMPLATE;

    const websiteGuidanceRule = hasNoWebsite
      ? `• THIS BUSINESS HAS NO STANDALONE OFFICIAL WEBSITE.
You MUST use the ZERO_WEBSITE_DEV_TEMPLATE ("Where an official website would make an immediate difference").
Focus on building their first digital presence, establishing online credibility, and deploying a 24/7 online booking engine.
DO NOT refer to an "existing website".`
      : `• THIS BUSINESS HAS AN OFFICIAL LIVE WEBSITE AT "${lead.website}".
You MUST use the WEB_DEV_TEMPLATE ("Where your website could improve").
Focus on modernizing, speeding up, and improving conversion on their existing website.
NEVER state or imply that they lack an official website.`;

    const prompt = `You are Rajan Thakulla, Lead Engineer at JESORA TECH (jesoratech.com).
Your task is to write a highly tailored, professional B2B outreach email to a prospective client.

PROSPECT DETAILS:
• Company Name: ${lead.companyName}
• Recipient: ${firstNameOrTeam}
• Industry: ${lead.industry}
• City: ${city}
• Website: ${hasNoWebsite ? 'None (Social / Directory Only)' : lead.website}
• Context: ${lead.painPoints || 'Digital presence & workflow modernization'}

PITCH TRACK: ${track.toUpperCase()}

${websiteGuidanceRule}

CRITICAL RULES:
1. You MUST follow the EXACT template below word-for-word, replacing ONLY the placeholders enclosed in {{...}}.
2. DO NOT mention any third-party portfolio websites, client names, or URLs (e.g. NEVER mention MotoFix, motohubfix.vercel.app, writewell.space, or any external client links).
3. DO NOT use technical jargon (NO TTFB, NO milliseconds latency numbers, NO HSTS/CSP, NO headless Next.js monolithic talk). Explain all issues and solutions in tech-literate, clear business English that any business owner understands.
4. Keep the exact section headers and numbered items ("01 —", "02 —", "03 —").
5. The sign-off must be exactly:
Best regards,

Rajan Thakulla
Lead Engineer | JESORA TECH
[techjesora@gmail.com](mailto:techjesora@gmail.com)
jesoratech.com

TEMPLATE TO USE:
${selectedTemplate}

Return JSON with exact keys:
{
  "subject": "Clean professional subject line for ${lead.companyName}",
  "body": "Exact formatted email body following the template"
}`;

    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'].filter((v, i, a) => a.indexOf(v) === i);

    for (const currentModel of candidateModels) {
      try {
        const currentUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${settings.ai.apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const res = await fetch(currentUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!res.ok) {
          if (res.status === 429) {
            this.log('warn', `Gemini model ${currentModel} rate limited (429). Attempting fallback model...`);
            continue;
          }
          continue;
        }

        const data = await res.json() as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) continue;

        const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed.subject && parsed.body && parsed.body.includes('JESORA TECH')) {
          this.log('success', `✨ AI tailored ${track} pitch for ${lead.companyName} using exact format.`);
          return { subject: parsed.subject, body: parsed.body };
        }
      } catch (innerErr: any) {
        this.log('warn', `Model ${currentModel} error: ${innerErr.message}`);
      }
    }

    return null;
  }

  private calculateFollowUpTime(sequence: EmailSequence, currentStepNumber: number): string | undefined {
    const nextStep = sequence.steps.find(s => s.stepNumber === currentStepNumber + 1);
    if (!nextStep) return undefined;

    const delayMs = nextStep.delayDays * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + delayMs).toISOString();
  }
}
