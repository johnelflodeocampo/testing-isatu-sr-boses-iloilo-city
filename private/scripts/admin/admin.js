const adminReportList = document.querySelector('#admin-report-list');
const adminMessage = document.querySelector('#admin-message');
const dashboardRecentReports = document.querySelector('#dashboard-recent-reports');
const dashboardRecentInsights = document.querySelector('#dashboard-recent-insights');
let allInsights = [];
let archivedInsights = [];
let portalInsights = [];
let currentRole = 'admin';
let assignableAdmins = [];
let activeConcern = null;
let pendingStatusUpdate = null;
let assignmentFilter = 'all';
const isReportsPage = document.body.classList.contains('admin-reports-page');

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method ? { 'X-Requested-With': 'BOSES-Client' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
  return body;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatStatus(status) {
  return {
    under_review: 'Under Review',
    in_progress: 'In Progress',
    not_implemented: 'Not Implemented',
  }[status] || status[0].toUpperCase() + status.slice(1);
}

function statusClass(status) {
  return `status-${status.replaceAll('_', '-')}`;
}

function downloadReportPdf(insight) {
  const file = new Blob(
    [window.BosesReportPdf.create(insight, { includeStatus: false, archiveCopy: false })],
    { type: 'application/pdf' },
  );
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = window.BosesReportPdf.filename(insight);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canDownloadReport(insight) {
  return ['reviewing', 'under_review', 'in_progress'].includes(insight.status);
}

function nextStatuses(insight) {
  if (insight.report_type === 'feedback' && currentRole !== 'superadmin') return [];
  if (insight.report_type === 'feedback') {
    if (insight.status === 'pending') return ['under_review'];
    if (insight.status === 'under_review') return ['in_progress'];
    if (insight.status === 'in_progress') return ['implemented', 'not_implemented'];
  } else {
    if (insight.status === 'pending') return ['reviewing', 'resolved'];
    if (insight.status === 'reviewing') return ['in_progress', 'resolved', 'dismissed'];
    if (insight.status === 'in_progress') return ['resolved', 'dismissed'];
  }
  if (['resolved', 'dismissed', 'implemented', 'not_implemented'].includes(insight.status)
    && currentRole === 'superadmin') return ['archived'];
  return [];
}

function statusNeedsComment(insight, status) {
  return insight.report_type === 'concern'
    ? ['resolved', 'dismissed'].includes(status)
    : ['implemented', 'not_implemented'].includes(status);
}

function showStatusComment(insight, status, button) {
  pendingStatusUpdate = { insight, status, button };
  document.querySelector('#status-comment-title').textContent = `${formatStatus(status)} outcome`;
  document.querySelector('#status-comment-input').value = (
    insight.status_comment_status === status ? insight.status_comment || '' : ''
  );
  document.querySelector('#status-comment-message').textContent = '';
  document.querySelector('#status-comment-dialog').showModal();
  document.querySelector('#status-comment-input').focus();
}

function renderStatusComment(container, insight) {
  container.hidden = !insight.status_comment;
  container.replaceChildren();
  if (!insight.status_comment) return;
  container.append(
    element('strong', '', 'Officer outcome note'),
    element('p', '', insight.status_comment),
  );
}

async function saveStatus(insight, status, statusComment, button) {
  button.disabled = true;
  try {
    await api(`/api/admin/insights/${encodeURIComponent(insight.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, statusComment }),
    });
    const commentDialog = document.querySelector('#status-comment-dialog');
    if (commentDialog.open) commentDialog.close();
    pendingStatusUpdate = null;
    await loadInsights();
    document.querySelector(
      insight.report_type === 'concern' ? '#admin-concern-dialog' : '#admin-feedback-dialog',
    ).close();
    adminMessage.textContent = 'Status updated.';
    adminMessage.className = 'form-message';
  } catch (error) {
    const commentDialog = document.querySelector('#status-comment-dialog');
    const message = commentDialog.open ? document.querySelector('#status-comment-message') : adminMessage;
    message.textContent = error.message;
    message.className = 'form-message is-error';
    button.disabled = false;
  }
}

async function changeStatus(insight, status, button) {
  if (['reviewing', 'under_review', 'in_progress', 'resolved', 'dismissed', 'implemented', 'not_implemented', 'archived'].includes(status)) {
    const reportType = insight.report_type === 'feedback' ? 'Feedback' : 'Concern';
    const confirmation = `Mark this ${reportType.toLowerCase()} as ${formatStatus(status)}?`;
    if (!window.confirm(confirmation)) return;
  }
  if (statusNeedsComment(insight, status)) return showStatusComment(insight, status, button);
  return saveStatus(insight, status, null, button);
}

async function changePriority(insight, priority, button) {
  button.disabled = true;
  try {
    await api(`/api/admin/insights/${encodeURIComponent(insight.id)}/priority`, {
      method: 'PATCH',
      body: JSON.stringify({ priority }),
    });
    await loadInsights();
    adminMessage.textContent = `Priority updated to ${priority}.`;
    adminMessage.className = 'form-message';
    button.disabled = false;
  } catch (error) {
    adminMessage.textContent = error.message;
    adminMessage.className = 'form-message is-error';
    button.disabled = false;
  }
}

async function changeChatStatus(insight, enabled, button) {
  button.disabled = true;
  try {
    await api(`/api/admin/insights/${encodeURIComponent(insight.id)}/chat`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    await loadInsights();
    if (insight.report_type === 'concern') document.querySelector('#admin-concern-dialog').close();
    adminMessage.textContent = enabled
      ? 'Chat enabled for this resolved report.'
      : 'Chat disabled for this resolved report.';
    adminMessage.className = 'form-message';
  } catch (error) {
    adminMessage.textContent = error.message;
    adminMessage.className = 'form-message is-error';
    button.disabled = false;
  }
}

function renderInsight(insight) {
  const isConcern = insight.report_type === 'concern';
  const reportType = isConcern ? 'Concern' : 'Feedback';
  const card = element('article', `admin-report-card${isConcern ? ' admin-concern-card' : ''}`);
  const header = element('div', 'report-card-top');
  const heading = element('strong', 'tracking-code', insight.tracking_id);
  header.append(
    heading,
    element('span', `status-pill ${statusClass(insight.status)}`, formatStatus(insight.status)),
  );
  const summary = element(
    'p',
    'report-meta',
    `${insight.is_anonymous ? 'Anonymous' : `Identified · ${insight.sender_label}`} · ${new Date(insight.created_at).toLocaleDateString()}`,
  );
  const viewButton = element('button', 'text-button report-view-button', 'View report details');
  viewButton.type = 'button';
  viewButton.addEventListener('click', () => {
    if (isConcern) showConcernDetails(insight);
    else showFeedbackDetails(insight);
  });
  const messagesLink = element('a', 'text-button', 'Open conversation');
  messagesLink.href = `/inbox?report=${encodeURIComponent(insight.id)}`;
  const actions = element('div', 'report-actions');
  actions.append(viewButton);
  if (insight.status !== 'archived') actions.append(messagesLink);
  card.append(header, element('p', 'report-meta report-type-label', reportType), summary);
  if (isConcern) {
    card.append(element(
      'p',
      'report-meta',
      insight.assigned_admin ? `Assigned to ${insight.assigned_admin}` : 'Awaiting superadmin assignment',
    ));
  }
  card.append(actions);
  return card;
}

function showFeedbackDetails(insight) {
  document.querySelector('#admin-feedback-title').textContent = insight.tracking_id;
  document.querySelector('#admin-feedback-meta').replaceChildren(
    element('span', `status-pill ${statusClass(insight.status)}`, formatStatus(insight.status)),
    element('span', 'report-meta', `Submitted ${new Date(insight.created_at).toLocaleString()}`),
    element('span', 'report-meta', insight.is_anonymous ? 'Anonymous submission' : `Submitter: ${insight.sender_label}`),
  );
  document.querySelector('#admin-feedback-content').textContent = insight.content;
  renderStatusComment(document.querySelector('#admin-feedback-status-comment'), insight);
  const messagesLink = document.querySelector('#admin-feedback-messages');
  messagesLink.href = `/inbox?report=${encodeURIComponent(insight.id)}`;
  messagesLink.hidden = insight.status === 'archived';

  const statusActions = document.querySelector('#admin-feedback-status-actions');
  statusActions.replaceChildren();
  if (canDownloadReport(insight)) {
    const downloadButton = element('button', 'button button-small button-muted', 'Download report PDF');
    downloadButton.type = 'button';
    downloadButton.addEventListener('click', () => downloadReportPdf(insight));
    statusActions.append(downloadButton);
  }
  for (const status of nextStatuses(insight)) {
    const button = element('button', 'button button-small', `Mark ${formatStatus(status)}`);
    button.type = 'button';
    button.addEventListener('click', () => changeStatus(insight, status, button));
    statusActions.append(button);
  }
  document.querySelector('#admin-feedback-dialog').showModal();
}

function showConcernDetails(insight) {
  activeConcern = insight;
  document.querySelector('#admin-concern-title').textContent = insight.tracking_id;
  document.querySelector('#admin-concern-meta').replaceChildren(
    element('span', `status-pill ${statusClass(insight.status)}`, formatStatus(insight.status)),
    element('span', 'report-meta', `Submitted ${new Date(insight.created_at).toLocaleString()}`),
    element('span', 'report-meta', insight.is_anonymous ? 'Anonymous submission' : `Submitter: ${insight.sender_label}`),
    element('span', 'report-meta', insight.assigned_admin ? `Assigned admin: ${insight.assigned_admin}` : 'Unassigned — superadmin queue'),
    element('span', 'report-meta', `Priority: ${insight.priority}`),
  );
  document.querySelector('#admin-concern-content').textContent = insight.content;
  renderStatusComment(document.querySelector('#admin-concern-status-comment'), insight);
  const messagesLink = document.querySelector('#admin-concern-messages');
  messagesLink.href = `/inbox?report=${encodeURIComponent(insight.id)}`;
  messagesLink.hidden = insight.status === 'archived';

  const assignmentPanel = document.querySelector('#admin-concern-assignment');
  assignmentPanel.hidden = currentRole !== 'superadmin' || insight.status === 'archived';
  if (currentRole === 'superadmin' && insight.status !== 'archived') {
    const assignmentSelect = document.querySelector('#admin-concern-assignee');
    assignmentSelect.replaceChildren(element('option', '', 'Unassigned'));
    assignmentSelect.firstElementChild.value = '';
    for (const admin of assignableAdmins) {
      const option = element('option', '', admin.email);
      option.value = admin.email;
      option.selected = admin.email === insight.assigned_admin;
      assignmentSelect.append(option);
    }
    assignmentSelect.value = insight.assigned_admin || '';
  }

  document.querySelector('#admin-concern-priority').hidden = currentRole !== 'superadmin' || insight.status === 'archived';
  document.querySelector('#admin-concern-priority-select').value = insight.priority;
  const statusActions = document.querySelector('#admin-concern-status-actions');
  statusActions.replaceChildren();
  if (canDownloadReport(insight)) {
    const downloadButton = element('button', 'button button-small button-muted', 'Download report PDF');
    downloadButton.type = 'button';
    downloadButton.addEventListener('click', () => downloadReportPdf(insight));
    statusActions.append(downloadButton);
  }
  for (const status of nextStatuses(insight)) {
    const button = element('button', 'button button-small', `Mark ${formatStatus(status)}`);
    button.type = 'button';
    button.addEventListener('click', () => changeStatus(insight, status, button));
    statusActions.append(button);
  }
  if (insight.status === 'resolved') {
    const chatButton = element('button', `button button-small${insight.chat_enabled ? ' button-muted' : ''}`,
      insight.chat_enabled ? 'Disable chat' : 'Enable chat');
    chatButton.type = 'button';
    chatButton.addEventListener('click', () => changeChatStatus(insight, !insight.chat_enabled, chatButton));
    statusActions.append(chatButton);
  }
  document.querySelector('#admin-concern-dialog').showModal();
}

async function saveConcernAssignment(button) {
  if (!activeConcern) return;
  button.disabled = true;
  try {
    await api(`/api/admin/insights/${encodeURIComponent(activeConcern.id)}/assignment`, {
      method: 'PATCH',
      body: JSON.stringify({
        assignedAdmin: document.querySelector('#admin-concern-assignee').value || null,
      }),
    });
    document.querySelector('#admin-concern-dialog').close();
    adminMessage.textContent = 'Concern assignment updated.';
    adminMessage.className = 'form-message';
    await loadInsights();
  } catch (error) {
    adminMessage.textContent = error.message;
    adminMessage.className = 'form-message is-error';
  } finally {
    button.disabled = false;
  }
}

async function saveConcernPriority(button) {
  if (!activeConcern) return;
  await changePriority(
    activeConcern,
    document.querySelector('#admin-concern-priority-select').value,
    button,
  );
  if (!button.disabled) {
    const updated = allInsights.find((insight) => insight.id === activeConcern.id);
    if (updated) showConcernDetails(updated);
  }
}

function renderList() {
  if (!adminReportList) return;
  const query = document.querySelector('#search-input').value.trim().toLowerCase();
  const reportType = document.querySelector('#report-type-filter').value;
  const status = document.querySelector('#report-status-filter').value;
  const source = status === 'archived' ? archivedInsights : allInsights;
  const filtered = source.filter((insight) => {
    const matchesType = reportType === 'all' || insight.report_type === reportType;
    const matchesStatus = status === 'all' || insight.status === status;
    const matchesAssignment = assignmentFilter === 'all'
      || (insight.report_type === 'concern'
        && Boolean(insight.assigned_admin) === (assignmentFilter === 'assigned'));
    const searchable = `${insight.tracking_id} ${insight.report_type} ${insight.status} ${insight.content} ${insight.sender_label}`.toLowerCase();
    return matchesType && matchesStatus && matchesAssignment && searchable.includes(query);
  });
  if (!filtered.length) {
    adminReportList.replaceChildren(element('p', 'empty-state', 'No reports match this view.'));
    return;
  }
  adminReportList.replaceChildren(...filtered.map(renderInsight));
}

function renderRecentReports() {
  if (!dashboardRecentReports) return;
  const recent = allInsights
    .slice()
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .slice(0, 3);
  if (!recent.length) {
    dashboardRecentReports.replaceChildren(element('p', 'empty-state', 'No recent reports.'));
    return;
  }
  dashboardRecentReports.replaceChildren(...recent.map((insight) => {
    const reportType = insight.report_type === 'concern' ? 'Concern' : 'Feedback';
    const card = element('article', 'admin-report-card dashboard-recent-report');
    const heading = element('div', 'report-card-top');
    heading.append(
      element('strong', 'tracking-code', insight.tracking_id),
      element('span', `status-pill ${statusClass(insight.status)}`, formatStatus(insight.status)),
    );
    const meta = element('div', 'dashboard-recent-report-meta');
    meta.append(
      element('span', 'report-meta', reportType),
      element('span', 'report-meta', new Date(insight.created_at).toLocaleDateString()),
    );
    card.append(
      heading,
      meta,
      element('p', 'dashboard-recent-report-preview', insight.content),
    );
    return card;
  }));
}

function renderRecentPortalInsights() {
  if (!dashboardRecentInsights) return;
  const recent = portalInsights
    .slice()
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .slice(0, 3);
  if (!recent.length) {
    dashboardRecentInsights.replaceChildren(element('p', 'empty-state', 'No recent Portal Insights.'));
    return;
  }
  dashboardRecentInsights.replaceChildren(...recent.map((insight) => {
    const card = element('article', 'admin-report-card dashboard-recent-report');
    const heading = element('div', 'report-card-top');
    heading.append(
      element('strong', 'tracking-code', insight.tracking_id),
      element('span', `status-pill ${statusClass(insight.status)}`, formatStatus(insight.status)),
    );
    const meta = element('div', 'dashboard-recent-report-meta');
    meta.append(element('span', 'report-meta', new Date(insight.created_at).toLocaleDateString()));
    card.append(
      heading,
      meta,
      element('p', 'dashboard-recent-report-preview', insight.content),
    );
    return card;
  }));
}

function updateStatusFilter() {
  const reportTypeFilter = document.querySelector('#report-type-filter');
  const statusFilter = document.querySelector('#report-status-filter');
  if (!reportTypeFilter || !statusFilter) return;
  const reportType = reportTypeFilter.value;
  const previousStatus = statusFilter.value;
  const statuses = reportType === 'concern'
    ? ['pending', 'reviewing', 'in_progress', 'resolved', 'dismissed']
    : reportType === 'feedback'
      ? ['pending', 'under_review', 'in_progress', 'implemented', 'not_implemented', 'resolved']
      : ['pending', 'reviewing', 'under_review', 'in_progress', 'resolved', 'dismissed', 'implemented', 'not_implemented'];
  if (isReportsPage && currentRole === 'superadmin') statuses.push('archived');
  statusFilter.replaceChildren(element('option', '', 'All statuses'));
  statusFilter.firstElementChild.value = 'all';
  for (const status of statuses) {
    const option = element('option', '', formatStatus(status));
    option.value = status;
    statusFilter.append(option);
  }
  statusFilter.value = statuses.includes(previousStatus) ? previousStatus : 'all';
}

function updateAssignmentButtons() {
  const unavailable = document.querySelector('#report-type-filter')?.value === 'feedback';
  for (const button of document.querySelectorAll('[data-assignment-filter]')) {
    const selected = !unavailable && button.dataset.assignmentFilter === assignmentFilter;
    button.disabled = unavailable;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('button-muted', !selected);
  }
}

let loadingInsights = false;

async function loadInsights() {
  if (loadingInsights) return;
  loadingInsights = true;
  const refreshButton = document.querySelector('#refresh-button');
  if (refreshButton) refreshButton.disabled = true;
  if (adminReportList) {
    adminReportList.replaceChildren(element('p', 'empty-state', 'Loading reports…'));
  }
  try {
    const [result, portalResult] = await Promise.all([
      api('/api/admin/insights'),
      dashboardRecentInsights ? api('/api/admin/portal-insights') : Promise.resolve({ insights: [] }),
    ]);
    if (!Array.isArray(result.insights)) {
      throw new Error('The server returned an invalid submissions list.');
    }
    if (!result.counts
      || !['active', 'pending', 'reviewing', 'under_review', 'in_progress', 'completed', 'archived'].every(
        (key) => Number.isInteger(result.counts[key]) && result.counts[key] >= 0,
      )) {
      throw new Error('The server returned invalid report totals.');
    }
    allInsights = result.insights.filter((insight) => insight.status !== 'archived');
    if (isReportsPage && currentRole === 'superadmin') {
      if (!Array.isArray(result.archived)) {
        throw new Error('The server returned an invalid archived reports list.');
      }
      archivedInsights = result.archived;
    } else {
      archivedInsights = [];
    }
    if (!Array.isArray(portalResult.insights)) {
      throw new Error('The server returned an invalid Portal Insights list.');
    }
    portalInsights = portalResult.insights.filter((insight) => insight.status !== 'archived');
    for (const [status, countKey] of Object.entries({
      all: 'active',
      pending: 'pending',
      reviewing: 'reviewing',
      'under-review': 'under_review',
      'in-progress': 'in_progress',
      resolved: 'completed',
      archived: 'archived',
    })) {
      const count = document.querySelector(`#count-${status}`);
      if (count) count.textContent = String(result.counts[countKey]);
    }
    renderList();
    renderRecentReports();
    renderRecentPortalInsights();
  } catch (error) {
    if (adminReportList) {
      adminReportList.replaceChildren(element('p', 'form-message is-error', error.message));
    } else {
      if (dashboardRecentReports) {
        dashboardRecentReports.replaceChildren(element('p', 'form-message is-error', error.message));
      }
      if (dashboardRecentInsights) {
        dashboardRecentInsights.replaceChildren(element('p', 'form-message is-error', error.message));
      }
      if (adminMessage) {
        adminMessage.textContent = error.message;
        adminMessage.className = 'form-message is-error';
      }
    }
  } finally {
    loadingInsights = false;
    if (refreshButton) refreshButton.disabled = false;
  }
}

if (adminReportList) {
  document.querySelector('#search-input').addEventListener('input', renderList);
  document.querySelector('#report-type-filter').addEventListener('change', () => {
    if (document.querySelector('#report-type-filter').value === 'feedback') assignmentFilter = 'all';
    updateStatusFilter();
    updateAssignmentButtons();
    renderList();
  });
  document.querySelector('#report-status-filter').addEventListener('change', renderList);
  for (const button of document.querySelectorAll('[data-assignment-filter]')) {
    button.addEventListener('click', () => {
      const nextFilter = button.dataset.assignmentFilter;
      assignmentFilter = assignmentFilter === nextFilter ? 'all' : nextFilter;
      updateAssignmentButtons();
      renderList();
    });
  }
  document.querySelector('#status-comment-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pendingStatusUpdate) return;
    const { insight, status, button } = pendingStatusUpdate;
    const comment = document.querySelector('#status-comment-input').value.trim();
    saveStatus(insight, status, comment || null, button);
  });
  for (const id of ['close-status-comment', 'cancel-status-comment']) {
    document.querySelector(`#${id}`).addEventListener('click', () => {
      document.querySelector('#status-comment-dialog').close();
      pendingStatusUpdate = null;
    });
  }
}
document.querySelector('#refresh-button')?.addEventListener('click', loadInsights);
document.querySelector('#logout-button')?.addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    window.bosesNavigate('/');
  } catch (error) {
    window.alert(error.message);
  }
});

