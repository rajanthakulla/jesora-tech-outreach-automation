import { AppDatabase } from '../db/database.js';
import { LeadScoutAgent } from '../agents/LeadScoutAgent.js';
import { PitchCrafterAgent } from '../agents/PitchCrafterAgent.js';
import { DispatcherAgent } from '../agents/DispatcherAgent.js';
import { InboxMonitorAgent } from '../agents/InboxMonitorAgent.js';
import { MeetingCloserAgent } from '../agents/MeetingCloserAgent.js';
import { NotificationSentinel } from '../agents/NotificationSentinel.js';
import { AgentRole, AgentTelemetry, PipelineStats } from '../types/index.js';

export class Orchestrator {
  public db: AppDatabase;
  public leadScout: LeadScoutAgent;
  public pitchCrafter: PitchCrafterAgent;
  public dispatcher: DispatcherAgent;
  public inboxMonitor: InboxMonitorAgent;
  public meetingCloser: MeetingCloserAgent;
  public notificationSentinel: NotificationSentinel;

  private isRunning24x7: boolean = false;
  private timerHandle?: NodeJS.Timeout;
  private isCycleActive: boolean = false;
  private cycleCount: number = 0;
  private lastCycleStartTime?: Date;

  constructor(db?: AppDatabase) {
    this.db = db || new AppDatabase();
    this.leadScout = new LeadScoutAgent(this.db);
    this.pitchCrafter = new PitchCrafterAgent(this.db);
    this.dispatcher = new DispatcherAgent(this.db);
    this.inboxMonitor = new InboxMonitorAgent(this.db);
    this.meetingCloser = new MeetingCloserAgent(this.db);
    this.notificationSentinel = new NotificationSentinel(this.db);
  }

  public getAgents(): Record<AgentRole, any> {
    return {
      lead_scout: this.leadScout,
      pitch_crafter: this.pitchCrafter,
      dispatcher: this.dispatcher,
      inbox_monitor: this.inboxMonitor,
      meeting_closer: this.meetingCloser,
      notification_sentinel: this.notificationSentinel
    };
  }

  public getTelemetry(): AgentTelemetry[] {
    return this.db.getAllAgentTelemetry();
  }

  public getPipelineStats(): PipelineStats {
    return this.db.getPipelineStats();
  }

  public isAutoPilotActive(): boolean {
    return this.isRunning24x7;
  }

  public getCycleInfo() {
    return {
      isRunning24x7: this.isRunning24x7,
      isCycleActive: this.isCycleActive,
      cycleCount: this.cycleCount,
      lastCycleStartTime: this.lastCycleStartTime?.toISOString(),
      cycleIntervalMinutes: this.db.getSettings().autonomous.cycleIntervalMinutes
    };
  }

  /**
   * Starts the 24x7 continuous background loop
   */
  public start24x7(): void {
    if (this.isRunning24x7) return;

    this.isRunning24x7 = true;
    const settings = this.db.getSettings();
    const intervalMinutes = Math.max(1, settings.autonomous.cycleIntervalMinutes || 10);
    const intervalMs = intervalMinutes * 60 * 1000;

    this.notificationSentinel.log('info', `24x7 Autonomous Engine started. Scheduled every ${intervalMinutes} minute(s).`);

    // Run first cycle immediately
    this.runFullCycle().catch(err => {
      this.notificationSentinel.log('error', `First cycle error: ${err.message}`);
    });

    this.timerHandle = setInterval(() => {
      if (this.isRunning24x7) {
        this.runFullCycle().catch(err => {
          this.notificationSentinel.log('error', `Periodic cycle error: ${err.message}`);
        });
      }
    }, intervalMs);
  }

