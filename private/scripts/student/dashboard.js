const reportForm = document.querySelector('#report-form');
const reportMessage = document.querySelector('#report-message');
const reportContent = document.querySelector('#report-content');
const reportWordCount = document.querySelector('#report-word-count');
const reportList = document.querySelector('#report-list');
const reportCount = document.querySelector('#report-count');
const reportSearch = document.querySelector('#report-search');
const reportTypeFilter = document.querySelector('#report-type-filter');
const reportStatusFilter = document.querySelector('#report-status-filter');
const reportPagination = document.querySelector('#report-pagination');
const reportDetailDialog = document.querySelector('#report-detail-dialog');
const trackingConfirmation = document.querySelector('#tracking-confirmation');
const dashboardRecentReports = document.querySelector('#dashboard-recent-reports');
const draftList = document.querySelector('#draft-list');
const draftCount = document.querySelector('#draft-count');
const saveDraftButton = document.querySelector('#save-draft-button');
const newReportButton = document.querySelector('#new-report-button');
let currentDraftId = null;
let memberReports = [];
let currentReportPage = 1;
const reportsPerPage = 6;
const maxReportCharacters = 10000;

function countWords(value) {
  const text = value.trim();
  return text ? text.split(/\s+/u).length : 0;
}

function updateWordCount(input, output) {
  if (!input || !output) return 0;
  const words = countWords(input.value);
  output.textContent = `${words.toLocaleString()} words · ${input.value.length.toLocaleString()} / ${maxReportCharacters.toLocaleString()} characters`;
  return words;
}

function updateDraftListScroll() {
  if (!draftList || draftList.children.length <= 3) {
    draftList?.classList.remove('has-scroll');
    return;
  }
  draftList.classList.add('has-scroll');
}

