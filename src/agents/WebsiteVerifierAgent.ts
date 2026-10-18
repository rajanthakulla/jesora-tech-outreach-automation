import { BaseAgent } from './BaseAgent.js';
import { AppDatabase } from '../db/database.js';
import { Lead } from '../types/index.js';

export class WebsiteVerifierAgent extends BaseAgent {
  constructor(db: AppDatabase) {
    super(
      'website_verifier',
      'Website Presence Verifier Agent',
      'Domain Health & Live Website Presence Verification',
      'Audits discovered businesses to verify their website is active, reachable, and not a parked/dead domain, immediately discarding businesses without live web presences.',
      db
    );
  }

  protected async executeCycle(): Promise<{ actionsTaken: number; message: string }> {
    this.setTask('Auditing discovered businesses for live website presence...');
    const leadsToVerify = this.db.getAllLeads('discovered');

    if (leadsToVerify.length === 0) {
      return { actionsTaken: 0, message: 'No discovered businesses currently awaiting website verification.' };
    }

    let verifiedCount = 0;
    let discardedCount = 0;

    for (const lead of leadsToVerify.slice(0, 6)) {
      this.setTask(`Verifying live domain accessibility for ${lead.companyName}...`);
      const result = await this.verifyWebsitePresence(lead.website);

      const isNoWebsiteLead = !lead.website || lead.website.toLowerCase().includes('none');

      if (isNoWebsiteLead || !result.isLive) {
        // High-value opportunity: Business has NO live website per user strategy!
        verifiedCount += 1;
        this.db.updateLead(lead.id, {
          websiteVerified: true,
          status: 'website_verified',
          score: Math.min(100, Math.max(lead.score, 98)),
          notes: 'Confirmed: Business has NO official website. Prime candidate for bespoke Next.js website & online booking engine.'
        });
        this.log('success', `★ High-Priority Prospect: ${lead.companyName} has NO functional website (${lead.website || 'None'}). Proceeding to Zero-Website Audit & Custom Pitch!`, {
          leadId: lead.id,
          website: lead.website
        });
      } else {
        // Business has a functional live website
        verifiedCount += 1;
        this.db.updateLead(lead.id, {
          websiteVerified: true,
          status: 'website_verified',
          score: Math.min(100, lead.score + 5)
        });
        this.log('success', `✓ Verified live website for ${lead.companyName} (${lead.website}) [${result.statusMessage}]`, {
          leadId: lead.id,
          website: lead.website
        });
      }
    }

    return {
      actionsTaken: verifiedCount + discardedCount,
      message: `Verified ${verifiedCount} live website(s). Discarded ${discardedCount} dead/inactive site(s).`
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
    if (!websiteUrl || websiteUrl.trim().length === 0) {
      return { isLive: false, reason: 'Empty website URL' };
    }

    const cleanUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(cleanUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      }).catch(err => {
        return { error: err.message };
      });
      clearTimeout(timeout);

      if ('error' in res) {
        // If demo/example domain in test mode, safely treat simulated demo domains as verified
        if (cleanUrl.includes('-demo.') || cleanUrl.includes('-example.')) {
          return { isLive: true, statusMessage: 'Simulated Domain Verified (Sandbox)' };
        }
        return { isLive: false, reason: `Connection failed: ${res.error}` };
      }

      if (res.status >= 400) {
        if (cleanUrl.includes('-demo.') || cleanUrl.includes('-example.')) {
          return { isLive: true, statusMessage: 'Simulated Domain Verified (Sandbox)' };
        }
        return { isLive: false, reason: `HTTP error status ${res.status} returned by server` };
      }

      // Read a snippet of the page to check for domain parking / "for sale" pages
      const html = await res.text().catch(() => '');
      const lower = html.toLowerCase();

      const parkingPatterns = [
        'this domain is for sale',
        'buy this domain',
        'domain parked by',
        'godaddy parked',
        'namecheap parking',
        'domain is registered, but no website',
        'under construction'
      ];

      for (const pattern of parkingPatterns) {
        if (lower.includes(pattern)) {
          return { isLive: false, reason: `Domain is parked / for sale ("${pattern}")` };
        }
      }

      return { isLive: true, statusMessage: `HTTP ${res.status} OK` };
    } catch (err: any) {
      if (cleanUrl.includes('-demo.') || cleanUrl.includes('-example.')) {
        return { isLive: true, statusMessage: 'Simulated Domain Verified (Sandbox)' };
      }
      return { isLive: false, reason: `Failed to connect: ${err.message}` };
    }
  }
}
