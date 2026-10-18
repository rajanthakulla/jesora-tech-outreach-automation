// ===================================================================
// JESORA TECH — Autonomous Outreach Fleet Controller
// Interactive Frontend Engine
// ===================================================================

const state = {
  activeTab: 'overview',
  cycleInfo: {},
  agents: [],
  pipelineStats: {},
  leads: [],
  selectedLeadFilter: 'all',
  leadSearchQuery: '',
  replies: [],
  selectedReplyId: null,
  meetings: [],
  campaigns: [],
  sequences: [],
  logs: [],
  logFilter: 'all',
  settings: null
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initSSE();
  initModals();
  initDrawer();
  initActions();
  loadAllData();

  // Periodic fallback refresh every 15s
  setInterval(() => {
    loadStatus();
  }, 15000);
});

// --- Navigation Tabs ---
function initNavigation() {
  const tabs = document.querySelectorAll('.nav-item');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      setActiveTab(target);
    });
  });

  const viewAllLogsBtn = document.getElementById('btn-view-all-logs');
  if (viewAllLogsBtn) {
    viewAllLogsBtn.addEventListener('click', () => setActiveTab('terminal'));
  }
}

function setActiveTab(targetTab) {
  state.activeTab = targetTab;
  document.querySelectorAll('.nav-item').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === targetTab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${targetTab}`);
  });

  const titleMap = {
    overview: 'Command Overview',
    leads: 'Leads Directory & Pipeline CRM',
    inbox: 'Inbound Sentinel & AI Sentiment',
    meetings: 'Booked Discovery Meetings',
    campaigns: 'Target Niches & Active Campaigns',
    sequences: 'Outreach Sequence Architecture',
    terminal: 'Live Agent Audit Terminal',
    settings: 'System Configuration & Credentials'
  };
  const titleEl = document.getElementById('current-view-title');
  if (titleEl) {
    titleEl.textContent = titleMap[targetTab] || 'Command Center';
  }

  // Load specific tab data on switch
  if (targetTab === 'leads') loadLeads();
  if (targetTab === 'inbox') loadInbox();
  if (targetTab === 'meetings') loadMeetings();
  if (targetTab === 'campaigns') loadCampaigns();
  if (targetTab === 'sequences') loadSequences();
  if (targetTab === 'terminal') loadLogs();
  if (targetTab === 'settings') loadSettings();
}

// --- Real-Time SSE Stream ---
function initSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('connected', () => {
    console.log('[SSE] Connected to real-time notification stream.');
  });

  eventSource.addEventListener('cycle_completed', (e) => {
    const data = JSON.parse(e.data);
    showToast(`Cycle #${data.cycleCount} finished (${data.totalActions} actions across fleet)`, 'info');
    loadStatus();
    if (state.activeTab === 'leads') loadLeads();
    if (state.activeTab === 'terminal') loadLogs();
  });

  eventSource.addEventListener('hot_lead', (e) => {
    const data = JSON.parse(e.data);
    showToast(`🔥 HOT LEAD: ${data.lead.companyName} expressed interest!`, 'success');
    loadStatus();
    if (state.activeTab === 'inbox') loadInbox();
    if (state.activeTab === 'leads') loadLeads();
  });

  eventSource.addEventListener('meeting_booked', (e) => {
    const data = JSON.parse(e.data);
    showToast(`📅 NEW MEETING: ${data.lead.companyName} booked a call!`, 'success');
    loadStatus();
    if (state.activeTab === 'meetings') loadMeetings();
  });

  eventSource.addEventListener('agent_updated', () => {
    loadStatus();
  });

  eventSource.onerror = () => {
    console.warn('[SSE] Reconnecting to live stream...');
  };
}

// --- Data Fetching ---
async function loadAllData() {
  await Promise.all([
    loadStatus(),
    loadLeads(),
    loadInbox(),
    loadMeetings(),
    loadCampaigns(),
    loadSequences()
  ]);
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success) {
      state.cycleInfo = data.cycleInfo;
      state.agents = data.agents;
      state.pipelineStats = data.pipelineStats;
      renderKPIs(data.pipelineStats);
      renderStatusIndicator(data.cycleInfo);
      renderAgents(data.agents);
      renderFunnel(data.pipelineStats);
      renderQuickFeed(data.recentLogs);
    }
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

function renderStatusIndicator(info) {
  const label = document.getElementById('status-label-text');
  const cycleSub = document.getElementById('status-cycle-sub');
  const btnToggle = document.getElementById('btn-toggle-pilot');

  if (info.isRunning24x7) {
    if (label) label.textContent = '24x7 Active';
    if (cycleSub) cycleSub.textContent = `Cycle #${info.cycleCount} \u2022 ${info.cycleIntervalMinutes || 10}m interval`;
    if (btnToggle) {
      btnToggle.innerHTML = '<span class="toggle-icon">⏹</span> Stop';
      btnToggle.className = 'micro-toggle-btn';
    }
  } else {
    if (label) label.textContent = 'Standby';
    if (cycleSub) cycleSub.textContent = 'Manual Execution Mode';
    if (btnToggle) {
      btnToggle.innerHTML = '<span class="toggle-icon">▶</span> Start';
      btnToggle.className = 'micro-toggle-btn';
    }
  }
}

function renderKPIs(stats) {
  const elTotal = document.getElementById('kpi-total-leads');
  const elScouted = document.getElementById('kpi-scouted-leads');
  const elEmails = document.getElementById('kpi-emails-sent');
  const elContacted = document.getElementById('kpi-contacted-leads');
  const elReplies = document.getElementById('kpi-replies-count');
  const elReplyRate = document.getElementById('kpi-reply-rate');
  const elMeetings = document.getElementById('kpi-meetings-booked');
  const elConvRate = document.getElementById('kpi-conv-rate');
  const elPipeline = document.getElementById('kpi-pipeline-value');

  if (elTotal) elTotal.textContent = stats.totalLeads || 0;
  if (elScouted) elScouted.textContent = `+${stats.scoutedLeads || 0} scouted`;
  if (elEmails) elEmails.textContent = stats.totalEmailsSent || 0;
  if (elContacted) elContacted.textContent = `${stats.contactedLeads || 0} contacted \u2022 Paced`;
  if (elReplies) elReplies.textContent = stats.repliedLeads || 0;
  if (elReplyRate) elReplyRate.textContent = `${stats.replyRatePercent}%`;
  if (elMeetings) elMeetings.textContent = stats.meetingsBooked || 0;
  if (elConvRate) elConvRate.textContent = `${stats.conversionRatePercent}%`;

  // Estimate pipeline value: Each meeting booked estimated at $3,500 average contract value
  const estimatedVal = (stats.meetingsBooked * 3500) + (stats.repliedLeads * 800);
  if (elPipeline) elPipeline.textContent = `$${estimatedVal.toLocaleString()}`;

  // Update nav badges
  const navLead = document.getElementById('tab-lead-count');
  const navReply = document.getElementById('tab-reply-count');
  const navMeet = document.getElementById('tab-meet-count');
  const badgeCamp = document.getElementById('badge-active-campaigns');

  if (navLead) navLead.textContent = stats.totalLeads || 0;
  if (navReply) navReply.textContent = stats.repliedLeads || 0;
  if (navMeet) navMeet.textContent = stats.meetingsBooked || 0;
  if (badgeCamp) badgeCamp.textContent = `${stats.activeCampaigns || 0} Campaigns`;
}