async function initialize() {
  try {
    const session = await api('/api/me');
    currentRole = session.role;
    const isSuperadmin = currentRole === 'superadmin';
    updateStatusFilter();
    document.querySelector('#officer-name').textContent = session.name || session.email;
    document.querySelector('#officer-email').textContent = session.email;
    document.querySelector('#access-role').textContent = isSuperadmin ? 'Superadmin' : 'Admin';
    document.querySelector('#dashboard-heading').textContent = isReportsPage
      ? 'Reports'
      : isSuperadmin ? 'Superadmin dashboard' : 'Admin dashboard';
    document.querySelector('#sidebar-workspace').textContent = isSuperadmin
      ? 'Superadmin workspace'
      : 'Officer workspace';
    const dashboardAction = document.querySelector('#superadmin-dashboard-action');
    if (dashboardAction) dashboardAction.hidden = !isSuperadmin;
    document.querySelector('#archive-link').hidden = !isSuperadmin;
    document.querySelector('#sender-tags-link').hidden = !isSuperadmin;
    document.querySelector('#officer-access-link').hidden = !isSuperadmin;
    document.querySelector('#privacy-link').hidden = !isSuperadmin;
    if (currentRole === 'superadmin' && adminReportList) {
      const result = await api('/api/superadmin/admins');
      assignableAdmins = result.admins.filter((admin) => admin.role === 'admin');
    }
    await loadInsights();
  } catch (error) {
    adminReportList.replaceChildren(element('p', 'form-message is-error', error.message));
  }
}

