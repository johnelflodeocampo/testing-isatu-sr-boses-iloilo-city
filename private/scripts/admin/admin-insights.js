const feedbackTable = document.querySelector('#feedback-table-body');
const feedbackCount = document.querySelector('#feedback-count');
const feedbackMessage = document.querySelector('#feedback-list-message');
const searchInput = document.querySelector('#feedback-search');
const statusFilter = document.querySelector('#feedback-status-filter');
const detailDialog = document.querySelector('#feedback-detail-dialog');
let feedbackItems = [];
let currentFeedback = null;
let currentRole = 'admin';
let currentPage = 1;
const pageSize = 10;

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
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
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
  }[status] || status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nextStatuses(insight) {
  if (insight.status === 'pending') return ['under_review'];
  if (insight.status === 'under_review') return ['in_progress'];
  if (insight.status === 'in_progress') return ['implemented', 'not_implemented'];
  return [];
}

function renderEmpty(message, className = 'empty-state') {
  const row = document.createElement('tr');
  row.append(element('td', className, message));
  row.firstElementChild.colSpan = 6;
  feedbackTable.replaceChildren(row);
}

function populateStatusFilter() {
  const selectedStatus = statusFilter.value;
  const statusOrder = [
    'pending',
    'under_review',
    'in_progress',
    'implemented',
    'not_implemented',
    'resolved',
    'archived',
  ];
  const statuses = [...new Set(feedbackItems.map((insight) => insight.status))];
  statuses.sort((first, second) => {
    const firstIndex = statusOrder.indexOf(first);
    const secondIndex = statusOrder.indexOf(second);
    return (firstIndex < 0 ? statusOrder.length : firstIndex)
      - (secondIndex < 0 ? statusOrder.length : secondIndex);
  });

  const allStatuses = element('option', '', 'All statuses');
  allStatuses.value = 'all';
  statusFilter.replaceChildren(
    allStatuses,
    ...statuses.map((status) => {
      const option = element('option', '', formatStatus(status));
      option.value = status;
      return option;
    }),
  );
  statusFilter.value = statuses.includes(selectedStatus) ? selectedStatus : 'all';
}

function submitterLabel(insight) {
  if (insight.is_anonymous) return 'Anonymous';
  return typeof insight.sender_label === 'string' && insight.sender_label.includes('@')
    ? insight.sender_label
    : 'Email unavailable';
}

function renderFeedback() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedStatus = statusFilter.value;
  const filtered = feedbackItems.filter((insight) => {
    const matchesStatus = selectedStatus === 'all' || insight.status === selectedStatus;
    const searchable = [
      insight.tracking_id,
      insight.status,
      insight.content,
      submitterLabel(insight),
    ].join(' ').toLowerCase();
    return matchesStatus && searchable.includes(query);
  });
  const pageCount = Math.ceil(filtered.length / pageSize);
  currentPage = Math.min(currentPage, Math.max(pageCount, 1));
  const start = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);
  const pagination = document.querySelector('#feedback-pagination');
  pagination.hidden = filtered.length <= pageSize;
  document.querySelector('#feedback-page-status').textContent = (
    `Page ${currentPage} of ${pageCount} · ${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`
  );
  document.querySelector('#feedback-previous-page').disabled = currentPage <= 1;
  document.querySelector('#feedback-next-page').disabled = currentPage >= pageCount;

  if (!filtered.length) {
    renderEmpty(feedbackItems.length ? 'No Portal Insights match this view.' : 'No Portal Insights have been submitted yet.');
    return;
  }

  feedbackTable.replaceChildren(...pageItems.map((insight) => {
    const row = document.createElement('tr');
    row.append(
      element('th', 'tracking-code', insight.tracking_id),
    );
    const content = element('td', 'feedback-content-cell', insight.content);
    content.title = insight.content;
    row.append(content);
    row.append(element('td', 'feedback-submitter-cell', submitterLabel(insight)));
    const statusCell = document.createElement('td');
    statusCell.append(element('span', `status-pill status-${insight.status.replaceAll('_', '-')}`, formatStatus(insight.status)));
    row.append(statusCell);
    row.append(element('td', '', new Date(insight.created_at).toLocaleString()));
    const actions = document.createElement('td');
    const viewButton = element('button', 'button button-small button-muted', 'View details');
    viewButton.type = 'button';
    viewButton.addEventListener('click', () => showDetails(insight));
    actions.append(viewButton);
    row.append(actions);
    return row;
  }));
}

function renderStatusComment(insight) {
  const note = document.querySelector('#feedback-status-note');
  note.hidden = !insight.status_comment;
  note.replaceChildren();
  if (!insight.status_comment) return;
  note.append(
    element('strong', '', 'Officer outcome note'),
    element('p', '', insight.status_comment),
  );
}

function updateCommentVisibility() {
  const status = document.querySelector('#feedback-next-status').value;
  const needsComment = ['implemented', 'not_implemented'].includes(status);
  document.querySelector('#feedback-status-comment-label').hidden = !needsComment;
  document.querySelector('#feedback-status-comment').hidden = !needsComment;
  if (!needsComment) document.querySelector('#feedback-status-comment').value = '';
}