function renderAgents(agents) {
  const container = document.getElementById('agents-grid-container');
  if (!container) return;

  const agentIcons = {
    lead_scout: '🔍',
    website_verifier: '🌐',
    site_auditor: '🔬',
    pitch_crafter: '✍️',
    dispatcher: '📤',
    inbox_monitor: '📥',
    meeting_closer: '🤝',
    notification_sentinel: '🔔'
  };

  container.innerHTML = agents.map(agent => {
    const icon = agentIcons[agent.agentId] || '🤖';
    const isPaused = agent.status === 'paused';
    return `
      <div class="agent-mission-card">
        <div class="agent-mission-header">
          <div class="agent-avatar-cluster">
            <div class="agent-glyph-icon">${icon}</div>
            <div class="agent-headline">
              <span class="agent-callsign">${agent.name}</span>
              <span class="agent-designation">${agent.role}</span>
            </div>
          </div>
          <span class="agent-status-orb ${agent.status}">${agent.status}</span>
        </div>

        <p class="agent-summary-copy">${agent.description}</p>

        <div class="agent-live-chip">
          <span class="live-chip-label">ACTIVE TASK</span>
          <div class="live-chip-text" title="${agent.currentTask}">${agent.currentTask || 'Standing by'}</div>
        </div>

        <div class="agent-stats-bar">
          <div class="stat-cell">
            <span class="stat-tag">RUNS</span>
            <span class="stat-data">${agent.totalRuns}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-tag">ACTIONS</span>
            <span class="stat-data">${agent.totalActions}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-tag">ACTIVE</span>
            <span class="stat-data">${agent.lastRunAt ? formatTimeAgo(agent.lastRunAt) : 'Never'}</span>
          </div>
        </div>

        <div class="agent-action-buttons">
          <button class="btn btn-xs btn-primary" onclick="runSingleAgent('${agent.agentId}')">
            <span>⚡</span> Run Now
          </button>
          ${isPaused 
            ? `<button class="btn btn-xs btn-secondary" onclick="togglePauseAgent('${agent.agentId}', 'resume')">Resume</button>` 
            : `<button class="btn btn-xs btn-ghost" onclick="togglePauseAgent('${agent.agentId}', 'pause')">Pause</button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function renderFunnel(stats) {
  const container = document.getElementById('funnel-display');
  if (!container) return;

  const total = Math.max(1, stats.totalLeads);
  const steps = [
    { label: 'Total Discovered', count: stats.totalLeads, pct: 100 },
    { label: 'Scouted & Audited', count: stats.scoutedLeads + stats.contactedLeads, pct: Math.min(100, Math.round(((stats.scoutedLeads + stats.contactedLeads) / total) * 100)) },
    { label: 'Contacted (Sent)', count: stats.contactedLeads, pct: Math.min(100, Math.round((stats.contactedLeads / total) * 100)) },
    { label: 'Replies Received', count: stats.repliedLeads, pct: Math.min(100, Math.round((stats.repliedLeads / total) * 100)) },
    { label: 'Meetings Booked 🚀', count: stats.meetingsBooked, pct: Math.min(100, Math.round((stats.meetingsBooked / total) * 100)) }
  ];

  container.innerHTML = steps.map(s => `
    <div class="funnel-step">
      <span class="funnel-step-name">${s.label}</span>
      <div class="funnel-step-bar-wrap">
        <div class="funnel-step-bar" style="width: ${Math.max(6, s.pct)}%"></div>
      </div>
      <span class="funnel-step-count">${s.count}</span>
    </div>
  `).join('');
}

function renderQuickFeed(logs) {
  const container = document.getElementById('quick-activity-feed');
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = '<div class="empty-state">No recent activity recorded.</div>';
    return;
  }

  container.innerHTML = logs.slice(0, 6).map(l => `
    <div class="activity-item">
      <span class="activity-badge ${l.level}">${l.level}</span>
      <span>${escapeHtml(l.message)}</span>
      <span class="activity-time">${formatTimeAgo(l.timestamp)}</span>
    </div>
  `).join('');
}

// --- Leads CRM Tab ---
async function loadLeads() {
  try {
    const filter = state.selectedLeadFilter === 'all' ? '' : `?status=${state.selectedLeadFilter}`;
    const res = await fetch(`/api/leads${filter}`);
    const data = await res.json();
    if (data.success) {
      state.leads = data.leads;
      renderLeadsTable();
    }
  } catch (err) {
    console.error('Failed to load leads:', err);
  }
}

function renderLeadsTable() {
  const tbody = document.getElementById('leads-table-body');
  if (!tbody) return;

  let leads = state.leads;
  if (state.leadSearchQuery.trim()) {
    const q = state.leadSearchQuery.toLowerCase();
    leads = leads.filter(l => 
      l.companyName.toLowerCase().includes(q) ||
      l.contactName.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q) ||
      (l.techStack && l.techStack.toLowerCase().includes(q))
    );
  }

  if (leads.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 48px; color: var(--text-muted);">
          No leads match the current filter or search criteria.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = leads.map(l => {
    const scoreClass = l.score >= 90 ? 'score-high' : 'score-mid';
    const statusClass = `status-${l.status}`;
    return `
      <tr>
        <td>
          <div class="table-lead-entity">
            <span class="lead-entity-name">${escapeHtml(l.companyName)}</span>
            <span class="lead-entity-contact">${escapeHtml(l.contactName)} (${escapeHtml(l.contactTitle || 'Decision Maker')})</span>
            <a href="${escapeHtml(l.website)}" target="_blank" class="lead-entity-link">
              ${escapeHtml(l.website.replace('https://', ''))} ↗
            </a>
            ${l.address ? `<div style="font-size: 11px; color: var(--accent-cyan); margin-top: 3px; display: flex; align-items: center; gap: 4px;">📍 <span>${escapeHtml(l.address)}</span></div>` : ''}
          </div>
        </td>
        <td>
          <div style="font-weight: 600; color: #E2E8F0;">${escapeHtml(l.industry)}</div>
          <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(l.country)}</span>
          ${l.websiteVerified !== undefined ? `
            <div style="margin-top: 4px;">
              <span style="font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; ${l.websiteVerified ? 'background: rgba(16, 185, 129, 0.15); color: #34D399;' : 'background: rgba(239, 68, 68, 0.15); color: #F87171;'}">
                ${l.websiteVerified ? '✓ Live Website' : '✕ Discarded (No Site)'}
              </span>
            </div>` : ''}
        </td>
        <td>
          <span class="score-badge ${scoreClass}">${l.score}</span>
        </td>
        <td style="max-width: 260px;">
          <div style="font-size: 11px; color: #CBD5E1; line-height: 1.4;">${escapeHtml(l.techStack || 'Uninspected')}</div>
          ${l.flawReport ? `
            <div style="font-size: 10px; font-weight: 600; margin-top: 4px; background: rgba(168, 85, 247, 0.1); padding: 3px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="color: #C084FC;">🔬 Tech: ${l.flawReport.performanceScore}/100</span>
              <span style="color: #64748B;">•</span>
              <span style="color: #F472B6;">🎨 Design: ${l.flawReport.designScore || 45}/100</span>
              <span style="color: #64748B;">•</span>
              <span style="color: #94A3B8;">${l.flawReport.loadLatencyMs}ms</span>
            </div>
          ` : ''}
          ${l.painPoints ? `<div style="font-size: 11px; color: var(--accent-amber); margin-top: 3px;">⚠️ ${escapeHtml(l.painPoints)}</div>` : ''}
        </td>
        <td>
          <span class="status-badge ${statusClass}">${l.status.replace('_', ' ')}</span>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px; font-family: var(--font-mono);">
            Step ${l.currentSequenceStep}
          </div>
        </td>
        <td>
          <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-secondary);">
            ${l.nextFollowUpAt ? `Next: ${new Date(l.nextFollowUpAt).toLocaleDateString()}` : 'None pending'}
          </div>
        </td>
        <td class="text-right">
          <div style="display: flex; gap: 6px; justify-content: flex-end;">
            <button class="btn btn-xs btn-secondary" onclick="openLeadDrawer('${l.id}')">View</button>
            <button class="btn btn-xs btn-ghost" onclick="deleteLeadPrompt('${l.id}')">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// --- Inbound Inbox Tab ---
async function loadInbox() {
  try {
    const res = await fetch('/api/replies');
    const data = await res.json();
    if (data.success) {
      state.replies = data.replies;
      renderInboxList();
      if (state.replies.length > 0 && !state.selectedReplyId) {
        selectReply(state.replies[0].id);
      }
    }
  } catch (err) {
    console.error('Failed to load inbox:', err);
  }
}

function renderInboxList() {
  const listContainer = document.getElementById('inbox-list-container');
  if (!listContainer) return;

  if (state.replies.length === 0) {
    listContainer.innerHTML = '<div class="empty-state">No inbound replies recorded yet.</div>';
    return;
  }

  listContainer.innerHTML = state.replies.map(r => {
    const isActive = r.id === state.selectedReplyId ? 'active' : '';
    const sentimentBadgeClass = `sentiment-${r.sentiment}`;
    return `
      <div class="inbox-thread-card ${isActive}" onclick="selectReply('${r.id}')">
        <div class="thread-card-top">
          <span class="thread-sender-name">${escapeHtml(r.fromEmail)}</span>
          <span class="thread-time-label">${formatTimeAgo(r.receivedAt)}</span>
        </div>
        <div class="thread-subject-line">${escapeHtml(r.subject)}</div>
        <div style="margin-bottom: 4px;">
          <span class="ai-sentiment-chip ${sentimentBadgeClass}" style="margin: 0; padding: 2px 6px; font-size: 9px;">
            ${r.sentiment}
          </span>
        </div>
        <div class="thread-body-snippet">${escapeHtml(r.body)}</div>
      </div>
    `;
  }).join('');
}

function selectReply(replyId) {
  state.selectedReplyId = replyId;
  renderInboxList();

  const reply = state.replies.find(r => r.id === replyId);
  const viewer = document.getElementById('inbox-viewer-container');
  if (!reply || !viewer) return;

  const lead = state.leads.find(l => l.id === reply.leadId);
  const sentimentBadgeClass = `sentiment-${reply.sentiment}`;

  viewer.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
      <div>
        <h3 style="font-size: 18px; font-weight: 700; color: #FFF; margin-bottom: 4px;">${escapeHtml(reply.subject)}</h3>
        <div style="font-size: 13px; color: var(--text-secondary);">
          From: <strong>${escapeHtml(reply.fromEmail)}</strong> ${lead ? `(${escapeHtml(lead.companyName)})` : ''}
        </div>
      </div>
      <span class="ai-sentiment-chip ${sentimentBadgeClass}">
        Intent: ${reply.sentiment} (${Math.round(reply.sentimentConfidence * 100)}% confidence)
      </span>
    </div>

    <div style="background: rgba(99, 102, 241, 0.08); border-left: 3px solid var(--accent-indigo); padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 12px; color: #E2E8F0;">
      <strong>🤖 AI Summary:</strong> ${escapeHtml(reply.aiSummary)}
    </div>

    <div class="inbound-dialogue-card">${escapeHtml(reply.body)}</div>

    <div class="ai-reply-blueprint">
      <div class="ai-blueprint-header">
        <span>✨</span> AI Recommended Response (Jesora Tech Engineering Pitch):
      </div>
      <div style="font-size: 13px; line-height: 1.6; color: #E2E8F0; white-space: pre-wrap; margin-bottom: 14px;">
        ${escapeHtml(reply.aiSuggestedReply)}
      </div>
      <div style="display: flex; gap: 10px;">
        <button class="btn btn-sm btn-primary" onclick="showToast('Response sent to client!', 'success')">
          <span>🚀</span> Approve & Send Response
        </button>
        <button class="btn btn-sm btn-secondary" onclick="openLeadDrawer('${reply.leadId}')">
          View Complete Lead Profile
        </button>
      </div>
    </div>
  `;
}

// --- Meetings Tab ---
async function loadMeetings() {
  try {
    const res = await fetch('/api/meetings');
    const data = await res.json();
    if (data.success) {
      state.meetings = data.meetings;
      renderMeetings();
    }
  } catch (err) {
    console.error('Failed to load meetings:', err);
  }
}

function renderMeetings() {
  const container = document.getElementById('meetings-grid-container');
  if (!container) return;

  if (state.meetings.length === 0) {
    container.innerHTML = `
      <div class="double-bezel-card" style="grid-column: span 2;">
        <div class="card-inner-core" style="padding: 60px 20px; text-align: center;">
          <div style="font-size: 40px; margin-bottom: 12px;">📅</div>
          <h3 style="font-size: 18px; color: #FFF; margin-bottom: 6px;">No discovery calls booked yet</h3>
          <p style="font-size: 13px; color: var(--text-secondary); max-width: 460px; margin: 0 auto 16px;">
            When an interested prospect replies or requests a meeting, the Meeting Closer Agent automatically reserves the slot and prepares the executive brief.
          </p>
          <button class="btn btn-sm btn-primary" onclick="openSimulateModal()">Test Hot Lead Meeting Flow</button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = state.meetings.map(m => {
    const lead = state.leads.find(l => l.id === m.leadId);
    const dateFormatted = new Date(m.scheduledTime).toLocaleString([], {
      weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    return `
      <div class="double-bezel-card meeting-card-container">
        <div class="card-inner-core">
          <div style="font-size: 17px; font-weight: 700; color: #FFF; margin-bottom: 4px;">
            ${escapeHtml(lead ? lead.companyName : 'Discovery Call')}
          </div>
          <div class="meeting-time-chip">
            <span>🕒</span> ${dateFormatted} (${m.durationMinutes} mins)
          </div>
          <div style="font-size: 12px; color: #CBD5E1; margin-bottom: 14px;">
            <strong>Agenda:</strong> ${escapeHtml(m.agenda)}
          </div>
          
          <div class="executive-brief-dossier">${escapeHtml(m.executiveBrief || 'No executive brief compiled.')}</div>

          <div style="display: flex; gap: 10px; align-items: center;">
            <a href="${m.meetUrl}" target="_blank" class="btn btn-sm btn-primary">
              <span>📹</span> Launch Google Meet
            </a>
            <button class="btn btn-sm btn-secondary" onclick="openLeadDrawer('${m.leadId}')">
              Lead CRM Dossier
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Campaigns Tab ---
async function loadCampaigns() {
  try {
    const res = await fetch('/api/campaigns');
    const data = await res.json();
    if (data.success) {
      state.campaigns = data.campaigns;
      renderCampaigns();
    }
  } catch (err) {
    console.error('Failed to load campaigns:', err);
  }
}

function renderCampaigns() {
  const container = document.getElementById('campaigns-grid-container');
  if (!container) return;

  container.innerHTML = state.campaigns.map(c => `
    <div class="double-bezel-card">
      <div class="card-inner-core">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div>
            <div style="font-size: 17px; font-weight: 700; color: #FFF;">${escapeHtml(c.name)}</div>
            <span style="font-size: 11px; color: var(--accent-cyan); font-family: var(--font-mono);">${escapeHtml(c.targetNiche)}</span>
          </div>
          <span class="agent-status-orb ${c.status}">${c.status}</span>
        </div>

        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.4;">${escapeHtml(c.description)}</p>

        <div class="tag-cloud">
          ${(c.targetLocations || []).map(loc => `<span class="tag-badge">📍 ${escapeHtml(loc)}</span>`).join('')}
          ${(c.keywords || []).map(kw => `<span class="tag-badge">#${escapeHtml(kw)}</span>`).join('')}
        </div>

        <div class="agent-stats-bar">
          <div class="stat-cell">
            <span class="stat-tag">TARGETED</span>
            <span class="stat-data">${c.leadsTargeted}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-tag">CONTACTED</span>
            <span class="stat-data">${c.leadsContacted}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-tag">REPLIES</span>
            <span class="stat-data">${c.leadsReplied}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-tag">MEETINGS</span>
            <span class="stat-data" style="color: var(--accent-amber);">${c.meetingsBooked}</span>
          </div>
        </div>

        <div style="display: flex; gap: 8px;">
          <button class="btn btn-sm btn-secondary" onclick="triggerScoutForCampaign('${c.id}')">
            <span>🔍</span> Scout Leads For This Niche
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// --- Sequences Tab ---
async function loadSequences() {
  try {
    const res = await fetch('/api/sequences');
    const data = await res.json();
    if (data.success) {
      state.sequences = data.sequences;
      renderSequences();
    }
  } catch (err) {
    console.error('Failed to load sequences:', err);
  }
}

function renderSequences() {
  const container = document.getElementById('sequences-container');
  if (!container) return;

  container.innerHTML = state.sequences.map(seq => `
    <div class="double-bezel-card">
      <div class="card-inner-core">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div>
            <h3 style="font-size: 18px; font-weight: 700; color: #FFF;">${escapeHtml(seq.name)}</h3>
            <p style="font-size: 13px; color: var(--text-secondary);">${escapeHtml(seq.description)}</p>
          </div>
          <span class="subtle-chip">${seq.steps.length} Touchpoints</span>
        </div>

        <div class="sequence-timeline">
          ${seq.steps.map(step => `
            <div class="sequence-node">
              <div class="sequence-node-header">
                <span style="font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--accent-indigo-light);">
                  STEP ${step.stepNumber} (Delay: ${step.delayDays === 0 ? 'Day 0 - Instant' : `+${step.delayDays} days`})
                </span>
                <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(step.purpose)}</span>
              </div>
              <div style="font-size: 13px; font-weight: 600; color: #FFF; margin-bottom: 6px;">
                Subject: "${escapeHtml(step.subjectTemplate)}"
              </div>
              <div style="font-size: 12px; line-height: 1.5; color: var(--text-secondary); white-space: pre-wrap; background: rgba(0, 0, 0, 0.3); padding: 12px; border-radius: 6px;">
                ${escapeHtml(step.bodyTemplate)}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

// --- Terminal Logs Tab ---
async function loadLogs() {
  try {
    const res = await fetch('/api/logs?limit=150');
    const data = await res.json();
    if (data.success) {
      state.logs = data.logs;
      renderLogs();
    }
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

function renderLogs() {
  const container = document.getElementById('terminal-log-output');
  if (!container) return;

  let filtered = state.logs;
  if (state.logFilter !== 'all') {
    filtered = filtered.filter(l => l.level === state.logFilter);
  }

  container.innerHTML = filtered.map(l => {
    const time = new Date(l.timestamp).toLocaleTimeString();
    return `
      <div class="log-row">
        <span class="log-clock">[${time}]</span>
        <span class="log-source">&lt;${l.agentId}&gt;</span>
        <span class="log-body ${l.level}">${escapeHtml(l.message)}</span>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

// --- Settings Tab ---
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.success) {
      state.settings = data.settings;
      populateSettingsForm(data.settings);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function populateSettingsForm(s) {
  const elInterval = document.getElementById('setting-cycle-interval');
  const elDaily = document.getElementById('setting-daily-limit');
  const elDelay = document.getElementById('setting-send-delay');
  const elHours = document.getElementById('setting-business-hours');
  const elReply = document.getElementById('setting-auto-reply');
  const elDry = document.getElementById('setting-smtp-dryrun');
  const elHost = document.getElementById('setting-smtp-host');
  const elPort = document.getElementById('setting-smtp-port');
  const elUser = document.getElementById('setting-smtp-user');
  const elName = document.getElementById('setting-smtp-fromname');
  const elTgEn = document.getElementById('setting-telegram-enabled');
  const elTgTok = document.getElementById('setting-telegram-token');
  const elTgChat = document.getElementById('setting-telegram-chatid');
  const elCompName = document.getElementById('setting-company-name');
  const elCompUrl = document.getElementById('setting-company-url');
  const elCompHq = document.getElementById('setting-company-hq');
  const elCompCal = document.getElementById('setting-company-calendar');

  if (elInterval) elInterval.value = s.autonomous.cycleIntervalMinutes || 10;
  if (elDaily) elDaily.value = s.pacing.maxEmailsPerDay || 40;
  if (elDelay) elDelay.value = s.pacing.minDelayMinutesBetweenSends || 8;
  if (elHours) elHours.checked = s.pacing.businessHoursOnly;
  if (elReply) elReply.checked = s.autonomous.autoReplyInterested;

  if (elDry) elDry.checked = s.smtp.dryRun;
  if (elHost) elHost.value = s.smtp.host || 'smtp.gmail.com';
  if (elPort) elPort.value = s.smtp.port || 587;
  if (elUser) elUser.value = s.smtp.user || '';
  if (elName) elName.value = s.smtp.fromName || '';

  if (elTgEn) elTgEn.checked = s.telegram.enabled;
  if (elTgTok) elTgTok.value = s.telegram.botToken || '';
  if (elTgChat) elTgChat.value = s.telegram.chatId || '';

  if (elCompName) elCompName.value = s.jesoraProfile.companyName || 'JESORA TECH';
  if (elCompUrl) elCompUrl.value = s.jesoraProfile.siteUrl || 'https://jesoratech.com';
  if (elCompHq) elCompHq.value = s.jesoraProfile.headquarters || '';
  if (elCompCal) elCompCal.value = s.jesoraProfile.calendarBookingUrl || '';
}

async function saveSettingsFromForm() {
  if (!state.settings) return;

  const updated = {
    ...state.settings,
    autonomous: {
      ...state.settings.autonomous,
      cycleIntervalMinutes: Number(document.getElementById('setting-cycle-interval').value),
      autoReplyInterested: document.getElementById('setting-auto-reply').checked
    },
    pacing: {
      ...state.settings.pacing,
      maxEmailsPerDay: Number(document.getElementById('setting-daily-limit').value),
      minDelayMinutesBetweenSends: Number(document.getElementById('setting-send-delay').value),
      businessHoursOnly: document.getElementById('setting-business-hours').checked
    },
    smtp: {
      ...state.settings.smtp,
      dryRun: document.getElementById('setting-smtp-dryrun').checked,
      host: document.getElementById('setting-smtp-host').value,
      port: Number(document.getElementById('setting-smtp-port').value),
      user: document.getElementById('setting-smtp-user').value,
      fromName: document.getElementById('setting-smtp-fromname').value
    },
    telegram: {
      ...state.settings.telegram,
      enabled: document.getElementById('setting-telegram-enabled').checked,
      botToken: document.getElementById('setting-telegram-token').value,
      chatId: document.getElementById('setting-telegram-chatid').value
    },
    jesoraProfile: {
      ...state.settings.jesoraProfile,
      companyName: document.getElementById('setting-company-name').value,
      siteUrl: document.getElementById('setting-company-url').value,
      headquarters: document.getElementById('setting-company-hq').value,
      calendarBookingUrl: document.getElementById('setting-company-calendar').value
    }
  };

  const passInput = document.getElementById('setting-smtp-pass').value;
  if (passInput) {
    updated.smtp.pass = passInput;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    const data = await res.json();
    if (data.success) {
      state.settings = data.settings;
      showToast('Settings saved successfully!', 'success');
    }
  } catch (err) {
    showToast(`Error saving settings: ${err.message}`, 'error');
  }
}

// --- Lead Drawer ---
async function openLeadDrawer(leadId) {
  try {
    const res = await fetch(`/api/leads/${leadId}`);
    const data = await res.json();
    if (!data.success) return;

    const { lead, messages } = data;
    const drawer = document.getElementById('lead-drawer');
    const inner = document.getElementById('drawer-inner');

    inner.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
        <div>
          <h2 style="font-size: 20px; font-weight: 800; color: #FFF; margin-bottom: 4px;">${escapeHtml(lead.companyName)}</h2>
          <div style="font-size: 13px; color: var(--text-secondary);">${escapeHtml(lead.industry)} | ${escapeHtml(lead.country)}</div>
        </div>
        <button class="modal-close-btn" onclick="closeLeadDrawer()">&times;</button>
      </div>

      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-hairline); border-radius: 10px; padding: 16px; margin-bottom: 20px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px;">
          <div>
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">CONTACT PERSON</div>
            <div style="font-size: 14px; font-weight: 600; color: #FFF;">${escapeHtml(lead.contactName)}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(lead.contactTitle || 'Decision Maker')}</div>
          </div>
          <div>
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">EMAIL ADDRESS</div>
            <div style="font-size: 12px; font-family: var(--font-mono); color: var(--accent-cyan);">${escapeHtml(lead.email)}</div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; border-top: 1px solid var(--border-hairline); padding-top: 12px;">
          <div>
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">WEBSITE</div>
            <a href="${escapeHtml(lead.website)}" target="_blank" style="color: var(--accent-indigo-light); font-size: 12px; text-decoration: none;">
              ${escapeHtml(lead.website)} ↗
            </a>
            ${lead.websiteVerified !== undefined ? `
              <div style="margin-top: 3px; font-size: 10px; font-weight: 700; color: ${lead.websiteVerified ? '#34D399' : '#F87171'};">
                ${lead.websiteVerified ? '✓ Active Live Website' : '✕ No Active Website (Discarded)'}
              </div>` : ''}
          </div>
          <div>
            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">VERIFIED PHYSICAL / HQ ADDRESS</div>
            <div style="font-size: 12px; color: var(--accent-cyan); font-weight: 500;">
              ${lead.address ? `📍 ${escapeHtml(lead.address)}` : 'Address pending verification'}
            </div>
          </div>
        </div>
      </div>

      ${lead.flawReport ? `
        <div style="background: rgba(168, 85, 247, 0.05); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 10px; padding: 16px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 20px;">🔬</span>
              <div>
                <h4 style="font-size: 13px; font-weight: 700; color: #E9D5FF; margin: 0;">Site & Visual Design Diagnostic Report</h4>
                <div style="font-size: 10px; color: var(--text-muted);">Audited ${formatTimeAgo(lead.flawReport.auditedAt)}</div>
              </div>
            </div>
            <div style="display: flex; gap: 16px; text-align: right;">
              <div>
                <div style="font-size: 17px; font-weight: 800; color: ${lead.flawReport.performanceScore < 60 ? '#F87171' : '#FBBF24'};">
                  ${lead.flawReport.performanceScore}/100
                </div>
                <div style="font-size: 10px; color: var(--text-muted);">Tech Health (${lead.flawReport.loadLatencyMs}ms)</div>
              </div>
              <div style="border-left: 1px solid rgba(255,255,255,0.1); padding-left: 16px;">
                <div style="font-size: 17px; font-weight: 800; color: ${(lead.flawReport.designScore || 45) < 60 ? '#F472B6' : '#60A5FA'};">
                  ${lead.flawReport.designScore || 45}/100
                </div>
                <div style="font-size: 10px; color: var(--text-muted); text-transform: capitalize;">${lead.flawReport.visualHierarchyRating || 'Dated'} Design</div>
              </div>
            </div>
          </div>

          ${lead.flawReport.designFlaws && lead.flawReport.designFlaws.length > 0 ? `
            <div style="margin-bottom: 12px; background: rgba(236, 72, 153, 0.06); border: 1px solid rgba(236, 72, 153, 0.25); border-radius: 8px; padding: 10px 12px;">
              <div style="font-size: 10px; font-weight: 700; color: #F472B6; text-transform: uppercase; margin-bottom: 5px; display: flex; align-items: center; gap: 6px;">
                <span>🎨</span> Visual & UI/UX Design Flaws
              </div>
              <ul style="margin: 0; padding-left: 18px; font-size: 11px; color: #F1F5F9; line-height: 1.5;">
                ${lead.flawReport.designFlaws.map(df => `<li style="margin-bottom: 4px;">${escapeHtml(df)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          <div style="margin-bottom: 12px;">
            <div style="font-size: 10px; font-weight: 700; color: #FCA5A5; text-transform: uppercase; margin-bottom: 4px;">Critical Architectural Flaws</div>
            <ul style="margin: 0; padding-left: 18px; font-size: 11px; color: #CBD5E1; line-height: 1.5;">
              ${lead.flawReport.criticalFlaws.map(f => `<li style="margin-bottom: 3px;">${escapeHtml(f)}</li>`).join('')}
            </ul>
          </div>

          <div style="margin-bottom: 12px;">
            <div style="font-size: 10px; font-weight: 700; color: #FCD34D; text-transform: uppercase; margin-bottom: 4px;">Conversion Bottlenecks</div>
            <ul style="margin: 0; padding-left: 18px; font-size: 11px; color: #CBD5E1; line-height: 1.5;">
              ${lead.flawReport.conversionBottlenecks.map(b => `<li style="margin-bottom: 3px;">${escapeHtml(b)}</li>`).join('')}
            </ul>
          </div>

          <div>
            <div style="font-size: 10px; font-weight: 700; color: #86EFAC; text-transform: uppercase; margin-bottom: 4px;">Recommended Modernization Fixes</div>
            <ul style="margin: 0; padding-left: 18px; font-size: 11px; color: #CBD5E1; line-height: 1.5;">
              ${lead.flawReport.recommendedFixes.map(fix => `<li style="margin-bottom: 3px;">${escapeHtml(fix)}</li>`).join('')}
            </ul>
          </div>
        </div>
      ` : ''}

      <div style="margin-bottom: 20px;">
        <h4 style="font-size: 13px; font-weight: 700; color: #FFF; margin-bottom: 8px;">Technical Stack & Audit Findings</h4>
        <div style="background: rgba(0, 0, 0, 0.35); padding: 12px; border-radius: 6px; font-size: 12px; line-height: 1.5; color: #CBD5E1;">
          ${escapeHtml(lead.techStack || 'No technical stack recorded.')}
        </div>
      </div>

      <div style="margin-bottom: 20px;">
        <h4 style="font-size: 13px; font-weight: 700; color: #FFF; margin-bottom: 8px;">Pain Points & Opportunities</h4>
        <div style="background: rgba(245, 158, 11, 0.08); border-left: 3px solid var(--accent-amber); padding: 12px; border-radius: 6px; font-size: 12px; line-height: 1.5; color: #FCD34D;">
          ${escapeHtml(lead.painPoints || 'Custom software development, UI/UX revamp, or ERP automation.')}
        </div>
      </div>

      <div>
        <h4 style="font-size: 13px; font-weight: 700; color: #FFF; margin-bottom: 10px;">Outreach Email History (${messages.length})</h4>
        ${messages.length === 0 ? '<div style="font-size: 12px; color: var(--text-muted);">No sequence emails generated for this prospect yet.</div>' : ''}
        ${messages.map(m => `
          <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-hairline); border-radius: 6px; padding: 12px; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-size: 10px; font-weight: 700; color: var(--accent-indigo-light);">STEP ${m.sequenceStepNumber} — ${m.status.toUpperCase()}</span>
              <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${m.sentAt ? new Date(m.sentAt).toLocaleDateString() : 'Scheduled'}</span>
            </div>
            <div style="font-size: 12px; font-weight: 600; color: #FFF; margin-bottom: 4px;">${escapeHtml(m.subject)}</div>
            <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.4; white-space: pre-wrap;">${escapeHtml(m.body)}</div>
          </div>
        `).join('')}
      </div>
    `;

    drawer.classList.add('open');
  } catch (err) {
    console.error('Failed to open drawer:', err);
  }
}

function closeLeadDrawer() {
  document.getElementById('lead-drawer').classList.remove('open');
}

// --- Modals Initialization ---
function initModals() {
  // Add Lead Modal
  const btnOpenAdd = document.getElementById('btn-open-add-lead-modal');
  const modalAdd = document.getElementById('modal-add-lead');
  const closeAdd = document.getElementById('modal-add-lead-close');
  const cancelAdd = document.getElementById('btn-cancel-add-lead');
  const submitAdd = document.getElementById('btn-submit-add-lead');

  if (btnOpenAdd) btnOpenAdd.addEventListener('click', () => modalAdd.classList.add('open'));
  if (closeAdd) closeAdd.addEventListener('click', () => modalAdd.classList.remove('open'));
  if (cancelAdd) cancelAdd.addEventListener('click', () => modalAdd.classList.remove('open'));

  if (submitAdd) {
    submitAdd.addEventListener('click', async () => {
      const company = document.getElementById('new-lead-company').value.trim();
      const email = document.getElementById('new-lead-email').value.trim();
      const contact = document.getElementById('new-lead-contact').value.trim();

      if (!company || !email || !contact) {
        showToast('Please fill out Company, Contact, and Email.', 'error');
        return;
      }

      try {
        const res = await fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyName: company,
            website: document.getElementById('new-lead-website').value.trim(),
            contactName: contact,
            contactTitle: document.getElementById('new-lead-title').value.trim(),
            email: email,
            industry: document.getElementById('new-lead-industry').value.trim(),
            campaignId: document.getElementById('new-lead-campaign').value,
            techStack: document.getElementById('new-lead-tech').value.trim(),
            painPoints: document.getElementById('new-lead-pain').value.trim()
          })
        });

        const data = await res.json();
        if (data.success) {
          showToast(`Added ${company} to outreach pipeline!`, 'success');
          modalAdd.classList.remove('open');
          loadLeads();
          loadStatus();
        } else {
          showToast(data.error || 'Failed to add lead', 'error');
        }
      } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
      }
    });
  }

  // CSV Import Modal
  const btnOpenCsv = document.getElementById('btn-open-csv-modal');
  const modalCsv = document.getElementById('modal-import-csv');
  const closeCsv = document.getElementById('modal-import-csv-close');
  const cancelCsv = document.getElementById('btn-cancel-import-csv');
  const submitCsv = document.getElementById('btn-submit-import-csv');
  const fileInputCsv = document.getElementById('csv-file-input');
  const pasteAreaCsv = document.getElementById('csv-paste-textarea');
  const previewSummary = document.getElementById('csv-preview-summary');

  if (btnOpenCsv) btnOpenCsv.addEventListener('click', () => modalCsv.classList.add('open'));
  if (closeCsv) closeCsv.addEventListener('click', () => modalCsv.classList.remove('open'));
  if (cancelCsv) cancelCsv.addEventListener('click', () => modalCsv.classList.remove('open'));

  if (fileInputCsv) {
    fileInputCsv.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text === 'string') {
          pasteAreaCsv.value = text;
          updateCsvPreview(text);
        }
      };
      reader.readAsText(file);
    });
  }

  if (pasteAreaCsv) {
    pasteAreaCsv.addEventListener('input', () => updateCsvPreview(pasteAreaCsv.value));
  }

  function updateCsvPreview(text) {
    if (!previewSummary) return;
    const rows = parseCsvToObjects(text);
    if (rows.length > 0) {
      previewSummary.style.display = 'block';
      previewSummary.innerHTML = `
        <strong>Detected:</strong> ${rows.length} lead row(s).<br>
        <span style="color: var(--text-muted);">First lead preview: ${escapeHtml(rows[0].companyName || 'Unknown')} — ${escapeHtml(rows[0].email || 'No email')} (${escapeHtml(rows[0].address || 'No address')})</span>
      `;
    } else {
      previewSummary.style.display = 'none';
    }
  }

  if (submitCsv) {
    submitCsv.addEventListener('click', async () => {
      const text = pasteAreaCsv.value.trim();
      const rows = parseCsvToObjects(text);

      if (rows.length === 0) {
        showToast('Please upload a valid CSV file or paste lead rows.', 'error');
        return;
      }

      submitCsv.disabled = true;
      submitCsv.innerHTML = '<span>⏳</span> Validating & Importing...';

      try {
        const res = await fetch('/api/leads/import-csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: rows })
        });
        const data = await res.json();

        if (data.success) {
          showToast(`✓ Imported ${data.importedCount} verified lead(s)! (Discarded ${data.discardedCount} invalid)`, 'success');
          modalCsv.classList.remove('open');
          pasteAreaCsv.value = '';
          if (fileInputCsv) fileInputCsv.value = '';
          if (previewSummary) previewSummary.style.display = 'none';
          loadLeads();
          loadStatus();
        } else {
          showToast(data.error || 'Failed to import CSV', 'error');
        }
      } catch (err) {
        showToast(`Import error: ${err.message}`, 'error');
      } finally {
        submitCsv.disabled = false;
        submitCsv.innerHTML = '<span>🚀</span> Import & Verify Leads';
      }
    });
  }
  const modalSim = document.getElementById('modal-simulate-reply');
  const closeSim = document.getElementById('modal-simulate-close');
  const cancelSim = document.getElementById('btn-cancel-sim');
  const submitSim = document.getElementById('btn-submit-sim');

  if (closeSim) closeSim.addEventListener('click', () => modalSim.classList.remove('open'));
  if (cancelSim) cancelSim.addEventListener('click', () => modalSim.classList.remove('open'));

  document.querySelectorAll('.preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      applySimPreset(preset);
    });
  });

  if (submitSim) {
    submitSim.addEventListener('click', async () => {
      const email = document.getElementById('sim-email').value.trim();
      const subject = document.getElementById('sim-subject').value.trim();
      const body = document.getElementById('sim-body').value.trim();

      if (!email || !body) {
        showToast('Please provide an email and message body.', 'error');
        return;
      }

      try {
        const res = await fetch('/api/simulate/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromEmail: email, subject, body })
        });

        const data = await res.json();
        if (data.success) {
          showToast(`Inbound message processed! Intent: ${data.reply.sentiment}`, 'success');
          modalSim.classList.remove('open');
          loadAllData();
          setActiveTab('inbox');
        }
      } catch (err) {
        showToast(`Simulation error: ${err.message}`, 'error');
      }
    });
  }
}