if (adminReportList) {
  document.querySelector('#close-admin-concern').addEventListener('click', () => {
    document.querySelector('#admin-concern-dialog').close();
  });
  document.querySelector('#close-admin-feedback').addEventListener('click', () => {
    document.querySelector('#admin-feedback-dialog').close();
  });
  document.querySelector('#admin-concern-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.querySelector('#admin-feedback-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.querySelector('#admin-concern-assign-button').addEventListener('click', (event) => {
    saveConcernAssignment(event.currentTarget);
  });
  document.querySelector('#admin-concern-priority-button').addEventListener('click', (event) => {
    saveConcernPriority(event.currentTarget);
  });
}

updateStatusFilter();
updateAssignmentButtons();
initialize();

function initOfficerNotifications() {
  const bell = document.querySelector('[data-notification-bell]');
  const dropdown = document.querySelector('[data-notification-dropdown]');
  const list = document.querySelector('[data-notification-list]');
  const badge = document.querySelector('[data-notification-badge]');
  if (!bell || !dropdown || !list) return;

  async function load() {
    try {
      const response = await fetch('/api/notifications', { credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load notifications.');
      if (badge) {
        badge.textContent = String(result.unread);
        badge.hidden = result.unread === 0;
      }
      if (!result.notifications.length) {
        list.innerHTML = '<p class="empty-state">You have no notifications.</p>';
        return;
      }
      list.replaceChildren(...result.notifications.slice(0, 5).map((item) => {
        const link = document.createElement('a');
        link.className = `notification-dropdown-item${item.is_read ? '' : ' is-unread'}`;
        link.href = item.link;
        link.innerHTML = `<strong>${item.title}</strong><span>${item.body}</span>`;
        link.addEventListener('click', () => {
          if (!item.is_read) fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'BOSES-Client' },
          }).catch(() => {});
        });
        return link;
      }));
    } catch (error) {
      list.innerHTML = `<p class="form-message is-error">${error.message}</p>`;
    }
  }

  bell.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = dropdown.hidden;
    dropdown.hidden = !open;
    bell.setAttribute('aria-expanded', String(open));
    if (open) load();
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('.notification-bell-wrap')) return;
    dropdown.hidden = true;
    bell.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      dropdown.hidden = true;
      bell.setAttribute('aria-expanded', 'false');
      bell.focus();
    }
  });
  load();
}