async function requestApi(url, options = {}) {
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

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
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

function reportTypeLabel(insight) {
  return insight.report_type === 'concern' ? 'Concern' : 'Feedback';
}

function renderStatusComment(container, insight) {
  container.hidden = !insight.status_comment;
  container.replaceChildren();
  if (!insight.status_comment) return;
  container.append(
    makeElement('strong', '', 'Officer outcome note'),
    makeElement('p', '', insight.status_comment),
  );
}

function createReportCard(insight) {
  const displayStatus = insight.status;
  const card = makeElement('article', 'report-card');
  card.dataset.reportCard = 'true';
  const top = makeElement('div', 'report-card-top');
  const tracking = makeElement('strong', 'tracking-code', insight.tracking_id);
  const status = makeElement('span', `status-pill ${statusClass(displayStatus)}`, formatStatus(displayStatus));
  top.append(tracking, status);
  const type = makeElement('p', 'report-meta report-type-label', reportTypeLabel(insight));
  const meta = makeElement(
    'p',
    'report-meta',
    `${insight.is_anonymous ? 'Anonymous' : `Identified · ${insight.sender_label}`} · ${new Date(insight.created_at).toLocaleDateString()}`,
  );
  const details = makeElement('div', 'report-card-details');
  details.append(type, meta);
  card.append(top, details);

  const actions = makeElement('div', 'report-actions');
  const viewButton = makeElement('button', 'text-button report-view-button', 'View');
  viewButton.type = 'button';
  viewButton.addEventListener('click', () => showReportDetails(insight));
  const messagesLink = makeElement('a', 'text-button', 'Inbox');
  messagesLink.href = `/inbox?report=${encodeURIComponent(insight.id)}`;
  actions.append(viewButton, messagesLink);
  if (insight.status === 'pending') {
    const editButton = makeElement('button', 'text-button', 'Edit');
    editButton.type = 'button';
    editButton.addEventListener('click', () => showEditor(card, insight));
    const withdrawButton = makeElement('button', 'text-button danger-link', 'Withdraw');
    withdrawButton.type = 'button';
    withdrawButton.addEventListener('click', async () => {
      if (!window.confirm(`Withdraw report ${insight.tracking_id}? This cannot be undone.`)) return;
      try {
        await requestApi(`/api/my/insights/${encodeURIComponent(insight.id)}`, { method: 'DELETE' });
        await loadReports();
      } catch (error) {
        window.alert(error.message);
      }
    });
    actions.append(editButton, withdrawButton);
  }
  card.append(actions);
  return card;
}

function showReportDetails(insight) {
  const displayStatus = insight.status;
  document.querySelector('#report-detail-title').textContent = insight.tracking_id;
  const metadata = document.querySelector('#report-detail-meta');
  metadata.replaceChildren(
    makeElement('span', `status-pill ${statusClass(displayStatus)}`, formatStatus(displayStatus)),
    makeElement('span', 'report-meta', `Type: ${reportTypeLabel(insight)}`),
    makeElement('span', 'report-meta', `Submitted: ${new Date(insight.created_at).toLocaleString()}`),
    makeElement('span', 'report-meta', insight.is_anonymous ? 'Submitted anonymously' : `Submitted by ${insight.sender_label}`),
  );
  renderStatusComment(document.querySelector('#report-detail-status-comment'), insight);
  document.querySelector('#report-detail-content').textContent = insight.content;
  document.querySelector('#report-detail-messages').href = `/inbox?report=${encodeURIComponent(insight.id)}`;
  reportDetailDialog.showModal();
}

function renderReportPagination(totalPages, totalReports) {
  if (!reportPagination) return;
  if (totalReports <= reportsPerPage) {
    reportPagination.hidden = true;
    reportPagination.replaceChildren();
    return;
  }
  reportPagination.hidden = false;
  const previous = makeElement('button', 'button button-outline button-small', 'Previous');
  previous.type = 'button';
  previous.disabled = currentReportPage === 1;
  previous.addEventListener('click', () => {
    currentReportPage -= 1;
    renderReports();
  });
  const status = makeElement('span', 'report-page-status', `Page ${currentReportPage} of ${totalPages}`);
  const next = makeElement('button', 'button button-outline button-small', 'Next');
  next.type = 'button';
  next.disabled = currentReportPage === totalPages;
  next.addEventListener('click', () => {
    currentReportPage += 1;
    renderReports();
  });
  reportPagination.replaceChildren(previous, status, next);
}

function renderReports() {
  if (!reportList) return;
  const query = reportSearch?.value.trim().toLocaleLowerCase() || '';
  const selectedType = reportTypeFilter?.value || '';
  const selectedStatus = reportStatusFilter?.value || '';
  const filteredReports = memberReports.filter((insight) => {
    const status = insight.status;
    const matchesFilters = (!selectedType || insight.report_type === selectedType)
      && (!selectedStatus || status === selectedStatus);
    const matchesSearch = [
      insight.tracking_id,
      reportTypeLabel(insight),
      status,
      insight.content,
      insight.is_anonymous ? 'anonymous' : insight.sender_label,
    ].some((value) => String(value || '').toLocaleLowerCase().includes(query));
    return matchesFilters && matchesSearch;
  });
  const totalPages = Math.max(1, Math.ceil(filteredReports.length / reportsPerPage));
  currentReportPage = Math.min(currentReportPage, totalPages);
  if (!filteredReports.length) {
    reportList.classList.remove('has-scroll');
    reportList.replaceChildren(makeElement(
      'p',
      'empty-state',
      query ? 'No reports match your search.' : 'No reports yet. Your first submission will appear here.',
    ));
    renderReportPagination(totalPages, 0);
    return;
  }
  const start = (currentReportPage - 1) * reportsPerPage;
  const pageReports = filteredReports.slice(start, start + reportsPerPage);
  reportList.classList.toggle('has-scroll', pageReports.length > 4);
  reportList.replaceChildren(...pageReports.map(createReportCard));
  renderReportPagination(totalPages, filteredReports.length);
}

function renderDashboardRecentReports(insights) {
  const recent = [...insights]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);
  if (!recent.length) {
    const row = document.createElement('tr');
    const cell = makeElement('td', 'dashboard-table-empty', 'No reports yet. Your first submission will appear here.');
    cell.colSpan = 3;
    row.append(cell);
    dashboardRecentReports.replaceChildren(row);
    return;
  }
  dashboardRecentReports.replaceChildren(...recent.map((insight) => {
    const row = document.createElement('tr');
    const type = makeElement('td', '', reportTypeLabel(insight));
    const tracking = makeElement('td', 'tracking-code', insight.tracking_id);
    const status = document.createElement('td');
    status.append(makeElement('span', `status-pill ${statusClass(insight.status)}`, formatStatus(insight.status)));
    row.append(type, tracking, status);
    return row;
  }));
}

async function loadDashboardRecentReports() {
  if (!dashboardRecentReports) return;
  try {
    const result = await requestApi('/api/my/insights');
    if (!Array.isArray(result.insights)) {
      throw new Error('The server returned an invalid reports list.');
    }
    renderDashboardRecentReports(
      result.insights.filter((insight) => insight.storage_type !== 'portal_insight'),
    );
  } catch (error) {
    const row = document.createElement('tr');
    const cell = makeElement('td', 'dashboard-table-empty is-error', error.message);
    cell.colSpan = 3;
    row.append(cell);
    dashboardRecentReports.replaceChildren(row);
  }
}

