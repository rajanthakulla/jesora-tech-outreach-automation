import { BaseAgent } from './BaseAgent.js';
import { AppDatabase } from '../db/database.js';
import { Lead, OutreachMessage, EmailSequence, SequenceStep } from '../types/index.js';
import crypto from 'node:crypto';

export class PitchCrafterAgent extends BaseAgent {
  constructor(db: AppDatabase) {
    super(
      'pitch_crafter',
      'Pitch Crafter Agent',
      'AI Personalization & Sequence Architecture',
      'Architects personalized multi-step cold outreach sequences matching prospect tech gaps to Jesora Tech case studies.',
      db
    );
  }

  protected async executeCycle(): Promise<{ actionsTaken: number; message: string }> {
    this.setTask('Finding leads ready for outreach copy generation...');
    const settings = this.db.getSettings();
    const sequences = this.db.getAllSequences();
    const defaultSeq = sequences[0];

    if (!defaultSeq) {
      return { actionsTaken: 0, message: 'No email sequences found in database.' };
    }

    let craftedCount = 0;

    // 1. Process 'scouted' leads (ready for Step 1)
    const scoutedLeads = this.db.getAllLeads('scouted');
    for (const lead of scoutedLeads.slice(0, 5)) {
      this.setTask(`Crafting personalized Step 1 pitch for ${lead.companyName}...`);
      const scheduledMsg = await this.craftMessageForLead(lead, 1, defaultSeq);
      if (scheduledMsg) {
        this.db.insertMessage(scheduledMsg);
        this.db.updateLead(lead.id, {
          status: 'contacted',
          currentSequenceStep: 1,
          nextFollowUpAt: this.calculateFollowUpTime(defaultSeq, 1)
        });
        craftedCount += 1;
        this.log('info', `Crafted Step 1 email for ${lead.companyName} (${lead.contactName})`, {
          leadId: lead.id,
          subject: scheduledMsg.subject
        });
      }
    }

    // 2. Process 'contacted' leads due for follow-ups (Step 2, 3, or 4)
    const contactedLeads = this.db.getAllLeads('contacted');
    const now = new Date();

    for (const lead of contactedLeads.slice(0, 5)) {
      if (!lead.nextFollowUpAt) continue;
      const nextDue = new Date(lead.nextFollowUpAt);

      if (nextDue <= now) {
        const nextStepNum = lead.currentSequenceStep + 1;
        const targetStep = defaultSeq.steps.find(s => s.stepNumber === nextStepNum);

        if (targetStep) {
          this.setTask(`Crafting Step ${nextStepNum} follow-up for ${lead.companyName}...`);
          const scheduledMsg = await this.craftMessageForLead(lead, nextStepNum, defaultSeq);
          if (scheduledMsg) {
            this.db.insertMessage(scheduledMsg);
            this.db.updateLead(lead.id, {
              currentSequenceStep: nextStepNum,
              nextFollowUpAt: this.calculateFollowUpTime(defaultSeq, nextStepNum)
            });
            craftedCount += 1;
            this.log('info', `Crafted Step ${nextStepNum} follow-up for ${lead.companyName}`, {
              leadId: lead.id,
              subject: scheduledMsg.subject
            });
          }
        } else {
          // Completed all sequence steps
          this.db.updateLead(lead.id, {
            nextFollowUpAt: undefined
          });
        }
      }
    }

    return {
      actionsTaken: craftedCount,
      message: `Personalized and queued ${craftedCount} outreach sequence emails.`
    };
  }

