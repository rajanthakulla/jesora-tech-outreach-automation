export type LeadStatus =
  | 'discovered'
  | 'scouted'
  | 'contacted'
  | 'replied'
  | 'meeting_scheduled'
  | 'won'
  | 'unsubscribed'
  | 'bounced';

export interface Lead {
  id: string;
  companyName: string;
  website: string;
  industry: string;
  contactName: string;
  contactTitle?: string;
  email: string;
  phone?: string;
  country: string;
  techStack?: string;
  painPoints?: string;
  score: number;
  status: LeadStatus;
  notes?: string;
  campaignId?: string;
  currentSequenceStep: number;
  lastContactedAt?: string;
  nextFollowUpAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  targetNiche: string;
  targetLocations: string[];
  keywords: string[];
  status: 'active' | 'paused' | 'completed';
  sequenceId: string;
  dailyLimit: number;
  leadsTargeted: number;
  leadsContacted: number;
  leadsReplied: number;
  meetingsBooked: number;
  createdAt: string;
  updatedAt: string;
}

export interface SequenceStep {
  stepNumber: number;
  delayDays: number;
  subjectTemplate: string;
  bodyTemplate: string;
  purpose: string;
}

export interface EmailSequence {
  id: string;
  name: string;
  description: string;
  targetAudience: string;
  steps: SequenceStep[];
  createdAt: string;
  updatedAt: string;
}

export type MessageStatus =
  | 'pending'
  | 'scheduled'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'bounced'
  | 'failed';

export interface OutreachMessage {
  id: string;
  leadId: string;
  campaignId: string;
  sequenceStepNumber: number;
  subject: string;
  body: string;
  status: MessageStatus;
  scheduledFor: string;
  sentAt?: string;
  deliveredAt?: string;
  openedAt?: string;
  repliedAt?: string;
  errorMessage?: string;
  createdAt: string;
}

export type ReplySentiment =
  | 'INTERESTED'
  | 'MEETING_REQUEST'
  | 'INFORMATION_REQUEST'
  | 'OBJECTION'
  | 'NOT_NOW'
  | 'UNSUBSCRIBE'
  | 'BOUNCE'
  | 'OTHER';

export interface InboundReply {
  id: string;
  leadId: string;
  outreachMessageId?: string;
  fromEmail: string;
  subject: string;
  body: string;
  sentiment: ReplySentiment;
  sentimentConfidence: number;
  aiSummary: string;
  aiSuggestedReply: string;
  status: 'pending_review' | 'replied' | 'auto_replied' | 'dismissed';
  receivedAt: string;
  repliedAt?: string;
}

export interface Meeting {
  id: string;
  leadId: string;
  scheduledTime: string;
  durationMinutes: number;
  meetUrl: string;
  agenda: string;
  status: 'confirmed' | 'rescheduled' | 'cancelled' | 'completed';
  executiveBrief?: string;
  createdAt: string;
}

export type AgentRole =
  | 'lead_scout'
  | 'pitch_crafter'
  | 'dispatcher'
  | 'inbox_monitor'
  | 'meeting_closer'
  | 'notification_sentinel';

export type AgentStatus = 'idle' | 'working' | 'paused' | 'error';

export interface AgentTelemetry {
  agentId: AgentRole;
  name: string;
  role: string;
  description: string;
  status: AgentStatus;
  lastRunAt?: string;
  nextRunAt?: string;
  totalRuns: number;
  totalActions: number;
  currentTask: string;
  lastErrorMessage?: string;
}

export interface AgentLog {
  id: string;
  agentId: AgentRole | 'orchestrator' | 'system';
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface SystemSettings {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    fromName: string;
    fromEmail: string;
    dryRun: boolean;
  };
  imap: {
    host: string;
    port: number;
    user: string;
    pass: string;
    enabled: boolean;
  };
  ai: {
    provider: 'gemini' | 'openai' | 'groq' | 'anthropic' | 'builtin';
    apiKey: string;
    modelName: string;
  };
  telegram: {
    botToken: string;
    chatId: string;
    enabled: boolean;
    notifyOnHotLead: boolean;
    notifyOnMeeting: boolean;
    notifyOnSend: boolean;
  };
  pacing: {
    maxEmailsPerDay: number;
    minDelayMinutesBetweenSends: number;
    businessHoursOnly: boolean;
    businessHoursStart: number; // e.g. 9
    businessHoursEnd: number;   // e.g. 18
    timezone: string;
  };
  autonomous: {
    enabled: boolean;
    cycleIntervalMinutes: number;
    autoReplyInterested: boolean;
    requireApprovalForMeetings: boolean;
  };
  jesoraProfile: {
    companyName: string;
    tagline: string;
    siteUrl: string;
    headquarters: string;
    contactEmail: string;
    contactPhone: string;
    calendarBookingUrl: string;
    keySellingPoints: string[];
    caseStudies: Array<{
      title: string;
      category: string;
      url: string;
      highlight: string;
    }>;
  };
}

export interface PipelineStats {
  totalLeads: number;
  scoutedLeads: number;
  contactedLeads: number;
  repliedLeads: number;
  meetingsBooked: number;
  unsubscribedLeads: number;
  totalEmailsSent: number;
  activeCampaigns: number;
  replyRatePercent: number;
  conversionRatePercent: number;
}