function createDraftCard(draft) {
  const card = makeElement('article', 'report-card');
  const top = makeElement('div', 'report-card-top');
  top.append(
    makeElement('strong', 'tracking-code', draft.report_type[0].toUpperCase() + draft.report_type.slice(1)),
    makeElement('span', 'status-pill', 'Draft'),
  );
  card.append(
    top,
    makeElement('p', 'report-preview draft-preview', draft.content || 'No details added yet.'),
    makeElement('p', 'report-meta', `Last saved ${new Date(draft.updated_at).toLocaleString()}`),
  );
  const actions = makeElement('div', 'report-actions');
  const editButton = makeElement('button', 'text-button', 'Continue draft');
  editButton.type = 'button';
  editButton.addEventListener('click', () => {
    currentDraftId = draft.id;
    reportForm.reportType.value = draft.report_type;
    reportForm.content.value = draft.content;
    reportForm.isAnonymous.checked = draft.is_anonymous;
    document.querySelector('#report-form-title').textContent = 'Continue your draft';
    saveDraftButton.textContent = 'Update draft';
    newReportButton.hidden = false;
    trackingConfirmation.hidden = true;
    reportMessage.textContent = 'Draft loaded. Save it again or submit when ready.';
    reportForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    reportForm.content.focus();
  });
  const deleteButton = makeElement('button', 'text-button danger-link', 'Delete draft');
  deleteButton.type = 'button';
  deleteButton.addEventListener('click', async () => {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    deleteButton.disabled = true;
    try {
      await requestApi(`/api/my/drafts/${encodeURIComponent(draft.id)}`, { method: 'DELETE' });
      if (currentDraftId === draft.id) resetDraftEditor();
      await loadDrafts();
    } catch (error) {
      window.alert(error.message);
      deleteButton.disabled = false;
    }
  });
  actions.append(editButton, deleteButton);
  card.append(actions);
  return card;
}

function resetDraftEditor() {
  currentDraftId = null;
  reportForm.reset();
  document.querySelector('#report-form-title').textContent = 'Share a concern';
  saveDraftButton.textContent = 'Save draft';
  newReportButton.hidden = true;
  reportMessage.textContent = '';
}

