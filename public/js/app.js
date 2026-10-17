// ===================================================================
// JESORA TECH - Autonomous 24x7 Outreach Command Center
// Interactive Frontend Controller
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
  const tabs = document.querySelectorAll('.nav-tab');
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
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === targetTab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${targetTab}`);
  });

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
    showToast(`Cycle #${data.cycleCount} finished (${data.totalActions} actions)`, 'info');
    loadStatus();
    if (state.activeTab === 'leads') loadLeads();
    if (state.activeTab === 'terminal') loadLogs();
  });

  eventSource.addEventListener('hot_lead', (e) => {
    const data = JSON.parse(e.data);
    showToast(`🔥 HOT LEAD: ${data.lead.companyName} (${data.reply.sentiment})`, 'success');
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
  const btnToggle = document.getElementById('btn-toggle-pilot');
  if (info.isRunning24x7) {
    label.textContent = `24x7 AUTO-PILOT ACTIVE (Cycle #${info.cycleCount})`;
    btnToggle.innerHTML = '<span class="btn-icon">⏹</span> Stop 24x7';
    btnToggle.className = 'btn btn-outline btn-sm';
  } else {
    label.textContent = 'AUTO-PILOT STANDBY';
    btnToggle.innerHTML = '<span class="btn-icon">▶</span> Start 24x7';
    btnToggle.className = 'btn btn-primary btn-sm';
  }
}

function renderKPIs(stats) {
  document.getElementById('kpi-total-leads').textContent = stats.totalLeads || 0;
  document.getElementById('kpi-scouted-leads').textContent = `+${stats.scoutedLeads || 0} scouted`;
  document.getElementById('kpi-emails-sent').textContent = stats.totalEmailsSent || 0;
  document.getElementById('kpi-contacted-leads').textContent = `${stats.contactedLeads || 0} contacted`;
  document.getElementById('kpi-replies-count').textContent = stats.repliedLeads || 0;
  document.getElementById('kpi-reply-rate').textContent = `${stats.replyRatePercent}%`;
  document.getElementById('kpi-meetings-booked').textContent = stats.meetingsBooked || 0;
  document.getElementById('kpi-conv-rate').textContent = `${stats.conversionRatePercent}%`;

  // Estimate pipeline value: Each meeting booked estimated at $3,500 average contract value
  const estimatedVal = (stats.meetingsBooked * 3500) + (stats.repliedLeads * 800);
  document.getElementById('kpi-pipeline-value').textContent = `$${estimatedVal.toLocaleString()}`;

  // Update nav badges
  document.getElementById('tab-lead-count').textContent = stats.totalLeads || 0;
  document.getElementById('tab-reply-count').textContent = stats.repliedLeads || 0;
  document.getElementById('tab-meet-count').textContent = stats.meetingsBooked || 0;
  document.getElementById('badge-active-campaigns').textContent = `${stats.activeCampaigns || 0} Active Campaigns`;
}

function renderAgents(agents) {
  const container = document.getElementById('agents-grid-container');
  if (!container) return;

  const agentIcons = {
    lead_scout: '🔍',
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
      <div class="agent-card glass-panel">
        <div class="agent-header">
          <div class="agent-identity">
            <div class="agent-avatar">${icon}</div>
            <div>
              <div class="agent-name">${agent.name}</div>
              <div class="agent-role">${agent.role}</div>
            </div>
          </div>
          <span class="status-chip ${agent.status}">${agent.status}</span>
        </div>

        <p class="agent-desc">${agent.description}</p>

        <div class="agent-task-box">
          <span class="agent-task-label">CURRENT OPERATION</span>
          <div class="agent-task-text" title="${agent.currentTask}">${agent.currentTask || 'Idle'}</div>
        </div>

        <div class="agent-metrics-row">
          <div class="metric-item">
            <span class="metric-label">TOTAL RUNS</span>
            <span class="metric-val">${agent.totalRuns}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">ACTIONS</span>
            <span class="metric-val">${agent.totalActions}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">LAST ACTIVE</span>
            <span class="metric-val">${agent.lastRunAt ? formatTimeAgo(agent.lastRunAt) : 'Never'}</span>
          </div>
        </div>

        <div class="agent-footer-actions">
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
    { label: 'Contacted (Emails Sent)', count: stats.contactedLeads, pct: Math.min(100, Math.round((stats.contactedLeads / total) * 100)) },
    { label: 'Replies Received', count: stats.repliedLeads, pct: Math.min(100, Math.round((stats.repliedLeads / total) * 100)) },
    { label: 'Meetings Booked 🚀', count: stats.meetingsBooked, pct: Math.min(100, Math.round((stats.meetingsBooked / total) * 100)) }
  ];

  container.innerHTML = steps.map(s => `
    <div class="funnel-step">
      <span class="funnel-step-name">${s.label}</span>
      <div class="funnel-step-bar-wrap">
        <div class="funnel-step-bar" style="width: ${Math.max(5, s.pct)}%"></div>
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

  container.innerHTML = logs.slice(0, 7).map(l => `
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
        <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
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
          <div class="table-company-cell">
            <span class="lead-company-name">${escapeHtml(l.companyName)}</span>
            <span class="lead-contact-sub">${escapeHtml(l.contactName)} (${escapeHtml(l.contactTitle || 'Lead')})</span>
            <a href="${escapeHtml(l.website)}" target="_blank" style="color: var(--accent-cyan); font-size: 11px; text-decoration: none; margin-top: 2px;">
              ${escapeHtml(l.website.replace('https://', ''))} ↗
            </a>
          </div>
        </td>
        <td>
          <div>${escapeHtml(l.industry)}</div>
          <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(l.country)}</span>
        </td>
        <td>
          <span class="lead-score-pill ${scoreClass}">${l.score} / 100</span>
        </td>
        <td style="max-width: 280px;">
          <div style="font-size: 11px; color: #CBD5E1; line-height: 1.4;">${escapeHtml(l.techStack || 'Uninspected')}</div>
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
        <td>
          <div style="display: flex; gap: 6px;">
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
        <div class="thread-header">
          <span class="thread-sender">${escapeHtml(r.fromEmail)}</span>
          <span class="thread-date">${formatTimeAgo(r.receivedAt)}</span>
        </div>
        <div class="thread-subject">${escapeHtml(r.subject)}</div>
        <div style="margin-bottom: 6px;">
          <span class="ai-sentiment-badge ${sentimentBadgeClass}" style="margin: 0; padding: 2px 6px; font-size: 10px;">
            ${r.sentiment}
          </span>
        </div>
        <div class="thread-preview">${escapeHtml(r.body)}</div>
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
      <span class="ai-sentiment-badge ${sentimentBadgeClass}">
        Intent: ${reply.sentiment} (${Math.round(reply.sentimentConfidence * 100)}% confidence)
      </span>
    </div>

    <div style="background: rgba(99, 102, 241, 0.1); border-left: 3px solid var(--accent-indigo); padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 12px; color: #E2E8F0;">
      <strong>🤖 AI Summary:</strong> ${escapeHtml(reply.aiSummary)}
    </div>

    <div class="inbox-viewer-body">${escapeHtml(reply.body)}</div>

    <div class="ai-suggested-box">
      <div class="ai-box-title">
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
      <div class="glass-panel" style="grid-column: span 2; padding: 60px 20px; text-align: center;">
        <div style="font-size: 40px; margin-bottom: 12px;">📅</div>
        <h3 style="font-size: 18px; color: #FFF; margin-bottom: 6px;">No meetings booked yet</h3>
        <p style="font-size: 13px; color: var(--text-secondary); max-width: 460px; margin: 0 auto 16px;">
          When an interested prospect replies or requests a discovery call, the Meeting Closer Agent automatically reserves the slot and drafts a briefing document.
        </p>
        <button class="btn btn-sm btn-primary" onclick="openSimulateModal()">Test Hot Lead Meeting Flow</button>
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
      <div class="meeting-card glass-panel">
        <div class="meeting-card-title">${escapeHtml(lead ? lead.companyName : 'Discovery Call')}</div>
        <div class="meeting-time-row">
          <span>🕒</span> ${dateFormatted} (${m.durationMinutes} mins)
        </div>
        <div style="font-size: 13px; color: #CBD5E1; margin-bottom: 14px;">
          <strong>Agenda:</strong> ${escapeHtml(m.agenda)}
        </div>
        
        <div class="executive-brief-box">${escapeHtml(m.executiveBrief || 'No executive brief compiled.')}</div>

        <div style="display: flex; gap: 10px; align-items: center;">
          <a href="${m.meetUrl}" target="_blank" class="btn btn-sm btn-primary">
            <span>📹</span> Launch Google Meet
          </a>
          <button class="btn btn-sm btn-secondary" onclick="openLeadDrawer('${m.leadId}')">
            Lead CRM Dossier
          </button>
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
    <div class="campaign-card glass-panel">
      <div class="campaign-title-row">
        <div>
          <div class="campaign-name">${escapeHtml(c.name)}</div>
          <span style="font-size: 11px; color: var(--accent-cyan); font-family: var(--font-mono);">${escapeHtml(c.targetNiche)}</span>
        </div>
        <span class="status-chip ${c.status}">${c.status}</span>
      </div>

      <p class="campaign-desc">${escapeHtml(c.description)}</p>

      <div class="campaign-tags">
        ${(c.targetLocations || []).map(loc => `<span class="tag-pill">📍 ${escapeHtml(loc)}</span>`).join('')}
        ${(c.keywords || []).map(kw => `<span class="tag-pill">#${escapeHtml(kw)}</span>`).join('')}
      </div>

      <div class="agent-metrics-row">
        <div class="metric-item">
          <span class="metric-label">LEADS TARGETED</span>
          <span class="metric-val">${c.leadsTargeted}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">CONTACTED</span>
          <span class="metric-val">${c.leadsContacted}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">REPLIES</span>
          <span class="metric-val">${c.leadsReplied}</span>
        </div>
        <div class="metric-item">
          <span class="metric-label">MEETINGS</span>
          <span class="metric-val highlight-amber">${c.meetingsBooked}</span>
        </div>
      </div>

      <div style="display: flex; gap: 8px;">
        <button class="btn btn-sm btn-secondary" onclick="triggerScoutForCampaign('${c.id}')">
          <span>🔍</span> Scout Leads For This Niche
        </button>
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
    <div class="glass-panel" style="padding: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <div>
          <h3 style="font-size: 20px; font-weight: 700; color: #FFF;">${escapeHtml(seq.name)}</h3>
          <p style="font-size: 13px; color: var(--text-secondary);">${escapeHtml(seq.description)}</p>
        </div>
        <span class="badge" style="background: rgba(99, 102, 241, 0.2); color: var(--accent-indigo-light);">${seq.steps.length} Touchpoints</span>
      </div>

      <div class="sequence-timeline">
        ${seq.steps.map(step => `
          <div class="sequence-step-card">
            <div class="step-header">
              <span class="step-num">STEP ${step.stepNumber} (Delay: ${step.delayDays === 0 ? 'Day 0 - Instant' : `+${step.delayDays} days`})</span>
              <span style="font-size: 11px; color: var(--text-muted);">${escapeHtml(step.purpose)}</span>
            </div>
            <div class="step-subject">Subject: "${escapeHtml(step.subjectTemplate)}"</div>
            <div class="step-body-preview">${escapeHtml(step.bodyTemplate)}</div>
          </div>
        `).join('')}
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
      <div class="log-line">
        <span class="log-ts">[${time}]</span>
        <span class="log-agent">&lt;${l.agentId}&gt;</span>
        <span class="log-text ${l.level}">${escapeHtml(l.message)}</span>
      </div>
    `;
  }).join('');

  // Auto-scroll to bottom
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
  document.getElementById('setting-cycle-interval').value = s.autonomous.cycleIntervalMinutes || 10;
  document.getElementById('setting-daily-limit').value = s.pacing.maxEmailsPerDay || 40;
  document.getElementById('setting-send-delay').value = s.pacing.minDelayMinutesBetweenSends || 8;
  document.getElementById('setting-business-hours').checked = s.pacing.businessHoursOnly;
  document.getElementById('setting-auto-reply').checked = s.autonomous.autoReplyInterested;

  document.getElementById('setting-smtp-dryrun').checked = s.smtp.dryRun;
  document.getElementById('setting-smtp-host').value = s.smtp.host || 'smtp.gmail.com';
  document.getElementById('setting-smtp-port').value = s.smtp.port || 587;
  document.getElementById('setting-smtp-user').value = s.smtp.user || '';
  document.getElementById('setting-smtp-fromname').value = s.smtp.fromName || '';

  document.getElementById('setting-telegram-enabled').checked = s.telegram.enabled;
  document.getElementById('setting-telegram-token').value = s.telegram.botToken || '';
  document.getElementById('setting-telegram-chatid').value = s.telegram.chatId || '';

  document.getElementById('setting-company-name').value = s.jesoraProfile.companyName || 'JESORA TECH';
  document.getElementById('setting-company-url').value = s.jesoraProfile.siteUrl || 'https://jesoratech.com';
  document.getElementById('setting-company-hq').value = s.jesoraProfile.headquarters || '';
  document.getElementById('setting-company-calendar').value = s.jesoraProfile.calendarBookingUrl || '';
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
          <h2 style="font-size: 22px; font-weight: 700; color: #FFF; margin-bottom: 4px;">${escapeHtml(lead.companyName)}</h2>
          <div style="font-size: 13px; color: var(--text-secondary);">${escapeHtml(lead.industry)} | ${escapeHtml(lead.country)}</div>
        </div>
        <button class="modal-close" onclick="closeLeadDrawer()">&times;</button>
      </div>

      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 18px; margin-bottom: 24px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
          <div>
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">CONTACT PERSON</div>
            <div style="font-size: 14px; font-weight: 600; color: #FFF;">${escapeHtml(lead.contactName)}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(lead.contactTitle || 'Decision Maker')}</div>
          </div>
          <div>
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">EMAIL ADDRESS</div>
            <div style="font-size: 13px; font-family: var(--font-mono); color: var(--accent-cyan);">${escapeHtml(lead.email)}</div>
          </div>
        </div>
        <div>
          <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">WEBSITE</div>
          <a href="${escapeHtml(lead.website)}" target="_blank" style="color: var(--accent-indigo-light); font-size: 13px; text-decoration: none;">
            ${escapeHtml(lead.website)} ↗
          </a>
        </div>
      </div>

      <div style="margin-bottom: 24px;">
        <h4 style="font-size: 14px; font-weight: 700; color: #FFF; margin-bottom: 8px;">Technical Stack & Audit Findings</h4>
        <div style="background: rgba(10, 14, 23, 0.6); padding: 14px; border-radius: var(--radius-sm); font-size: 12px; line-height: 1.5; color: #CBD5E1;">
          ${escapeHtml(lead.techStack || 'No technical stack recorded.')}
        </div>
      </div>

      <div style="margin-bottom: 24px;">
        <h4 style="font-size: 14px; font-weight: 700; color: #FFF; margin-bottom: 8px;">Pain Points & Opportunities</h4>
        <div style="background: rgba(245, 158, 11, 0.08); border-left: 3px solid var(--accent-amber); padding: 14px; border-radius: var(--radius-sm); font-size: 12px; line-height: 1.5; color: #FCD34D;">
          ${escapeHtml(lead.painPoints || 'Custom software development, UI/UX revamp, or ERP automation.')}
        </div>
      </div>

      <div>
        <h4 style="font-size: 14px; font-weight: 700; color: #FFF; margin-bottom: 12px;">Outreach Email History (${messages.length})</h4>
        ${messages.length === 0 ? '<div style="font-size: 12px; color: var(--text-muted);">No sequence emails generated for this prospect yet.</div>' : ''}
        ${messages.map(m => `
          <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 14px; margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
              <span style="font-size: 11px; font-weight: 700; color: var(--accent-indigo-light);">STEP ${m.sequenceStepNumber} — ${m.status.toUpperCase()}</span>
              <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${m.sentAt ? new Date(m.sentAt).toLocaleDateString() : 'Scheduled'}</span>
            </div>
            <div style="font-size: 12px; font-weight: 600; color: #FFF; margin-bottom: 6px;">${escapeHtml(m.subject)}</div>
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

  // Simulate Inbound Modal
  const modalSim = document.getElementById('modal-simulate-reply');
  const closeSim = document.getElementById('modal-simulate-close');
  const cancelSim = document.getElementById('btn-cancel-sim');
  const submitSim = document.getElementById('btn-submit-sim');

  if (closeSim) closeSim.addEventListener('click', () => modalSim.classList.remove('open'));
  if (cancelSim) cancelSim.addEventListener('click', () => modalSim.classList.remove('open'));

  document.querySelectorAll('.preset-btn').forEach(btn => {
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
  // Top header buttons
  const btnRunCycle = document.getElementById('btn-run-cycle');
  if (btnRunCycle) {
    btnRunCycle.addEventListener('click', async () => {
      btnRunCycle.disabled = true;
      btnRunCycle.textContent = 'Running Cycle...';
      try {
        const res = await fetch('/api/orchestrator/cycle', { method: 'POST' });
        const data = await res.json();
        showToast(data.summary || 'Cycle completed!', 'success');
        loadAllData();
      } catch (err) {
        showToast(`Cycle error: ${err.message}`, 'error');
      } finally {
        btnRunCycle.disabled = false;
        btnRunCycle.innerHTML = '<span class="btn-icon">⚡</span> Run Cycle Now';
      }
    });
  }

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

  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
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
      btnTestTelegram.textContent = 'Sending Ping...';
      try {
        const res = await fetch('/api/test/telegram', { method: 'POST' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'error');
      } catch (err) {
        showToast(`Telegram test failed: ${err.message}`, 'error');
      } finally {
        btnTestTelegram.disabled = false;
        btnTestTelegram.innerHTML = '<span>📲</span> Send Test Telegram Ping';
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
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => toast.remove(), 300);
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