function openSimulateModal() {
  document.getElementById('modal-simulate-reply').classList.add('open');
}

function applySimPreset(preset) {
  const emailInput = document.getElementById('sim-email');
  const subjectInput = document.getElementById('sim-subject');
  const bodyInput = document.getElementById('sim-body');

  if (preset === 'meeting') {
    emailInput.value = 'david@hyperion-ai-demo.io';
    subjectInput.value = 'Re: Quick question regarding Hyperion AI Labs\'s software roadmap';
    bodyInput.value = 'Hi Rajan, thanks for the email. We actually need a full Next.js responsive web app for our AI models right now. Would love to hop on a 15-minute call Thursday at 2pm EST to discuss. Does that time work?';
  } else if (preset === 'interested') {
    emailInput.value = 'elena@aurabloom-demo.com';
    subjectInput.value = 'Re: Software engineering inquiry';
    bodyInput.value = 'Hi team, sounds interesting. We are struggling with our current website loading speeds and checkout flow. Could you send over a rough pricing estimate and a couple more e-commerce case studies you have built?';
  } else if (preset === 'stack') {
    emailInput.value = 'dr.arthur@lumina-dental.com';
    subjectInput.value = 'Re: Technical feasibility inquiry';
    bodyInput.value = 'Hello, do you have experience integrating with HIPAA-compliant EHR APIs and building mobile apps with Flutter? Also, where is your engineering team located?';
  } else if (preset === 'unsub') {
    emailInput.value = 'marcus@solaceactive-demo.com';
    subjectInput.value = 'Unsubscribe';
    bodyInput.value = 'Please unsubscribe and remove me from your mailing list.';
  }
}