  /**
   * Stops the 24x7 loop
   */
  public stop24x7(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = undefined;
    }
    this.isRunning24x7 = false;
    this.notificationSentinel.log('warn', '24x7 Autonomous Engine stopped by operator.');
  }

  /**
   * Executes a single synchronized cycle across all agents
   */
  public async runFullCycle(): Promise<{ summary: string; actions: number }> {
    if (this.isCycleActive) {
      return { summary: 'A cycle is already in progress.', actions: 0 };
    }

    this.isCycleActive = true;
    this.lastCycleStartTime = new Date();
    this.cycleCount += 1;

    let totalActions = 0;
    const cycleLog: string[] = [];

    try {
      this.notificationSentinel.log('info', `Starting Cycle #${this.cycleCount} of 24x7 Orchestrator...`);

      // 1. Inbox Sentinel (Highest Priority: Scan incoming mail & hot leads first)
      const inboxRes = await this.inboxMonitor.run();
      totalActions += inboxRes.actionsTaken;
      cycleLog.push(`Inbox Sentinel: ${inboxRes.message}`);

      // 2. Meeting Closer (Schedule meetings for newly replied prospects)
      const meetingRes = await this.meetingCloser.run();
      totalActions += meetingRes.actionsTaken;
      cycleLog.push(`Meeting Closer: ${meetingRes.message}`);

      // 3. Lead Scout (Prospect new clients for active campaigns)
      const scoutRes = await this.leadScout.run();
      totalActions += scoutRes.actionsTaken;
      cycleLog.push(`Lead Scout: ${scoutRes.message}`);

      // 4. Pitch Crafter (Generate tailored cold outreach & follow-ups)
      const pitchRes = await this.pitchCrafter.run();
      totalActions += pitchRes.actionsTaken;
      cycleLog.push(`Pitch Crafter: ${pitchRes.message}`);

      // 5. Dispatcher (Deliver queued emails respecting pacing)
      const dispatchRes = await this.dispatcher.run();
      totalActions += dispatchRes.actionsTaken;
      cycleLog.push(`Dispatcher: ${dispatchRes.message}`);

      // 6. Broadcast updated state
      this.notificationSentinel.broadcast('cycle_completed', {
        cycleCount: this.cycleCount,
        totalActions,
        stats: this.db.getPipelineStats()
      });

      const summary = `Cycle #${this.cycleCount} completed: ${totalActions} actions across fleet.`;
      this.notificationSentinel.log('success', summary, { details: cycleLog });
      return { summary, actions: totalActions };
    } catch (err: any) {
      this.notificationSentinel.log('error', `Cycle #${this.cycleCount} failed: ${err.message}`);
      return { summary: `Cycle error: ${err.message}`, actions: totalActions };
    } finally {
      this.isCycleActive = false;
    }
  }

  /**
   * Triggers an individual agent immediately on demand
   */
  public async runAgent(role: AgentRole): Promise<{ message: string; actionsTaken: number }> {
    const agents = this.getAgents();
    const target = agents[role];
    if (!target) {
      throw new Error(`Unknown agent role: ${role}`);
    }
    const result = await target.run();
    this.notificationSentinel.broadcast('agent_updated', {
      agentId: role,
      telemetry: target.getTelemetry()
    });
    return result;
  }

  /**
   * Simulates an incoming prospect response for end-to-end testing
   */
  public async simulateInboundReply(params: {
    fromEmail: string;
    subject: string;
    body: string;
  }) {
    const reply = await this.inboxMonitor.ingestIncomingReply(params);
    const lead = this.db.getLeadById(reply.leadId);

    if (lead) {
      if (reply.sentiment === 'INTERESTED' || reply.sentiment === 'MEETING_REQUEST') {
        await this.notificationSentinel.notifyHotLead(lead, reply);

        const settings = this.db.getSettings();
        if (settings.autonomous.autoReplyInterested) {
          const meeting = await this.meetingCloser.scheduleMeetingForLead(lead, reply.body);
          await this.notificationSentinel.notifyMeetingBooked(lead, meeting);
        }
      }
    }

    this.notificationSentinel.broadcast('inbound_reply_received', { reply, lead });
    return { reply, lead };
  }
}
