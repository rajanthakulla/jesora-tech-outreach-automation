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

    // 1. Process 'audited' (deep site diagnostics ready) and 'scouted' leads (ready for Step 1)
    const auditedLeads = this.db.getAllLeads('audited');
    const scoutedLeads = this.db.getAllLeads('scouted');
    const leadsReadyForStep1 = [...auditedLeads, ...scoutedLeads];

    for (const lead of leadsReadyForStep1.slice(0, 5)) {
      const campaign = lead.campaignId ? this.db.getCampaign(lead.campaignId) : null;
      const targetSeq = (campaign?.sequenceId ? this.db.getSequenceById(campaign.sequenceId) : null) || defaultSeq;

      this.setTask(`Crafting personalized flaw-based Step 1 pitch for ${lead.companyName}...`);
      const scheduledMsg = await this.craftMessageForLead(lead, 1, targetSeq);
      if (scheduledMsg) {
        this.db.insertMessage(scheduledMsg);
        this.db.updateLead(lead.id, {
          status: 'contacted',
          currentSequenceStep: 1,
          nextFollowUpAt: this.calculateFollowUpTime(targetSeq, 1)
        });
        craftedCount += 1;
        this.log('info', `Crafted Step 1 email for ${lead.companyName} (${lead.contactName})`, {
          leadId: lead.id,
          sequence: targetSeq.name,
          subject: scheduledMsg.subject,
          hasFlawReport: Boolean(lead.flawReport)
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
          this.log('info', `Completed full ${targetSeq.name} (${targetSeq.steps.length} steps) for ${lead.companyName}`);
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

    // Format flaw report details if present (including both visual design and technical flaws)
    const flawSummary = lead.flawReport
      ? `Visual Design Flaws: ${(lead.flawReport.designFlaws || []).slice(0, 2).join('; ') || 'dated visual hierarchy, low-contrast CTA'}; Tech Flaws: ${lead.flawReport.criticalFlaws.slice(0, 2).join('; ')} (Design Score: ${lead.flawReport.designScore || 45}/100, Performance: ${lead.flawReport.performanceScore}/100, Latency: ${lead.flawReport.loadLatencyMs}ms)`
      : (lead.painPoints || 'modernizing visual UI/UX design & streamlining software workflows');

    let body = step.bodyTemplate
      .replace(/{{companyName}}/g, lead.companyName)
      .replace(/{{contactName}}/g, lead.contactName)
      .replace(/{{industry}}/g, lead.industry)
      .replace(/{{calendarBookingUrl}}/g, settings.jesoraProfile.calendarBookingUrl)
      .replace(/{{painPoints}}/g, flawSummary)
      .replace(/{{techStack}}/g, lead.techStack || 'web platform');

    // In step 1 or 2, dynamically highlight the matched case study if not already present
    if (stepNumber === 1 && !body.includes(relevantCaseStudy.title)) {
      body += `\n\nP.S. Given your focus in ${lead.industry}, you might find our recent case study interesting: ${relevantCaseStudy.title} (${relevantCaseStudy.url}) — ${relevantCaseStudy.highlight}`;
    }

    // Add optional AI enhancement if an AI key is supplied
    if (settings.ai.provider !== 'builtin' && settings.ai.apiKey) {
      try {
        const enhanced = await this.enhancePitchWithAI(subject, body, lead, stepNumber, sequence, settings);
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

    if (text.includes('automotive') || text.includes('bike') || text.includes('workshop') || text.includes('garage') || text.includes('car repair') || text.includes('auto repair') || text.includes('mechanic')) {
      return {
        title: 'MOTOFIX HUB — Service & Booking Platform',
        url: 'https://motohubfix.vercel.app',
        highlight: 'Live workshop queue tracking, customer repair estimates, and automated appointment scheduling.'
      };
    }

    if (text.includes('driving') || text.includes('salon') || text.includes('beauty') || text.includes('parlour') || text.includes('hair') || text.includes('spa') || text.includes('barber')) {
      return {
        title: 'Jesora 1-Click Client Booking & Scheduling Engine',
        url: 'https://motohubfix.vercel.app',
        highlight: 'Mobile-first 1-click booking calendar, automated appointment reminders, zero per-seat commissions.'
      };
    }

    if (text.includes('education') || text.includes('school') || text.includes('edtech') || text.includes('campus') || text.includes('lms') || text.includes('tuition') || text.includes('tutor') || text.includes('language')) {
      return {
        title: 'Radiant Montessori School Web Campus & Student Portal',
        url: 'https://rme.edu.np',
        highlight: 'Full web portal and student notice/intake system serving 2,300+ students.'
      };
    }

    if (text.includes('mortgage') || text.includes('finance') || text.includes('broker') || text.includes('loan')) {
      return {
        title: 'Jesora Secure Client Intake & Financial Document Portal',
        url: 'https://jesoratech.com',
        highlight: 'Automated client qualification, encrypted document checklist upload, and real-time application pipeline.'
      };
    }

    if (text.includes('cafe') || text.includes('coffee') || text.includes('bakery') || text.includes('restaurant')) {
      return {
        title: 'Jesora High-Speed Visual Menu & Mobile Ordering Engine',
        url: 'https://razzletikapur.vercel.app',
        highlight: 'Sub-second mobile loading, digital visual menus, table ordering, and Google review automation.'
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
    stepNumber: number,
    sequence: EmailSequence,
    settings: any
  ): Promise<{ subject: string; body: string } | null> {
    if (!settings.ai?.apiKey) return null;

    try {
      const model = settings.ai.modelName || 'gemini-3.8-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.ai.apiKey}`;
      const relevantCaseStudy = this.matchBestCaseStudy(lead);

      const flawSection = lead.flawReport
        ? `CONCRETE TECHNICAL & VISUAL UI/UX DESIGN AUDIT FINDINGS:
• Technical Health: ${lead.flawReport.performanceScore}/100 | Visual Design Score: ${lead.flawReport.designScore || 42}/100
• Load Latency / TTFB: ${lead.flawReport.loadLatencyMs}ms
• Specific Visual & UI/UX Design Flaws: ${(lead.flawReport.designFlaws && lead.flawReport.designFlaws.length > 0) ? lead.flawReport.designFlaws.join(' | ') : 'Dated typographic hierarchy, low-contrast primary action buttons, lack of modern responsive grid spacing'}
• Critical Technical & Performance Bottlenecks: ${lead.flawReport.criticalFlaws.join(' | ')}
• Conversion Bottlenecks: ${lead.flawReport.conversionBottlenecks.join(' | ')}
• Recommended Engineering & Design Modernization Fixes: ${lead.flawReport.recommendedFixes.join(' | ')}`
        : `• Observed Bottlenecks: ${lead.painPoints || 'sub-optimal mobile responsiveness, dated visual presentation, latency, and conversion drop-off'}`;

      const isEnterprise = sequence.id === 'seq-enterprise-automation';

      let stepStrategy = '';
      const hasNoWebsite = !lead.website || lead.website.toLowerCase().includes('none');

      if (hasNoWebsite && stepNumber === 1) {
        stepStrategy = `STEP 1 ANGLE: FIRST OFFICIAL WEBSITE & 1-CLICK MOBILE BOOKING ENGINE LAUNCH
- Context: ${lead.companyName} currently has ZERO official website or digital booking portal in ${lead.country}.
- Hook: Acknowledge that while ${lead.companyName} is well-regarded locally, customers searching on Google Maps and mobile have no direct website to view your full services, pricing, or book an appointment online.
- Pain Point: Right now, 100% of organic search traffic and after-hours bookings are lost to local competitors who have online booking portals.
- The Solution: We engineer custom, high-speed Next.js websites with built-in 1-click appointment booking, mobile-first visual polish, and automated review collection in 2 weeks with 100% source code ownership (zero monthly software fees).
- Social Proof: Mention ${relevantCaseStudy.title} (${relevantCaseStudy.url}): "${relevantCaseStudy.highlight}".
- Call To Action: Low-friction ask: "Would you be against taking a 2-minute peek at a prototype website concept we sketched out for ${lead.companyName}?"`;
      } else if (isEnterprise) {
        if (stepNumber === 1) {
          stepStrategy = `STEP 1 ANGLE: OPERATIONAL OVERHEAD & BESPOKE INTERNAL WORKFLOW REDESIGN
- Hook: Acknowledge that in ${lead.industry}, manual phone calls, spreadsheet chaos, and rigid off-the-shelf software create friction for both customers and staff.
- Industry Tailoring:
  * If Beauty Parlour / Hair Salon / Barber: Emphasize editorial luxury visual aesthetics, frictionless 1-click mobile appointment booking, and automated review capture.
  * If Driving School: Emphasize student lesson scheduling, instructor availability calendar, and automated booking notifications.
  * If Garage / Auto Repair: Emphasize live vehicle service queue tracking, customer repair quote approvals, and automated job status notifications (like MotoFix Hub).
  * If Tuition Center / Language School / Academy: Emphasize student registration portal, course timetable intake, and automated parent/student communication.
  * If Cafe / Coffee Shop: Emphasize instant mobile visual menu, high-conversion visual design, local SEO, and automated 5-star Google review capture.
  * If Mortgage Center: Emphasize high-trust modern UI, secure document checklist upload, and automated client qualification funnel.
- Flaw Insight: Highlight both the visual clutter / UX friction and technical bottlenecks found on their portal:
${flawSection}
- Introduce: Custom lightweight Cloud ERP / Booking Engine and real-time database designed 100% for ${lead.companyName}.
- Highlights: 100% full source code ownership, zero recurring per-seat monthly license fees.
- Social Proof: Mention ${relevantCaseStudy.title} (${relevantCaseStudy.url}): "${relevantCaseStudy.highlight}".
- Call To Action: Low-friction ask for a 10-minute discovery call to explore eliminating 10+ hours/week of manual admin overhead.`;
        } else if (stepNumber === 2) {
          stepStrategy = `STEP 2 ANGLE: CASE STUDY TEARDOWN & CONCRETE TIME-SAVINGS
- Hook: Re-engage with operational metrics from real engineering deployments.
- Teardown: Explain how MotoFix replaced whiteboard queues with real-time bay tracking, instant booking, and automated invoice triggers.
- Delivery Model: Production tools built in focused 2 to 4-week sprints with 100% code handover.
- Call To Action: Propose a quick 10-minute chat this Thursday/Friday or share calendar booking link (${settings.jesoraProfile?.calendarBookingUrl || 'https://calendly.com/techjesora/30min'}).`;
        } else if (stepNumber === 3) {
          stepStrategy = `STEP 3 ANGLE: THE HIDDEN SAAS SUBSCRIPTION TAX VS OWNED ASSET
- Hook: Contrast paying $300-$1,500/month forever in SaaS subscription fees vs owning proprietary software.
- The Solution: Custom Next.js & PostgreSQL internal tool hosted on their own cloud — zero per-user seat fees forever, 100% data privacy.
- Call To Action: Offer to prepare a high-level feasibility outline showing what a custom portal for ${lead.companyName} would look like.`;
        } else if (stepNumber === 4) {
          stepStrategy = `STEP 4 ANGLE: FREE DATABASE SCHEMA & WORKFLOW BLUEPRINT (ZERO OBLIGATION)
- Offer: Complimentary Database Schema (ERD) & API Integration Blueprint specifically drafted for ${lead.companyName}.
- Value: Completely free to keep with zero strings attached, even if built internally.
- Call To Action: Direct calendar link to claim the blueprint in a 15-minute scoping chat.`;
        } else {
          stepStrategy = `STEP 5 ANGLE: PROFESSIONAL FILE ARCHIVE & FOUNDER ROLODEX
- Tone: High-status, respectful, zero desperation.
- Message: Closing the file on workflow automation for now so we don't clutter their inbox.
- Leave: Direct email (techjesora@gmail.com | jesoratech.com) for whenever custom software or an urgent sprint becomes a priority.`;
        }
      } else {
        // Modern Web & Engineering Sequence (seq-jesora-fullstack)
        if (stepNumber === 1) {
          stepStrategy = `STEP 1 ANGLE: BESPOKE CONCEPT REDESIGN HOOK & DUAL DESIGN/PERFORMANCE AUDIT BREAKDOWN
- Hook: Our design & engineering team already audited their live web presence at ${lead.website || lead.companyName} and built a rapid concept redesign prototype specifically modernizing their visual design and eliminating performance bottlenecks.
- Specific Flaws to Call Out: Call out both their visual design flaws (e.g. ${(lead.flawReport?.designFlaws || []).slice(0, 2).join('; ') || 'dated visual hierarchy and buried CTA'}) and speed/technical lag:
${flawSection}
  Contrast this against our sleek custom Next.js/React architecture, bespoke Tailwind typography, high-contrast CTA, and sub-second page loads.
- Jesora Tech Pillars: 100% full source code ownership from Day 1, agile 2-week delivery sprints, 40-60% cost advantage.
- Social Proof: ${relevantCaseStudy.title} (${relevantCaseStudy.url}): "${relevantCaseStudy.highlight}".
- Call To Action: Low-resistance question: "Would you be against taking a 2-minute peek at the concept redesign prototype we sketched out for you?"`;
        } else if (stepNumber === 2) {
          stepStrategy = `STEP 2 ANGLE: UNDER-THE-HOOD ENGINEERING PROOF & PRODUCTION DEMOS
- Hook: Quick follow-up on the concept prototype sketched for ${lead.companyName}.
- Teardown: Highlight execution standards from WriteWell (writewell.space, zero latency AI SaaS) and MotoFix (motohubfix.vercel.app, live booking queue).
- Positioning: Turnkey production software with zero vendor lock-in.
- Call To Action: 10-minute chat or direct calendar link (${settings.jesoraProfile?.calendarBookingUrl || 'https://calendly.com/techjesora/30min'}).`;
        } else if (stepNumber === 3) {
          stepStrategy = `STEP 3 ANGLE: 3-POINT CONVERSION BOTTLENECK TEARDOWN & MOBILE FRICTION
- Hook: Ran deeper technical benchmarks on their live website during prototype tuning.
- 3 Friction Points:
  1. Latency & Core Web Vitals (slow TTFB and layout shift causing 30-40% visitor bounce).
  2. Mobile inquiry pathway (too many manual form steps instead of instant friction-free booking).
  3. Legacy stack drag (monolith vs. decoupled Next.js & Tailwind).
- Call To Action: Offer to record a personalized 2-minute Loom video walking through the interactive differences.`;
        } else if (stepNumber === 4) {
          stepStrategy = `STEP 4 ANGLE: FREE TECHNICAL ARCHITECTURE & DATABASE BLUEPRINT (ZERO OBLIGATIONS)
- Value Proposition: Completely complimentary Technical Architecture & Feasibility Blueprint for ${lead.companyName}.
- Contents: Recommended modern stack (Next.js, Node.js/Python, PostgreSQL), database ERD schema, API roadmap, 2-week sprint breakdown.
- Freedom: Free to keep forever even if they build internally or hire elsewhere.
- Call To Action: 15-minute calendar link to request the blueprint.`;
        } else if (stepNumber === 5) {
          stepStrategy = `STEP 5 ANGLE: STAGING PREVIEW & TRANSPARENT 2-WEEK SPRINT ECONOMICS
- Hook: Showing how Jesora Tech eliminates common software delivery headaches.
- Mechanics: Focused 2-week agile sprints, fixed transparent pricing (40-60% below US/Western European agencies), weekly Friday production deployments, daily async Loom updates, direct senior developer access with zero junior handoffs.
- Call To Action: Calendar link for an introductory review of the concept preview or roadmap.`;
        } else {
          stepStrategy = `STEP 6 ANGLE: PROFESSIONAL GRACEFUL BREAK-UP & FOUNDER ROLODEX ARCHIVE
- Tone: High-status, gracious, respectful of their priorities.
- Message: Safely archiving the concept preview to keep their inbox clean.
- Rolodex: Leaving direct email and contact for future urgent dev sprints (techjesora@gmail.com | jesoratech.com).`;
        }
      }

      const prompt = `You are an elite B2B engineering growth copywriter for JESORA TECH (jesoratech.com), a premier custom software and web development partner founded by Rajan Thakulla, based in Tinkune, Kathmandu, Nepal.

YOUR GOAL:
Draft a personalized, high-converting B2B cold outreach email that grabs the prospect's attention immediately and feels completely bespoke (NEVER generic, robotic, or templated).

TARGET PROSPECT:
• Company: ${lead.companyName} (${lead.industry})
• Contact: ${lead.contactName} (${lead.contactTitle || 'Founder / Decision Maker'})
• Website: ${lead.website}
• Physical Address: ${lead.address || 'Headquarters'}
• Tech Stack: ${lead.techStack || 'Web infrastructure'}

SEQUENCE CONTEXT:
• Sequence Name: ${sequence.name}
• Sequence Step: Step ${stepNumber} of ${sequence.steps.length}
• Sequence Goal: ${sequence.steps.find(s => s.stepNumber === stepNumber)?.purpose || 'Consultative outreach'}

${stepStrategy}

CRITICAL COPYWRITING DIRECTIVES:
1. Speak peer-to-peer as a senior software engineer and technical founder, not a pushy marketer or generic agency.
2. Format in short, punchy, scannable paragraphs (2-3 sentences max) optimized for mobile screens.
3. No generic agency fluff like "hope this email finds you well" or "we are a leading IT firm".
4. Base subject line draft: "${subject}". Feel free to sharpen it into an irresistible, personalized subject line.
5. Base body context:
${body}

Return JSON with exact keys:
{
  "subject": "Compelling, bespoke subject line",
  "body": "Complete, polished, persuasive email body signed by Rajan Thakulla & The JESORA TECH Team"
}`;

      const candidateModels = [model, 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'].filter((v, i, a) => a.indexOf(v) === i);

      for (const currentModel of candidateModels) {
        try {
          const currentUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${settings.ai.apiKey}`;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 25000);

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
            const errText = await res.text().catch(() => '');
            if (res.status === 429) {
              this.log('warn', `Gemini model ${currentModel} rate limited (429). Attempting fallback model...`);
              continue;
            }
            this.log('warn', `Gemini API (${currentModel}) returned status ${res.status}: ${errText.slice(0, 100)}`);
            continue;
          }

          const data = await res.json() as any;
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) continue;

          const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
          const parsed = JSON.parse(cleaned);
          if (parsed.subject && parsed.body) {
            this.log('success', `✨ Gemini AI (${currentModel}) crafted bespoke Step ${stepNumber} copy for ${lead.companyName}`);
            return { subject: parsed.subject, body: parsed.body };
          }
        } catch (innerErr: any) {
          this.log('warn', `Model ${currentModel} error: ${innerErr.message}`);
        }
      }
    } catch (err: any) {
      this.log('warn', `AI pitch enhancement fallback to template: ${err.message}`);
    }
    return null;
  }
}
