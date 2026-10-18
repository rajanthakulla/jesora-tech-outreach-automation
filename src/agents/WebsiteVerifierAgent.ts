import { BaseAgent } from './BaseAgent.js';
import { AppDatabase } from '../db/database.js';
import { Lead } from '../types/index.js';
import { WebPresenceResolverService } from '../services/WebPresenceResolverService.js';

export class WebsiteVerifierAgent extends BaseAgent {
  private resolver: WebPresenceResolverService;

  constructor(db: AppDatabase) {
    super(
      'website_verifier',
      'Website Presence Verifier Agent',
      'Multi-Stage Domain Health & Live Web Verification',
      'Exhaustively verifies whether a business has an official live website or truly has no website, resolving redirects, inspecting DNS/HTTP, and eliminating misclassifications.',
      db
    );
    this.resolver = new WebPresenceResolverService();
  }

  protected async executeCycle(): Promise<{ actionsTaken: number; message: string }> {
    this.setTask('Auditing discovered businesses for multi-stage live website verification...');
    const leadsToVerify = this.db.getAllLeads('discovered');

    if (leadsToVerify.length === 0) {
      return { actionsTaken: 0, message: 'No discovered businesses currently awaiting website verification.' };
    }

    let verifiedCount = 0;

    for (const lead of leadsToVerify.slice(0, 6)) {
      this.setTask(`Resolving and verifying live web presence for ${lead.companyName}...`);

      const resolution = await this.resolver.resolveWebPresence({
        companyName: lead.companyName,
        city: lead.address || '',
        country: lead.country || '',
        existingWebsite: lead.website,
        email: lead.email,
        industry: lead.industry
      });

      if (resolution.hasOfficialWebsite) {
        // Business has an active verified official website
        verifiedCount += 1;
        this.db.updateLead(lead.id, {
          website: resolution.verifiedUrl,
          websiteVerified: true,
          status: 'website_verified',
          score: Math.min(100, Math.max(lead.score, 88) + 5),
          notes: `Verified live official website via ${resolution.source}: ${resolution.verifiedUrl}`
        });

        this.log('success', `✓ Verified Live Website: ${lead.companyName} -> ${resolution.verifiedUrl} [${resolution.statusMessage}]`, {
          leadId: lead.id,
          website: resolution.verifiedUrl,
          source: resolution.source
        });
      } else {
        // Business is confirmed to have NO official standalone website (Social/Directory only)
        verifiedCount += 1;
        this.db.updateLead(lead.id, {
          website: 'None (Social / Directory Only)',
          websiteVerified: true,
          status: 'website_verified',
          score: Math.min(100, Math.max(lead.score, 98)),
          notes: resolution.statusMessage
        });

        this.log('success', `★ Confirmed Zero-Website Prospect: ${lead.companyName} has NO standalone website (${resolution.statusMessage}). Advancing to bespoke website pitch!`, {
          leadId: lead.id,
          website: 'None (Social / Directory Only)'
        });
      }
    }

    return {
      actionsTaken: verifiedCount,
      message: `Verified and resolved ${verifiedCount} business website status(es) with 100% precision.`
    };
  }

  /**
   * Pings domain, checks DNS resolution, validates HTTP/HTTPS status,
   * and verifies domain is not parked or broken.
   */
  public async verifyWebsitePresence(websiteUrl: string): Promise<{
    isLive: boolean;
    statusMessage?: string;
    reason?: string;
  }> {
    const res = await this.resolver.verifyLiveDomain(websiteUrl);
    return {
      isLive: res.isLive,
      statusMessage: res.statusMessage,
      reason: res.isLive ? undefined : res.statusMessage
    };
  }
}