function showEditor(card, insight) {
  const dialog = document.querySelector('#report-edit-dialog');
  const form = document.querySelector('#report-edit-form');
  const type = document.querySelector('#report-edit-type');
  const content = document.querySelector('#report-edit-content');
  const anonymous = document.querySelector('#report-edit-anonymous');
  const wordCount = document.querySelector('#report-edit-word-count');
  const message = document.querySelector('#report-edit-message');
  const save = form.querySelector('button[type="submit"]');

  document.querySelector('#report-edit-title').textContent = `Edit ${insight.tracking_id}`;
  type.value = insight.report_type;
  content.value = insight.content;
  anonymous.checked = insight.is_anonymous;
  message.textContent = '';
  message.className = 'form-message';
  save.disabled = false;
  updateWordCount(content, wordCount);

  content.oninput = () => updateWordCount(content, wordCount);
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (content.value.length > maxReportCharacters) {
      message.textContent = `Report details cannot exceed ${maxReportCharacters.toLocaleString()} characters.`;
      message.className = 'form-message is-error';
      content.focus();
      return;
    }
    save.disabled = true;
    message.textContent = 'Saving changes…';
    try {
      await requestApi(`/api/my/insights/${encodeURIComponent(insight.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          content: content.value,
          reportType: type.value,
          isAnonymous: anonymous.checked,
        }),
      });
      dialog.close();
      await loadReports();
    } catch (error) {
      message.textContent = error.message;
      message.className = 'form-message is-error';
      save.disabled = false;
    }
  };
  dialog.showModal();
}

async function loadReports() {
  if (!reportList || !reportCount) return;
  reportList.replaceChildren(makeElement('p', 'empty-state', 'Loading your reports…'));
  try {
    const result = await requestApi('/api/my/insights');
    if (!Array.isArray(result.insights)) {
      throw new Error('The server returned an invalid reports list.');
    }
    memberReports = result.insights
      .filter((insight) => insight.storage_type !== 'portal_insight')
      .map((insight) => ({
        ...insight,
        status: insight.status,
      }));
    reportCount.textContent = String(memberReports.length);
    currentReportPage = 1;
    renderReports();
  } catch (error) {
    reportList.replaceChildren(makeElement('p', 'form-message is-error', error.message));
  }
}

reportSearch?.addEventListener('input', () => {
  currentReportPage = 1;
  renderReports();
});
reportTypeFilter?.addEventListener('change', () => {
  currentReportPage = 1;
  renderReports();
});
reportStatusFilter?.addEventListener('change', () => {
  currentReportPage = 1;
  renderReports();
});

document.querySelector('#close-report-detail')?.addEventListener('click', () => reportDetailDialog.close());
reportDetailDialog?.addEventListener('click', (event) => {
  if (event.target === reportDetailDialog) reportDetailDialog.close();
});
const reportEditDialog = document.querySelector('#report-edit-dialog');
document.querySelector('#close-report-edit')?.addEventListener('click', () => reportEditDialog.close());
document.querySelector('#cancel-report-edit')?.addEventListener('click', () => reportEditDialog.close());
reportEditDialog?.addEventListener('click', (event) => {
  if (event.target === reportEditDialog) reportEditDialog.close();
});

async function loadDrafts() {
  if (!draftList || !draftCount) return;
  draftList.replaceChildren(makeElement('p', 'empty-state', 'Loading your drafts…'));
  try {
    const result = await requestApi('/api/my/drafts');
    if (!Array.isArray(result.drafts)) {
      throw new Error('The server returned an invalid drafts list.');
    }
    draftCount.textContent = String(result.drafts.length);
    if (!result.drafts.length) {
      draftList.replaceChildren(makeElement('p', 'empty-state', 'No saved drafts.'));
      updateDraftListScroll();
      return;
    }
    draftList.replaceChildren(...result.drafts.map(createDraftCard));
    updateDraftListScroll();
  } catch (error) {
    draftList.replaceChildren(makeElement('p', 'form-message is-error', error.message));
    updateDraftListScroll();
  }
}

saveDraftButton?.addEventListener('click', async () => {
  if (reportContent.value.length > maxReportCharacters) {
    reportMessage.textContent = `Draft details cannot exceed ${maxReportCharacters.toLocaleString()} characters.`;
    reportMessage.className = 'form-message is-error';
    reportContent.focus();
    return;
  }
  saveDraftButton.disabled = true;
  reportMessage.textContent = 'Saving your draft…';
  reportMessage.className = 'form-message';
  try {
    const result = await requestApi('/api/my/drafts', {
      method: 'POST',
      body: JSON.stringify({
        ...(currentDraftId ? { id: currentDraftId } : {}),
        content: reportForm.content.value,
        reportType: reportForm.reportType.value,
        isAnonymous: reportForm.isAnonymous.checked,
      }),
    });
    currentDraftId = result.draft.id;
    document.querySelector('#report-form-title').textContent = 'Continue your draft';
    saveDraftButton.textContent = 'Update draft';
    newReportButton.hidden = false;
    reportMessage.textContent = 'Draft saved to your account. It has not been submitted.';
    await loadDrafts();
  } catch (error) {
    reportMessage.textContent = error.message;
    reportMessage.className = 'form-message is-error';
  } finally {
    saveDraftButton.disabled = false;
  }
});

newReportButton?.addEventListener('click', resetDraftEditor);

reportForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (reportContent.value.length > maxReportCharacters) {
    reportMessage.textContent = `Report details cannot exceed ${maxReportCharacters.toLocaleString()} characters.`;
    reportMessage.className = 'form-message is-error';
    reportContent.focus();
    return;
  }
  const submitButton = reportForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  reportMessage.textContent = 'Submitting your report…';
  reportMessage.className = 'form-message';
  trackingConfirmation.hidden = true;
  try {
    const result = await requestApi('/api/insights', {
      method: 'POST',
      body: JSON.stringify({
        content: reportForm.content.value,
        reportType: reportForm.reportType.value,
        isAnonymous: reportForm.isAnonymous.checked,
        ...(currentDraftId ? { draftId: currentDraftId } : {}),
      }),
    });
    const tracking = makeElement('strong', 'tracking-code', result.insight.tracking_id);
    const copy = makeElement('p', '', 'Your report was saved. Keep this tracking number to check its status.');
    trackingConfirmation.replaceChildren(copy, tracking);
    trackingConfirmation.hidden = false;
    resetDraftEditor();
    reportMessage.textContent = '';
    await loadReports();
    await loadDrafts();
  } catch (error) {
    reportMessage.textContent = error.message;
    reportMessage.classList.add('is-error');
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#logout-button')?.addEventListener('click', async () => {
  try {
    await requestApi('/api/auth/logout', { method: 'POST' });
    window.bosesNavigate('/');
  } catch (error) {
    window.alert(error.message);
  }
});

requestApi('/api/me')
  .then((session) => {
    const memberEmail = document.querySelector('#member-email');
    if (memberEmail) memberEmail.textContent = session.email;
  })
  .catch((error) => {
    const memberEmail = document.querySelector('#member-email');
    if (memberEmail) memberEmail.textContent = error.message;
  });
if (reportList) loadReports();
if (draftList) loadDrafts();
if (dashboardRecentReports) loadDashboardRecentReports();
reportContent?.addEventListener('input', () => updateWordCount(reportContent, reportWordCount));
if (reportContent) updateWordCount(reportContent, reportWordCount);
window.addEventListener('resize', updateDraftListScroll);