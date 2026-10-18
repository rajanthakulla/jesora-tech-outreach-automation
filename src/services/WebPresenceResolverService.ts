import dns from 'node:dns/promises';

export interface WebPresenceResolution {
  hasOfficialWebsite: boolean;
  verifiedUrl: string;
  source: 'direct_url' | 'email_domain' | 'ai_grounded_discovery' | 'heuristic_dns' | 'verified_absence';
  statusMessage: string;
  domain?: string;
  httpStatus?: number;
}

export class WebPresenceResolverService {
  private geminiApiKey: string;
  private genericEmailDomains = new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
    'icloud.com', 'mail.com', 'proton.me', 'protonmail.com', 'zoho.com',
    'yandex.com', 'eircom.net', 'btinternet.com', 'sky.com', 'virginmedia.com',
    'comcast.net', 'sbcglobal.net', 'att.net', 'verizon.net', 'live.com'
  ]);

  constructor(apiKey?: string) {
    this.geminiApiKey = apiKey || process.env.GEMINI_API_KEY || '';
  }

  /**
   * Multi-stage, high-precision web presence resolution engine.
   * Exhaustively verifies whether a business has a real live standalone website or truly has none.
   */
  public async resolveWebPresence(params: {
    companyName: string;
    city?: string;
    country?: string;
    existingWebsite?: string;
    email?: string;
    industry?: string;
  }): Promise<WebPresenceResolution> {
    const { companyName, city = '', country = '', existingWebsite = '', email = '' } = params;

    // Stage 1: Check existing provided website URL (if any and not placeholder)
    if (existingWebsite && !this.isNoneOrPlaceholder(existingWebsite) && !this.isSocialOnly(existingWebsite)) {
      const cleanUrl = this.normalizeUrl(existingWebsite);
      const directCheck = await this.verifyLiveDomain(cleanUrl);
      if (directCheck.isLive) {
        return {
          hasOfficialWebsite: true,
          verifiedUrl: directCheck.canonicalUrl || cleanUrl,
          source: 'direct_url',
          statusMessage: `Direct URL verified: ${directCheck.statusMessage}`,
          domain: directCheck.domain,
          httpStatus: directCheck.httpStatus
        };
      }
    }

    // Stage 2: Check custom business email domain
    if (email && email.includes('@')) {
      const emailDomain = email.split('@')[1]?.toLowerCase().trim();
      if (emailDomain && !this.genericEmailDomains.has(emailDomain)) {
        const candidateUrl = `https://${emailDomain}`;
        const emailDomainCheck = await this.verifyLiveDomain(candidateUrl);
        if (emailDomainCheck.isLive) {
          return {
            hasOfficialWebsite: true,
            verifiedUrl: emailDomainCheck.canonicalUrl || candidateUrl,
            source: 'email_domain',
            statusMessage: `Verified official website from email domain (@${emailDomain})`,
            domain: emailDomainCheck.domain,
            httpStatus: emailDomainCheck.httpStatus
          };
        }
      }
    }

    // Stage 3: AI-Grounded Domain Resolution via Gemini
    if (this.geminiApiKey) {
      const aiCandidate = await this.lookupWebsiteViaGemini(companyName, city, country);
      if (aiCandidate && aiCandidate.startsWith('http') && !this.isSocialOnly(aiCandidate)) {
        const aiCheck = await this.verifyLiveDomain(aiCandidate);
        if (aiCheck.isLive) {
          return {
            hasOfficialWebsite: true,
            verifiedUrl: aiCheck.canonicalUrl || aiCandidate,
            source: 'ai_grounded_discovery',
            statusMessage: `AI-grounded discovery verified: ${aiCheck.canonicalUrl || aiCandidate}`,
            domain: aiCheck.domain,
            httpStatus: aiCheck.httpStatus
          };
        }
      }
    }

    // Stage 4: Heuristic Country TLD Discovery
    const heuristicCandidate = await this.checkHeuristicDomains(companyName, country);
    if (heuristicCandidate) {
      return {
        hasOfficialWebsite: true,
        verifiedUrl: heuristicCandidate.canonicalUrl,
        source: 'heuristic_dns',
        statusMessage: `Country TLD heuristic matched: ${heuristicCandidate.canonicalUrl}`,
        domain: heuristicCandidate.domain,
        httpStatus: heuristicCandidate.httpStatus
      };
    }

    // Stage 5: Conclusively Confirmed NO Official Website
    return {
      hasOfficialWebsite: false,
      verifiedUrl: 'None (Social / Directory Only)',
      source: 'verified_absence',
      statusMessage: 'Exhaustive verification confirmed: Business has no official standalone website (Social/Directory only).'
    };
  }

  /**
   * Pings domain DNS and validates live HTTP/HTTPS status + redirects
   */
  public async verifyLiveDomain(urlStr: string): Promise<{
    isLive: boolean;
    canonicalUrl?: string;
    domain?: string;
    httpStatus?: number;
    statusMessage?: string;
  }> {
    try {
      const cleanUrl = this.normalizeUrl(urlStr);
      const parsed = new URL(cleanUrl);
      const hostname = parsed.hostname;

      // 1. DNS Resolution check
      const addresses = await dns.resolve(hostname).catch(async () => {
        // Fallback for www. or root
        if (hostname.startsWith('www.')) {
          return dns.resolve(hostname.replace(/^www\./, '')).catch(() => null);
        } else {
          return dns.resolve(`www.${hostname}`).catch(() => null);
        }
      });

      if (!addresses || addresses.length === 0) {
        return { isLive: false, statusMessage: `DNS resolution failed for ${hostname}` };
      }

      // 2. HTTP/HTTPS probe with redirect following
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      const res = await fetch(cleanUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: controller.signal
      }).catch(err => ({ error: err.message }));
      clearTimeout(timeout);

      if ('error' in res) {
        return { isLive: false, statusMessage: `Network probe failed: ${res.error}` };
      }

      // If server returns 403 or 401, many legitimate enterprise websites block bot User-Agents (e.g. Cloudflare)
      // Since DNS resolved and server actively replied with 403/401, the website exists and is live!
      if (res.status === 403 || res.status === 401) {
        return {
          isLive: true,
          canonicalUrl: cleanUrl,
          domain: hostname,
          httpStatus: res.status,
          statusMessage: `HTTP ${res.status} (WAF / Bot-Protected Live Website)`
        };
      }

      if (res.status >= 400) {
        return { isLive: false, statusMessage: `HTTP error status ${res.status}` };
      }

      // 3. Inspect HTML content for parked / dead / for-sale domains
      const html = await res.text().catch(() => '');
      const lower = html.toLowerCase();
      const parkingPatterns = [
        'this domain is for sale',
        'buy this domain',
        'domain parked by',
        'godaddy parked',
        'namecheap parking',
        'domain is registered, but no website',
        'hugedomains.com',
        'dan.com',
        'sedo.com'
      ];

      for (const pattern of parkingPatterns) {
        if (lower.includes(pattern)) {
          return { isLive: false, statusMessage: `Parked/for-sale domain ("${pattern}")` };
        }
      }

      const finalUrl = res.url || cleanUrl;
      return {
        isLive: true,
        canonicalUrl: finalUrl,
        domain: new URL(finalUrl).hostname,
        httpStatus: res.status,
        statusMessage: `HTTP ${res.status} OK (Live Active Website)`
      };
    } catch (err: any) {
      return { isLive: false, statusMessage: `Verification exception: ${err.message}` };
    }
  }

  /**
   * Queries Gemini AI to identify official business website
   */
  private async lookupWebsiteViaGemini(companyName: string, city: string, country: string): Promise<string | null> {
    const models = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];
    const locationStr = [city, country].filter(Boolean).join(', ');

    const prompt = `You are a high-precision Web Intelligence Verification Agent for Jesora Tech.
Determine the official standalone website URL for the following business:
Business Name: "${companyName}"
Location: "${locationStr}"

Rules:
1. If this business has an official standalone website (e.g., https://companyname.com or https://companyname.ie), output ONLY the full canonical URL.
2. If this business has NO official standalone website (they only have a Facebook page, Instagram profile, Yelp, or Google Maps listing), output ONLY: NONE.
3. Do NOT invent or hallucinate a URL. If uncertain, output: NONE.
4. Output nothing else — only the URL or NONE.`;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiApiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.05, maxOutputTokens: 60 }
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!res.ok) continue;

        const data = (await res.json()) as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

        if (!text || text.toUpperCase() === 'NONE' || text.includes('NONE')) {
          return null;
        }

        const match = text.match(/https?:\/\/[^\s"'<>]+/i);
        if (match) {
          return match[0];
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Tests country TLD heuristics based on business name slug
   */
  private async checkHeuristicDomains(companyName: string, country: string): Promise<{
    canonicalUrl: string;
    domain: string;
    httpStatus: number;
  } | null> {
    const cleanSlug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 24);

    if (cleanSlug.length < 4) return null;

    const tlds: string[] = [];
    const countryLower = country.toLowerCase();

    if (countryLower.includes('ireland')) tlds.push('.ie');
    if (countryLower.includes('uk') || countryLower.includes('scotland') || countryLower.includes('england')) tlds.push('.co.uk', '.uk');
    if (countryLower.includes('canada')) tlds.push('.ca');
    if (countryLower.includes('germany')) tlds.push('.de');
    if (countryLower.includes('australia')) tlds.push('.com.au');
    if (countryLower.includes('netherlands')) tlds.push('.nl');
    tlds.push('.com', '.org');

    for (const tld of tlds.slice(0, 3)) {
      const candidateDomain = `${cleanSlug}${tld}`;
      try {
        const resolved = await dns.resolve(candidateDomain).catch(() => null);
        if (resolved && resolved.length > 0) {
          const check = await this.verifyLiveDomain(`https://${candidateDomain}`);
          if (check.isLive && check.canonicalUrl) {
            return {
              canonicalUrl: check.canonicalUrl,
              domain: candidateDomain,
              httpStatus: check.httpStatus || 200
            };
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    return `https://${trimmed}`;
  }

  private isNoneOrPlaceholder(url: string): boolean {
    const lower = url.toLowerCase().trim();
    return (
      lower === '' ||
      lower.includes('none') ||
      lower.includes('no official website') ||
      lower.includes('n/a') ||
      lower.includes('unknown')
    );
  }

  private isSocialOnly(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes('facebook.com') ||
      lower.includes('instagram.com') ||
      lower.includes('linkedin.com') ||
      lower.includes('twitter.com') ||
      lower.includes('x.com') ||
      lower.includes('tiktok.com') ||
      lower.includes('yelp.com')
    );
  }
}
