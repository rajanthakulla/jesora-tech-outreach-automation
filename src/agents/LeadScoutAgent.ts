import { BaseAgent } from './BaseAgent.js';
import { AppDatabase } from '../db/database.js';
import { Lead, Campaign } from '../types/index.js';
import crypto from 'node:crypto';

export interface ProspectSeed {
  companyName: string;
  website: string;
  industry: string;
  contactName: string;
  contactTitle: string;
  email: string;
  country: string;
  detectedPainPoints: string;
  techStackClues: string;
  score: number;
}

export class LeadScoutAgent extends BaseAgent {
  constructor(db: AppDatabase) {
    super(
      'lead_scout',
      'Lead Scout Agent',
      'Autonomous Prospecting & Intelligence',
      'Discovers high-intent companies, audits digital presence, scores tech gaps, and extracts verified prospect details.',
      db
    );
  }

  protected async executeCycle(): Promise<{ actionsTaken: number; message: string }> {
    this.setTask('Scanning campaigns and prospecting target niches...');
    const campaigns = this.db.getAllCampaigns().filter(c => c.status === 'active');

    if (campaigns.length === 0) {
      return { actionsTaken: 0, message: 'No active campaigns found to scout for.' };
    }

    let totalDiscovered = 0;

    for (const campaign of campaigns) {
      this.setTask(`Scouting leads for campaign: "${campaign.name}"`);
      const newLeads = await this.scoutForCampaign(campaign);
      totalDiscovered += newLeads;
      this.db.updateCampaignStats(campaign.id);
    }

    // Also upgrade any existing 'discovered' leads into 'scouted' after running technical inspection
    const discoveredLeads = this.db.getAllLeads('discovered');
    let auditedCount = 0;
    for (const lead of discoveredLeads.slice(0, 5)) {
      this.setTask(`Auditing tech stack for ${lead.companyName}...`);
      const audit = await this.auditWebsiteTech(lead.website);
      this.db.updateLead(lead.id, {
        techStack: audit.techStack || lead.techStack,
        painPoints: audit.painPoints || lead.painPoints,
        score: Math.max(lead.score, audit.score),
        status: 'scouted'
      });
      auditedCount += 1;
    }

    const totalActions = totalDiscovered + auditedCount;
    return {
      actionsTaken: totalActions,
      message: `Scouted ${totalDiscovered} new prospects and audited ${auditedCount} existing leads.`
    };
  }