function initDrawer() {
  const drawer = document.getElementById('lead-drawer');
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) closeLeadDrawer();
  });
}

// --- Interactive Actions ---
function initActions() {
  // Run Cycle Now
  const btnRunCycle = document.getElementById('btn-run-cycle');
  if (btnRunCycle) {
    btnRunCycle.addEventListener('click', async () => {
      btnRunCycle.disabled = true;
      btnRunCycle.textContent = 'Syncing...';
      try {
        const res = await fetch('/api/orchestrator/cycle', { method: 'POST' });
        const data = await res.json();
        showToast(data.summary || 'Cycle completed!', 'success');
        loadAllData();
      } catch (err) {
        showToast(`Cycle error: ${err.message}`, 'error');
      } finally {
        btnRunCycle.disabled = false;
        btnRunCycle.innerHTML = '<span>⚡</span> Sync Full Cycle';
      }
    });
  }

  // Toggle 24x7 Autopilot
  const btnTogglePilot = document.getElementById('btn-toggle-pilot');
  if (btnTogglePilot) {
    btnTogglePilot.addEventListener('click', async () => {
      const willEnable = !state.cycleInfo.isRunning24x7;
      try {
        const res = await fetch('/api/orchestrator/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enable: willEnable })
        });
        const data = await res.json();
        state.cycleInfo.isRunning24x7 = data.isRunning24x7;
        renderStatusIndicator(state.cycleInfo);
        showToast(data.isRunning24x7 ? '24x7 Autonomous Daemon Activated' : '24x7 Daemon Stopped', 'info');
      } catch (err) {
        showToast(`Toggle error: ${err.message}`, 'error');
      }
    });
  }

  // Scout triggers
  const btnScoutNow = document.getElementById('btn-scout-lead-now');
  if (btnScoutNow) {
    btnScoutNow.addEventListener('click', () => triggerScoutForCampaign());
  }

  const btnTriggerScout = document.getElementById('btn-trigger-scout');
  if (btnTriggerScout) {
    btnTriggerScout.addEventListener('click', () => triggerScoutForCampaign());
  }

  const btnSimHotReply = document.getElementById('btn-simulate-hot-reply');
  if (btnSimHotReply) {
    btnSimHotReply.addEventListener('click', () => openSimulateModal());
  }

  const btnTriggerTestReply = document.getElementById('btn-trigger-test-reply');
  if (btnTriggerTestReply) {
    btnTriggerTestReply.addEventListener('click', () => openSimulateModal());
  }

  // Lead search & filters
  const searchInput = document.getElementById('lead-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.leadSearchQuery = e.target.value;
      renderLeadsTable();
    });
  }

  document.querySelectorAll('.segment-tab').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.segment-tab').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.selectedLeadFilter = pill.dataset.filter;
      loadLeads();
    });
  });

  // Terminal filters
  document.querySelectorAll('[data-log-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-log-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.logFilter = btn.dataset.logFilter;
      renderLogs();
    });
  });

  const btnClearTerm = document.getElementById('btn-clear-terminal');
  if (btnClearTerm) {
    btnClearTerm.addEventListener('click', () => {
      state.logs = [];
      renderLogs();
    });
  }

  // Save Settings
  const btnSaveSettings = document.getElementById('btn-save-settings');
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => saveSettingsFromForm());
  }

  // Test Telegram
  const btnTestTelegram = document.getElementById('btn-test-telegram');
  if (btnTestTelegram) {
    btnTestTelegram.addEventListener('click', async () => {
      btnTestTelegram.disabled = true;
      btnTestTelegram.textContent = 'Sending...';
      try {
        const res = await fetch('/api/test/telegram', { method: 'POST' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
      } catch (err) {
        showToast(`Telegram test failed: ${err.message}`, 'error');
      } finally {
        btnTestTelegram.disabled = false;
        btnTestTelegram.innerHTML = '<span>📲</span> Send Test Telegram Alert';
      }
    });
  }
}

// Global actions exposed to onclick
window.runSingleAgent = async function(role) {
  try {
    const res = await fetch(`/api/agents/${role}/run`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`${role} executed: ${data.message}`, 'success');
      loadStatus();
      if (state.activeTab === 'leads') loadLeads();
      if (state.activeTab === 'terminal') loadLogs();
    } else {
      showToast(data.error || 'Agent run failed', 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

window.togglePauseAgent = async function(role, action) {
  try {
    await fetch(`/api/agents/${role}/${action}`, { method: 'POST' });
    showToast(`Agent ${role} ${action}d.`, 'info');
    loadStatus();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
};

window.triggerScoutForCampaign = async function(campaignId) {
  try {
    showToast('Lead Scout Agent is hunting prospective companies...', 'info');
    const res = await fetch('/api/leads/scout-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId, count: 2 })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Scouted ${data.leadsAdded} new qualified lead(s)!`, 'success');
      loadAllData();
    }
  } catch (err) {
    showToast(`Scout error: ${err.message}`, 'error');
  }
};

window.deleteLeadPrompt = async function(leadId) {
  if (confirm('Are you sure you want to delete this prospect from the pipeline?')) {
    try {
      await fetch(`/api/leads/${leadId}`, { method: 'DELETE' });
      showToast('Lead deleted.', 'info');
      loadLeads();
      loadStatus();
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }
};

window.openLeadDrawer = openLeadDrawer;
window.closeLeadDrawer = closeLeadDrawer;
window.selectReply = selectReply;
window.openSimulateModal = openSimulateModal;

// --- Helper Functions ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTimeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function parseCsvToObjects(csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    if (values.length === 0) continue;

    const obj = {};
    headers.forEach((header, idx) => {
      const val = (values[idx] || '').trim();
      if (header.includes('company') || header.includes('business')) obj.companyName = val;
      else if (header.includes('contact') && (header.includes('name') || !obj.contactName)) obj.contactName = val;
      else if (header.includes('title') || header.includes('role')) obj.contactTitle = val;
      else if (header.includes('email') || header.includes('mail')) obj.email = val;
      else if (header.includes('website') || header.includes('url') || header.includes('domain')) obj.website = val;
      else if (header.includes('address') || header.includes('street') || header.includes('location')) obj.address = val;
      else if (header.includes('industry') || header.includes('category') || header.includes('niche')) obj.industry = val;
      else if (header.includes('phone') || header.includes('tel')) obj.phone = val;
      else if (header.includes('country')) obj.country = val;
    });

    if (obj.companyName || obj.email) {
      rows.push(obj);
    }
  }
  return rows;
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