  /**
   * Crafts tailored email using template variables and Jesora Tech case studies
   */
  public async craftMessageForLead(
    lead: Lead,
    stepNumber: number,
    sequence: EmailSequence
  ): Promise<OutreachMessage | null> {
    const step = sequence.steps.find(s => s.stepNumber === stepNumber);
    if (!step) return null;

    const settings = this.db.getSettings();
    const relevantCaseStudy = this.matchBestCaseStudy(lead);

    // Apply template replacements
    let subject = step.subjectTemplate
      .replace(/{{companyName}}/g, lead.companyName)
      .replace(/{{contactName}}/g, lead.contactName)
      .replace(/{{industry}}/g, lead.industry);

    let body = step.bodyTemplate
      .replace(/{{companyName}}/g, lead.companyName)
      .replace(/{{contactName}}/g, lead.contactName)
      .replace(/{{industry}}/g, lead.industry)
      .replace(/{{calendarBookingUrl}}/g, settings.jesoraProfile.calendarBookingUrl)
      .replace(/{{painPoints}}/g, lead.painPoints || 'streamlining software workflows')
      .replace(/{{techStack}}/g, lead.techStack || 'web platform');

    // In step 1 or 2, dynamically highlight the matched case study if not already present
    if (stepNumber === 1 && !body.includes(relevantCaseStudy.title)) {
      body += `\n\nP.S. Given your focus in ${lead.industry}, you might find our recent case study interesting: ${relevantCaseStudy.title} (${relevantCaseStudy.url}) — ${relevantCaseStudy.highlight}`;
    }

    // Add optional AI enhancement if an AI key is supplied
    if (settings.ai.provider !== 'builtin' && settings.ai.apiKey) {
      try {
        const enhanced = await this.enhancePitchWithAI(subject, body, lead, settings);
        if (enhanced) {
          subject = enhanced.subject;
          body = enhanced.body;
        }
      } catch (err: any) {
        this.log('warn', `AI pitch enhancement fallback to template: ${err.message}`);
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

  private matchBestCaseStudy(lead: Lead) {
    const text = `${lead.industry} ${lead.companyName} ${lead.painPoints || ''}`.toLowerCase();

    if (text.includes('ai') || text.includes('saas') || text.includes('writing') || text.includes('text')) {
      return {
        title: 'WriteWell — AI Writing Humanizer SaaS',
        url: 'https://www.writewell.space',
        highlight: 'Engineered AI prose refinement engine with zero latency and high retention.'
      };
    }

    if (text.includes('automotive') || text.includes('bike') || text.includes('workshop') || text.includes('booking') || text.includes('service')) {
      return {
        title: 'MOTOFIX HUB — Service & Booking Platform',
        url: 'https://motohubfix.vercel.app',
        highlight: 'Live workshop queue tracking, automated appointment scheduling, package billing.'
      };
    }

    if (text.includes('education') || text.includes('school') || text.includes('edtech') || text.includes('campus') || text.includes('lms')) {
      return {
        title: 'Radiant Montessori School Web Campus',
        url: 'https://rme.edu.np',
        highlight: 'Full web portal and student notice system serving 2,300+ students.'
      };
    }

    if (text.includes('retail') || text.includes('e-commerce') || text.includes('store') || text.includes('gadgets') || text.includes('electronics')) {
      return {
        title: 'Razzle Showroom — Retail & Gadgets',
        url: 'https://razzletikapur.vercel.app',
        highlight: 'High-speed digital catalog, cart management, and inventory checkout.'
      };
    }

    if (text.includes('non-profit') || text.includes('community') || text.includes('donation') || text.includes('recycle')) {
      return {
        title: 'We-Cycle Ames Platform (Iowa, USA)',
        url: 'https://www.wecycleames.org',
        highlight: 'Community bicycle recycling logistics, donation workflows, and volunteer portal.'
      };
    }

    // Default to WriteWell & Custom ERP
    return {
      title: 'WriteWell & Custom Enterprise Cloud ERPs',
      url: 'https://jesoratech.com',
      highlight: 'Engineered high-performance web platforms and automated ERPs with 100% source code ownership.'
    };
  }

  private calculateFollowUpTime(sequence: EmailSequence, currentStepNumber: number): string | undefined {
    const nextStep = sequence.steps.find(s => s.stepNumber === currentStepNumber + 1);
    if (!nextStep) return undefined;

    const delayMs = nextStep.delayDays * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + delayMs).toISOString();
  }

  private async enhancePitchWithAI(
    subject: string,
    body: string,
    lead: Lead,
    settings: any
  ): Promise<{ subject: string; body: string } | null> {
    // If external AI endpoint is configured, make call here; otherwise return structured template
    return null;
  }
}