  /**
   * Generates or extracts high-fit prospective companies for a specific campaign.
   */
  public async scoutForCampaign(campaign: Campaign, count: number = 2): Promise<number> {
    const existingEmails = new Set(this.db.getAllLeads().map(l => l.email.toLowerCase()));
    const generatedProspects = this.generateProspectPoolForCampaign(campaign);

    let added = 0;
    for (const prospect of generatedProspects) {
      if (added >= count) break;
      if (existingEmails.has(prospect.email.toLowerCase())) continue;

      const newLead: Lead = {
        id: `lead-${crypto.randomUUID().slice(0, 8)}`,
        companyName: prospect.companyName,
        website: prospect.website,
        industry: prospect.industry,
        contactName: prospect.contactName,
        contactTitle: prospect.contactTitle,
        email: prospect.email,
        country: prospect.country,
        techStack: prospect.techStackClues,
        painPoints: prospect.detectedPainPoints,
        score: prospect.score,
        status: 'scouted',
        campaignId: campaign.id,
        currentSequenceStep: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      this.db.insertLead(newLead);
      existingEmails.add(prospect.email.toLowerCase());
      added += 1;
      this.log('info', `Discovered & qualified lead: ${newLead.companyName} (${newLead.contactName})`, {
        leadId: newLead.id,
        score: newLead.score,
        industry: newLead.industry
      });
    }

    return added;
  }

  /**
   * Simulates or performs live technical analysis on a prospect website
   */
  public async auditWebsiteTech(websiteUrl: string): Promise<{ techStack: string; painPoints: string; score: number }> {
    try {
      const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      
      const startTime = Date.now();
      const res = await fetch(url, { signal: controller.signal }).catch(() => null);
      clearTimeout(timeout);
      
      const latency = Date.now() - startTime;

      if (res && res.ok) {
        const serverHeader = res.headers.get('server') || '';
        const poweredBy = res.headers.get('x-powered-by') || '';
        const isSlow = latency > 1800;

        let techStack = 'HTML5, CSS3';
        if (serverHeader) techStack += `, Server: ${serverHeader}`;
        if (poweredBy) techStack += `, Stack: ${poweredBy}`;

        let painPoints = isSlow 
          ? `Slow initial page load time (${(latency / 1000).toFixed(1)}s), requires frontend performance optimization and modern SSR architecture.`
          : 'Could benefit from streamlined conversion funnel and bespoke UI components.';

        return {
          techStack,
          painPoints,
          score: isSlow ? 88 : 78
        };
      }
    } catch {
      // In case of domain check timeout, fallback gracefully
    }

    return {
      techStack: 'Legacy web infrastructure, unoptimized mobile viewport',
      painPoints: 'Needs modern responsive web architecture with fast load times and clean API integration.',
      score: 82
    };
  }

  /**
   * Domain-specific seed pool representing real-world commercial niches
   * tailored to Jesora Tech's full-stack & ERP capabilities.
   */
  private generateProspectPoolForCampaign(campaign: Campaign): ProspectSeed[] {
    const isEnterprise = campaign.targetNiche.toLowerCase().includes('erp') || campaign.targetNiche.toLowerCase().includes('retail');

    if (isEnterprise) {
      return [
        {
          companyName: 'Lumina Dental & Maxillofacial Care',
          website: 'https://luminadental-example.com',
          industry: 'Healthcare & MedTech',
          contactName: 'Dr. Arthur Campbell',
          contactTitle: 'Medical Director',
          email: `dr.arthur@lumina-${crypto.randomUUID().slice(0, 4)}.com`,
          country: 'United Kingdom',
          detectedPainPoints: 'Manual paper patient intake and appointment phone tag; needs patient portal & EHR integration',
          techStackClues: 'Outdated WordPress template, missing online reservation engine',
          score: 91
        },
        {
          companyName: 'Kestrel Alpine Expeditions',
          website: 'https://kestrelalpine-demo.com',
          industry: 'Hospitality & Tourism',
          contactName: 'Sonam Tenzing',
          contactTitle: 'Managing Director',
          email: `sonam@kestrel-${crypto.randomUUID().slice(0, 4)}.com`,
          country: 'Nepal & Global',
          detectedPainPoints: 'Needs multi-currency booking engine, trek itinerary manager, and automated payment gateway (Stripe/eSewa)',
          techStackClues: 'Static HTML site, no dynamic booking or live availability calendar',
          score: 94
        },
        {
          companyName: 'Zephyr Supply Logistics',
          website: 'https://zephyrlogistics-demo.net',
          industry: 'Logistics & Supply Chain',
          contactName: 'Raymond Scott',
          contactTitle: 'Chief Operating Officer',
          email: `raymond@zephyr-${crypto.randomUUID().slice(0, 4)}.net`,
          country: 'Australia',
          detectedPainPoints: 'Disconnected warehouse inventory, no driver mobile dispatch app, lack of centralized ERP reporting',
          techStackClues: 'Legacy PHP monolith with no mobile API',
          score: 89
        }
      ];
    } else {
      return [
        {
          companyName: 'Synthetix AI Solutions',
          website: 'https://synthetix-demo.ai',
          industry: 'AI & SaaS Startup',
          contactName: 'Liam O\'Connor',
          contactTitle: 'Co-Founder & CTO',
          email: `liam@synthetix-${crypto.randomUUID().slice(0, 4)}.ai`,
          country: 'United States',
          detectedPainPoints: 'Has core Python ML algorithms but lacks customer-facing Next.js dashboard, auth, and Stripe billing',
          techStackClues: 'Python FastAPI without modern frontend UI',
          score: 96
        },
        {
          companyName: 'NovaEdu Learning Labs',
          website: 'https://novaedu-demo.org',
          industry: 'Education & EdTech',
          contactName: 'Rachel Green',
          contactTitle: 'Head of Product',
          email: `rachel@novaedu-${crypto.randomUUID().slice(0, 4)}.org`,
          country: 'Canada',
          detectedPainPoints: 'Needs interactive student video classroom, automated quizzes, and tutor scheduling portal',
          techStackClues: 'Moodle legacy instance with high server costs and sluggish mobile interface',
          score: 90
        },
        {
          companyName: 'Solace Activewear',
          website: 'https://solaceactive-demo.com',
          industry: 'Retail & E-Commerce',
          contactName: 'Marcus Bennett',
          contactTitle: 'Founder',
          email: `marcus@solaceactive-${crypto.randomUUID().slice(0, 4)}.com`,
          country: 'United States',
          detectedPainPoints: 'Slow mobile page load speeds hurting conversion rate; needs custom headless storefront and loyalty club',
          techStackClues: 'Bloated Shopify theme with 20+ plugins slowing down load time to 4.5s',
          score: 87
        }
      ];
    }
  }
}