function showDetails(insight) {
  currentFeedback = insight;
  document.querySelector('#feedback-detail-title').textContent = insight.tracking_id;
  document.querySelector('#feedback-detail-meta').replaceChildren(
    element('span', `status-pill status-${insight.status.replaceAll('_', '-')}`, formatStatus(insight.status)),
    element('span', 'report-meta', `Submitted: ${new Date(insight.created_at).toLocaleString()}`),
    element('span', 'report-meta', insight.is_anonymous ? 'Submitted anonymously' : `Submitted by ${submitterLabel(insight)}`),
  );
  renderStatusComment(insight);
  document.querySelector('#feedback-detail-content').textContent = insight.content;

  const editor = document.querySelector('#feedback-status-editor');
  const statusOptions = nextStatuses(insight);
  editor.hidden = currentRole !== 'superadmin' || statusOptions.length === 0;
  const statusSelect = document.querySelector('#feedback-next-status');
  statusSelect.replaceChildren(...statusOptions.map((status) => {
    const option = element('option', '', formatStatus(status));
    option.value = status;
    return option;
  }));
  document.querySelector('#feedback-status-message').textContent = '';
  document.querySelector('#feedback-status-comment').value = '';
  updateCommentVisibility();

  const dismissButton = document.querySelector('#dismiss-feedback');
  dismissButton.hidden = currentRole !== 'superadmin'
    || insight.report_type !== 'feedback';
  detailDialog.showModal();
}

async function loadFeedback() {
  feedbackMessage.textContent = '';
  document.querySelector('#feedback-pagination').hidden = true;
  renderEmpty('Loading Portal Insights…');
  try {
    const session = await api('/api/me');
    if (!['admin', 'superadmin'].includes(session.role)) {
      window.location.assign('/admin/login');
      return;
    }
    currentRole = session.role;
    document.querySelector('#officer-name').textContent = session.name || session.email;
    document.querySelector('#officer-email').textContent = session.email;
    document.querySelector('#access-role').textContent = currentRole === 'superadmin' ? 'Superadmin' : 'Admin';
    for (const id of ['archive-link', 'sender-tags-link', 'officer-access-link', 'privacy-link']) {
      document.querySelector(`#${id}`).hidden = currentRole !== 'superadmin';
    }

    const result = await api('/api/admin/portal-insights');
    if (!Array.isArray(result.insights)) {
      throw new Error('The server returned an invalid Portal Insights list.');
    }
    const visibleInsights = [
      ...result.insights,
      ...(currentRole === 'superadmin' && Array.isArray(result.archived) ? result.archived : []),
    ];
    feedbackItems = visibleInsights.filter((insight) => insight.report_type === 'feedback');
    feedbackItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    populateStatusFilter();
    currentPage = 1;
    feedbackCount.textContent = String(feedbackItems.length);
    renderFeedback();
  } catch (error) {
    feedbackItems = [];
    populateStatusFilter();
    feedbackCount.textContent = '0';
    renderEmpty(error.message, 'form-message is-error');
  }
}

async function saveStatus() {
  if (!currentFeedback || currentRole !== 'superadmin') return;
  const button = document.querySelector('#save-feedback-status');
  const status = document.querySelector('#feedback-next-status').value;
  const message = document.querySelector('#feedback-status-message');
  button.disabled = true;
  message.textContent = 'Updating status…';
  message.className = 'form-message';
  try {
    const trackingId = currentFeedback.tracking_id;
    await api(`/api/admin/portal-insights/${encodeURIComponent(currentFeedback.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        statusComment: document.querySelector('#feedback-status-comment').value.trim() || null,
      }),
    });
    detailDialog.close();
    currentFeedback = null;
    await loadFeedback();
    feedbackMessage.textContent = `Status updated for ${trackingId}.`;
  } catch (error) {
    message.textContent = error.message;
    message.className = 'form-message is-error';
  } finally {
    button.disabled = false;
  }
}

async function dismissFeedback() {
  if (!currentFeedback || currentRole !== 'superadmin' || currentFeedback.report_type !== 'feedback') return;
  if (!window.confirm(
    `Permanently dismiss and delete the Portal Insights submission ${currentFeedback.tracking_id}? This cannot be undone.`,
  )) return;

  const button = document.querySelector('#dismiss-feedback');
  button.disabled = true;
  try {
    await api(`/api/admin/portal-insights/${encodeURIComponent(currentFeedback.id)}`, {
      method: 'DELETE',
    });
    const trackingId = currentFeedback.tracking_id;
    detailDialog.close();
    currentFeedback = null;
    await loadFeedback();
    feedbackMessage.textContent = `${trackingId} was dismissed and permanently deleted.`;
  } catch (error) {
    feedbackMessage.textContent = error.message;
    feedbackMessage.className = 'form-message is-error';
  } finally {
    button.disabled = false;
  }
}

function resetPageAndRender() {
  currentPage = 1;
  renderFeedback();
}

searchInput.addEventListener('input', resetPageAndRender);
statusFilter.addEventListener('change', resetPageAndRender);
document.querySelector('#feedback-previous-page').addEventListener('click', () => {
  currentPage -= 1;
  renderFeedback();
});
document.querySelector('#feedback-next-page').addEventListener('click', () => {
  currentPage += 1;
  renderFeedback();
});
document.querySelector('#refresh-feedback').addEventListener('click', loadFeedback);
document.querySelector('#feedback-next-status').addEventListener('change', updateCommentVisibility);
document.querySelector('#save-feedback-status').addEventListener('click', saveStatus);
document.querySelector('#dismiss-feedback').addEventListener('click', dismissFeedback);
document.querySelector('#close-feedback-detail').addEventListener('click', () => detailDialog.close());
detailDialog.addEventListener('click', (event) => {
  if (event.target === detailDialog) detailDialog.close();
});
document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    window.bosesNavigate('/');
  } catch (error) {
    window.alert(error.message);
  }
});

loadFeedback();
