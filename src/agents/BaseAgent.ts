import { AgentRole, AgentStatus, AgentTelemetry, AgentLog } from '../types/index.js';
import { AppDatabase } from '../db/database.js';
import crypto from 'node:crypto';

export abstract class BaseAgent {
  public readonly agentId: AgentRole;
  public readonly name: string;
  public readonly role: string;
  public readonly description: string;
  protected db: AppDatabase;
  protected status: AgentStatus = 'idle';
  protected totalRuns: number = 0;
  protected totalActions: number = 0;
  protected currentTask: string = 'Standing by';
  protected lastRunAt?: string;
  protected nextRunAt?: string;
  protected lastErrorMessage?: string;

  constructor(
    agentId: AgentRole,
    name: string,
    role: string,
    description: string,
    db: AppDatabase
  ) {
    this.agentId = agentId;
    this.name = name;
    this.role = role;
    this.description = description;
    this.db = db;

    // Load existing telemetry if present
    const existing = this.db.getAllAgentTelemetry().find(a => a.agentId === agentId);
    if (existing) {
      this.totalRuns = existing.totalRuns;
      this.totalActions = existing.totalActions;
      this.status = existing.status;
      this.lastRunAt = existing.lastRunAt;
      this.nextRunAt = existing.nextRunAt;
      this.currentTask = existing.currentTask;
    } else {
      this.syncTelemetry();
    }
  }

  public getTelemetry(): AgentTelemetry {
    return {
      agentId: this.agentId,
      name: this.name,
      role: this.role,
      description: this.description,
      status: this.status,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      totalRuns: this.totalRuns,
      totalActions: this.totalActions,
      currentTask: this.currentTask,
      lastErrorMessage: this.lastErrorMessage
    };
  }

  protected setTask(task: string, status: AgentStatus = 'working'): void {
    this.currentTask = task;
    this.status = status;
    this.syncTelemetry();
  }

  protected syncTelemetry(): void {
    this.db.upsertAgentTelemetry(this.getTelemetry());
  }

  public log(level: AgentLog['level'], message: string, details?: Record<string, unknown>): void {
    const logEntry: AgentLog = {
      id: crypto.randomUUID(),
      agentId: this.agentId,
      level,
      message,
      details,
      timestamp: new Date().toISOString()
    };
    this.db.insertAgentLog(logEntry);
  }

  /**
   * Main execution cycle for this agent.
   */
  public async run(): Promise<{ actionsTaken: number; message: string }> {
    if (this.status === 'paused') {
      return { actionsTaken: 0, message: `${this.name} is paused.` };
    }

    this.status = 'working';
    this.lastRunAt = new Date().toISOString();
    this.totalRuns += 1;
    this.lastErrorMessage = undefined;
    this.syncTelemetry();

    try {
      this.log('info', `Starting cycle: ${this.name}`);
      const result = await this.executeCycle();
      this.totalActions += result.actionsTaken;
      this.status = 'idle';
      this.currentTask = `Completed cycle: ${result.message}`;
      this.syncTelemetry();
      this.log('success', `Cycle complete: ${result.message}`, { actionsTaken: result.actionsTaken });
      return result;
    } catch (err: any) {
      this.status = 'error';
      this.lastErrorMessage = err.message || String(err);
      this.currentTask = `Error: ${this.lastErrorMessage}`;
      this.syncTelemetry();
      this.log('error', `Agent execution failed: ${this.lastErrorMessage}`, { stack: err.stack });
      return { actionsTaken: 0, message: `Failed: ${this.lastErrorMessage}` };
    }
  }

  public setNextRunAt(date: Date): void {
    this.nextRunAt = date.toISOString();
    this.syncTelemetry();
  }

  public pause(): void {
    this.status = 'paused';
    this.currentTask = 'Paused by operator';
    this.syncTelemetry();
    this.log('warn', `${this.name} paused.`);
  }

  public resume(): void {
    this.status = 'idle';
    this.currentTask = 'Standing by for next run';
    this.syncTelemetry();
    this.log('info', `${this.name} resumed.`);
  }

  protected abstract executeCycle(): Promise<{ actionsTaken: number; message: string }>;
}
