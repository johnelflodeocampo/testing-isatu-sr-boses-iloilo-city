const archiveList = document.querySelector('#archive-report-list');
const archiveMessage = document.querySelector('#archive-message');
const archiveDialog = document.querySelector('#archive-detail-dialog');
const rolloverDialog = document.querySelector('#archive-rollover-dialog');
let archivedReports = [];
let currentPage = 1;
let activeReport = null;
const pageSize = 8;

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
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (response.status === 404) {
      throw new Error('The archive export route is unavailable. Restart the server to load the latest changes, then try again.');
    }
    throw new Error(`The server returned an unexpected response (HTTP ${response.status}). Please try again or contact an administrator.`);
  }
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
  if (status === 'not_implemented') return 'Not Implemented';
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status) {
  return `status-${status.replaceAll('_', '-')}`;
}

function reportEndpoint(insight) {
  return insight.storage_type === 'portal_insight'
    ? '/api/admin/portal-insights'
    : '/api/admin/insights';
}

function reportTypeLabel(insight) {
  if (insight.report_type === 'concern') return 'Concern';
  return insight.storage_type === 'portal_insight' ? 'Portal Insights' : 'Feedback';
}

function displaySenderLabel(insight) {
  return insight.sender_label || 'Unavailable';
}

function pdfSafeText(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

function wrapPdfText(value, maxLength = 96) {
  const safeText = pdfSafeText(value);
  if (!safeText) return [''];
  const wrapped = [];
  for (const paragraph of safeText.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (word.length > maxLength) {
        if (line) wrapped.push(line);
        line = '';
        for (let index = 0; index < word.length; index += maxLength) {
          const part = word.slice(index, index + maxLength);
          if (part.length === maxLength) wrapped.push(part);
          else line = part;
        }
      } else if (!line) {
        line = word;
      } else if (line.length + word.length + 1 <= maxLength) {
        line += ` ${word}`;
      } else {
        wrapped.push(line);
        line = word;
      }
    }
    wrapped.push(line);
  }
  return wrapped;
}

function createPdf(insight) {
  const colors = {
    navy: '0.067 0.102 0.180',
    gold: '0.839 0.569 0.094',
    ink: '0.125 0.169 0.239',
    muted: '0.420 0.475 0.553',
    line: '0.847 0.875 0.910',
    paper: '0.973 0.980 0.992',
    white: '1 1 1',
  };
  const pages = [];
  const pageWidth = 612;
  const pageHeight = 792;
  const left = 44;
  const right = 568;
  const contentWidth = right - left;

  function text(commands, x, top, value, size, color, bold = false) {
    const font = bold ? 'F2' : 'F1';
    const baseline = pageHeight - top - size;
    const safeText = pdfSafeText(value).replace(/[\\()]/g, '\\$&');
    commands.push(`BT /${font} ${size} Tf ${color} rg 1 0 0 1 ${x} ${baseline} Tm (${safeText}) Tj ET`);
  }

  function rectangle(commands, x, top, width, height, fill, stroke) {
    const y = pageHeight - top - height;
    commands.push(`${fill} rg ${stroke} RG 1 w ${x} ${y} ${width} ${height} re B`);
  }

  function circle(commands, centerX, topCenter, radius, fill, stroke) {
    const centerY = pageHeight - topCenter;
    const curve = radius * 0.5522848;
    commands.push(
      `${fill} rg ${stroke} RG 1.5 w ${centerX + radius} ${centerY} m `
      + `${centerX + radius} ${centerY + curve} ${centerX + curve} ${centerY + radius} ${centerX} ${centerY + radius} c `
      + `${centerX - curve} ${centerY + radius} ${centerX - radius} ${centerY + curve} ${centerX - radius} ${centerY} c `
      + `${centerX - radius} ${centerY - curve} ${centerX - curve} ${centerY - radius} ${centerX} ${centerY - radius} c `
      + `${centerX + curve} ${centerY - radius} ${centerX + radius} ${centerY - curve} ${centerX + radius} ${centerY} c h B`,
    );
  }

  function line(commands, x1, top1, x2, top2, color, width = 1) {
    commands.push(`${color} RG ${width} w ${x1} ${pageHeight - top1} m ${x2} ${pageHeight - top2} l S`);
  }

  function addHeader(commands, firstPage) {
    if (firstPage) {
      rectangle(commands, left, 30, contentWidth, 126, colors.navy, colors.navy);
      rectangle(commands, left, 30, contentWidth, 5, colors.gold, colors.gold);
      circle(commands, 87, 84, 26, '0.976 0.961 0.914', colors.gold);
      circle(commands, 87, 84, 22, '0.976 0.961 0.914', colors.white);
      text(commands, 80, 74, 'IS', 15, colors.navy, true);
      text(commands, 128, 52, 'ILOILO SCIENCE AND TECHNOLOGY UNIVERSITY', 8, '0.91 0.94 0.98', true);
      text(commands, 128, 67, 'ILOILO CITY CAMPUS  |  STUDENT REPUBLIC', 8, '0.91 0.94 0.98');
      text(commands, 128, 87, 'ISAT U BOSES', 19, colors.white, true);
      text(commands, 128, 116, 'OFFICIAL FEEDBACK & CONCERN REPORT', 9, '0.96 0.73 0.34', true);
      rectangle(commands, 450, 49, 96, 22, colors.gold, colors.gold);
      text(commands, 462, 55, 'ARCHIVE COPY', 8, colors.navy, true);
      text(commands, 450, 87, 'REFERENCE NO.', 7, '0.76 0.81 0.88', true);
      text(commands, 450, 101, insight.tracking_id, 9, colors.white, true);
    } else {
      rectangle(commands, left, 30, contentWidth, 79, colors.navy, colors.navy);
      rectangle(commands, left, 30, contentWidth, 4, colors.gold, colors.gold);
      text(commands, 61, 48, 'ISAT U BOSES  |  STUDENT REPUBLIC', 12, colors.white, true);
      text(commands, 61, 69, 'OFFICIAL FEEDBACK & CONCERN REPORT  -  CONTINUED', 8, '0.96 0.73 0.34', true);
      text(commands, 415, 55, 'REFERENCE NO.', 7, '0.76 0.81 0.88', true);
      text(commands, 415, 69, insight.tracking_id, 9, colors.white, true);
    }
  }

  function addFooter(commands, pageNumber) {
    line(commands, left, 752, right, 752, colors.line, 0.8);
    text(commands, left, 762, 'OFFICIAL RECORD  |  Handle in accordance with portal privacy practices.', 7, colors.muted);
    text(commands, 458, 762, `PAGE ${pageNumber}`, 7, colors.muted, true);
  }

  function beginPage(firstPage) {
    const commands = [];
    addHeader(commands, firstPage);
    pages.push(commands);
    return commands;
  }

  let commands = beginPage(true);
  text(commands, left, 171, '01  REPORT SUMMARY', 9, colors.navy, true);
  line(commands, left, 188, right, 188, colors.gold, 1.5);

  const isConcern = insight.report_type === 'concern';
  const fields = [
    ['REPORT TYPE', isConcern ? 'Concern' : 'Portal Insights'],
    ['CURRENT STATUS', formatStatus(insight.status)],
    ['DATE SUBMITTED', new Date(insight.created_at).toLocaleString()],
    ['LAST UPDATED', new Date(insight.updated_at).toLocaleString()],
    ['SUBMITTER', insight.is_anonymous ? 'Anonymous' : displaySenderLabel(insight)],
    ...(isConcern ? [
      ['PRIORITY', formatStatus(insight.priority || 'Not set')],
      ['ASSIGNED OFFICER', insight.assigned_admin || 'Unassigned'],
    ] : []),
  ];
  const fieldWidth = (contentWidth - 10) / 2;
  const fieldHeight = 39;
  const fieldGap = 7;
  const summaryTop = 198;
  for (let index = 0; index < fields.length; index += 1) {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = left + column * (fieldWidth + 10);
    const y = summaryTop + row * (fieldHeight + fieldGap);
    rectangle(commands, x, y, fieldWidth, fieldHeight, colors.paper, colors.line);
    text(commands, x + 10, y + 6, fields[index][0], 6.5, colors.muted, true);
    const valueLines = wrapPdfText(fields[index][1], 48);
    if (valueLines.length > 2) valueLines[1] = `${valueLines[1].slice(0, 45)}...`;
    valueLines.slice(0, 2).forEach((valueLine, valueLineIndex) => {
      text(commands, x + 10, y + 17 + valueLineIndex * 10, valueLine, 8, colors.ink, true);
    });
  }

  const rowCount = Math.ceil(fields.length / 2);
  const contentHeadingTop = summaryTop + rowCount * (fieldHeight + fieldGap) + 10;
  text(commands, left, contentHeadingTop, '02  SUBMISSION DETAILS', 9, colors.navy, true);
  line(commands, left, contentHeadingTop + 17, right, contentHeadingTop + 17, colors.gold, 1.5);
  const boxTop = contentHeadingTop + 26;
  const narrativeBottom = 740;
  let narrativeLines = String(insight.content || '').split(/\r?\n/).flatMap((lineText) => wrapPdfText(lineText));
  if (!narrativeLines.length) narrativeLines = [''];

  let firstNarrativePage = true;
  while (narrativeLines.length) {
    const activeCommands = firstNarrativePage ? commands : beginPage(false);
    const activeBoxTop = firstNarrativePage ? boxTop : 151;
    const activeNarrativeTop = activeBoxTop + 22;
    const availableLines = Math.max(1, Math.floor((narrativeBottom - activeNarrativeTop) / 14));
    const linesForPage = narrativeLines.splice(0, availableLines);
    rectangle(activeCommands, left, activeBoxTop, contentWidth, narrativeBottom - activeBoxTop, colors.white, colors.line);
    if (!firstNarrativePage) {
      text(activeCommands, left + 12, activeBoxTop + 7, 'SUBMISSION DETAILS  -  CONTINUED', 7, colors.muted, true);
    }
    linesForPage.forEach((lineText, index) => {
      text(activeCommands, left + 12, activeNarrativeTop + index * 14, lineText, 9, colors.ink);
    });
    firstNarrativePage = false;
  }

  pages.forEach((pageCommands, index) => addFooter(pageCommands, index + 1));

  const pageObjectNumbers = pages.map((_, index) => 5 + index * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];

  for (let index = 0; index < pages.length; index += 1) {
    const pageObjectNumber = pageObjectNumbers[index];
    const contentObjectNumber = pageObjectNumber + 1;
    const pageContent = pages[index].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      `<< /Length ${pageContent.length} >>\nstream\n${pageContent}\nendstream`,
    );
  }

  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return document;
}

function updateRestoreStatusOptions(insight) {
  const statusSelect = document.querySelector('#archive-restore-status');
  const statuses = insight.report_type === 'concern'
    ? ['pending', 'reviewing', 'in_progress', 'resolved', 'dismissed']
    : ['pending', 'under_review', 'in_progress', 'implemented', 'not_implemented', 'resolved'];
  statusSelect.replaceChildren(...statuses.map((status) => {
    const option = element('option', '', formatStatus(status));
    option.value = status;
    return option;
  }));
  statusSelect.value = 'pending';
  document.querySelector('#archive-restore-comment').value = '';
  updateRestoreCommentVisibility();
  document.querySelector('#restore-archived-report').textContent = 'Restore to Pending';
}

function updateRestoreCommentVisibility() {
  const status = document.querySelector('#archive-restore-status').value;
  const insight = activeReport;
  const supportsComment = insight?.report_type === 'concern'
    ? ['resolved', 'dismissed'].includes(status)
    : ['implemented', 'not_implemented'].includes(status);
  if (!supportsComment) document.querySelector('#archive-restore-comment').value = '';
  document.querySelector('#archive-restore-comment-label').hidden = !supportsComment;
  document.querySelector('#archive-restore-comment').hidden = !supportsComment;
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

function showReportDetails(insight) {
  activeReport = insight;
  const isConcern = insight.report_type === 'concern';
  updateRestoreStatusOptions(insight);
  document.querySelector('#archive-detail-title').textContent = insight.tracking_id;
  document.querySelector('#archive-detail-meta').replaceChildren(
    element('span', `status-pill ${statusClass(insight.status)}`, formatStatus(insight.status)),
    element('span', 'report-meta', reportTypeLabel(insight)),
    element('span', 'report-meta', `Submitted ${new Date(insight.created_at).toLocaleString()}`),
    element(
      'span',
      'report-meta',
      insight.is_anonymous ? 'Anonymous submission' : `Submitter: ${displaySenderLabel(insight)}`,
    ),
    ...(isConcern ? [
      element('span', 'report-meta', `Priority: ${insight.priority}`),
      element('span', 'report-meta', insight.assigned_admin ? `Assigned admin: ${insight.assigned_admin}` : 'Unassigned'),
    ] : []),
    element('span', 'report-meta', `Last updated ${new Date(insight.updated_at).toLocaleString()}`),
  );
  renderStatusComment(document.querySelector('#archive-detail-status-comment'), insight);
  document.querySelector('#archive-detail-content').textContent = insight.content;
  archiveDialog.showModal();
}

function downloadReport() {
  if (!activeReport) return;
  const insight = activeReport;
  const file = new Blob([window.BosesReportPdf.create(insight)], { type: 'application/pdf' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = window.BosesReportPdf.filename(insight);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadReportJson(insight, button) {
  button.disabled = true;
  try {
    const result = await api(`/api/admin/archive/${encodeURIComponent(insight.id)}/export`);
    if (!result.report || result.report.id !== insight.id || !Array.isArray(result.report.messages)) {
      throw new Error('The server returned an invalid report export.');
    }
    const backup = {
      format: 'ISAT U BOSES archived report',
      version: 1,
      exportedAt: new Date().toISOString(),
      report: result.report,
    };
    const file = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `isatu-boses-${insight.tracking_id}-archive.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    archiveMessage.textContent = `Downloaded JSON data and messages for ${insight.tracking_id}.`;
    archiveMessage.className = 'form-message';
  } catch (error) {
    archiveMessage.textContent = error.message;
    archiveMessage.className = 'form-message is-error';
  } finally {
    button.disabled = false;
  }
}

async function deleteReport() {
  if (!activeReport) return;
  const insight = activeReport;
  if (!window.confirm(`Permanently delete archived report ${insight.tracking_id} and its messages? This cannot be undone.`)) return;
  const button = document.querySelector('#delete-archived-report');
  button.disabled = true;
  try {
    await api(`${reportEndpoint(insight)}/${encodeURIComponent(insight.id)}`, { method: 'DELETE' });
    archiveDialog.close();
    activeReport = null;
    await loadArchive();
    archiveMessage.textContent = `Archived report ${insight.tracking_id} and its messages were permanently deleted.`;
    archiveMessage.className = 'form-message';
  } catch (error) {
    archiveMessage.textContent = error.message;
    archiveMessage.className = 'form-message is-error';
  } finally {
    button.disabled = false;
  }
}

async function runArchiveRollover(event) {
  event.preventDefault();
  const confirmation = document.querySelector('#archive-rollover-confirmation');
  const dialogMessage = document.querySelector('#archive-rollover-dialog-message');
  if (confirmation.value !== 'DELETE ALL ARCHIVED REPORTS') {
    dialogMessage.textContent = 'Type the confirmation phrase exactly as shown.';
    dialogMessage.className = 'form-message is-error';
    confirmation.focus();
    return;
  }
  if (!archivedReports.length) {
    dialogMessage.textContent = 'There are no archived reports to back up or delete.';
    dialogMessage.className = 'form-message';
    return;
  }

  const button = document.querySelector('#confirm-archive-rollover');
  const startButton = document.querySelector('#start-archive-rollover');
  button.disabled = true;
  startButton.disabled = true;
  dialogMessage.textContent = 'Preparing the JSON backup…';
  dialogMessage.className = 'form-message';
  try {
    const result = await api('/api/admin/archive/rollover');
    if (!Array.isArray(result.reports)) {
      throw new Error('The server returned an invalid archive export.');
    }
    if (!result.reports.length || result.reports.some((report) => !report.id || !Array.isArray(report.messages))
      || new Set(result.reports.map((report) => report.id)).size !== result.reports.length
      || typeof result.rolloverToken !== 'string'
      || !/^[0-9a-f]{64}$/i.test(result.rolloverToken)) {
      throw new Error('The server returned an empty or invalid archive backup. Nothing was deleted.');
    }
    const backup = {
      format: 'ISAT U BOSES archived reports',
      version: 1,
      exportedAt: new Date().toISOString(),
      reportCount: result.reports.length,
      rolloverToken: result.rolloverToken,
      reports: result.reports,
    };
    const file = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `isatu-boses-archive-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    dialogMessage.textContent = 'Backup download started. Deleting the backed-up reports…';
    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    const deletion = await api('/api/admin/archive/rollover', {
      method: 'DELETE',
      body: JSON.stringify({ rolloverToken: result.rolloverToken }),
    });
    if (deletion.deletedReports !== result.reports.length
      || !Number.isInteger(deletion.deletedMessages)
      || !Number.isInteger(deletion.remainingReports)) {
      throw new Error('The server returned an invalid deletion result. Refresh the archive to verify its current state.');
    }
    rolloverDialog.close();
    await loadArchive();
    archiveMessage.textContent = `Downloaded the backup, then permanently deleted ${deletion.deletedReports} archived ${deletion.deletedReports === 1 ? 'report' : 'reports'} and ${deletion.deletedMessages} ${deletion.deletedMessages === 1 ? 'message' : 'messages'}.${deletion.remainingReports ? ` ${deletion.remainingReports} newer archived ${deletion.remainingReports === 1 ? 'report remains' : 'reports remain'}; run rollover again to back them up.` : ''}`;
    archiveMessage.className = 'form-message';
  } catch (error) {
    dialogMessage.textContent = error.message;
    dialogMessage.className = 'form-message is-error';
  } finally {
    button.disabled = false;
    startButton.disabled = false;
  }
}

function openArchiveRollover() {
  const confirmation = document.querySelector('#archive-rollover-confirmation');
  const dialogMessage = document.querySelector('#archive-rollover-dialog-message');
  confirmation.value = '';
  dialogMessage.textContent = '';
  dialogMessage.className = 'form-message';
  if (!archivedReports.length) {
    archiveMessage.textContent = 'There are no archived reports to back up or delete.';
    archiveMessage.className = 'form-message';
    return;
  }
  rolloverDialog.showModal();
  confirmation.focus();
}

function renderReport(insight) {
  const isConcern = insight.report_type === 'concern';
  const type = reportTypeLabel(insight);
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
    `${insight.is_anonymous ? 'Anonymous' : `Identified · ${displaySenderLabel(insight)}`} · ${new Date(insight.created_at).toLocaleDateString()}`,
  );
  const viewButton = element('button', 'text-button report-view-button', 'View report details');
  viewButton.type = 'button';
  viewButton.addEventListener('click', () => showReportDetails(insight));
  const jsonButton = element('button', 'button button-small button-muted', 'Download JSON');
  jsonButton.type = 'button';
  jsonButton.addEventListener('click', () => downloadReportJson(insight, jsonButton));
  const actions = element('div', 'report-actions');
  actions.append(viewButton, jsonButton);
  card.append(
    header,
    element('p', 'report-meta report-type-label', type),
    summary,
  );
  if (isConcern) {
    card.append(element(
      'p',
      'report-meta',
      insight.assigned_admin ? `Assigned to ${insight.assigned_admin}` : 'Unassigned concern',
    ));
  }
  card.append(actions);
  return card;
}

function showEmptyList(message, className = 'empty-state') {
  archiveList.replaceChildren(element('p', className, message));
}

function renderArchive() {
  const query = document.querySelector('#archive-search-input').value.trim().toLowerCase();
  const reportType = document.querySelector('#archive-type-filter').value;
  const status = document.querySelector('#archive-status-filter').value;
  const filtered = archivedReports.filter((insight) => {
    const insightType = insight.storage_type === 'portal_insight'
      ? 'portal_insight'
      : insight.report_type;
    const matchesType = reportType === 'all' || insightType === reportType;
    const matchesStatus = status === 'all' || insight.status === status;
    const searchable = `${insight.tracking_id} ${reportTypeLabel(insight)} ${insight.status} ${insight.content} ${insight.sender_label || ''}`.toLowerCase();
    return matchesType && matchesStatus && searchable.includes(query);
  });
  const pageCount = Math.ceil(filtered.length / pageSize);
  currentPage = Math.min(currentPage, Math.max(pageCount, 1));
  const start = (currentPage - 1) * pageSize;
  const visible = filtered.slice(start, start + pageSize);
  const pagination = document.querySelector('#archive-pagination');
  pagination.hidden = filtered.length <= pageSize;
  document.querySelector('#archive-page-status').textContent = (
    `Page ${currentPage} of ${pageCount} · ${start + 1}–${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`
  );
  document.querySelector('#archive-previous-page').disabled = currentPage <= 1;
  document.querySelector('#archive-next-page').disabled = currentPage >= pageCount;
  archiveList.classList.toggle('has-scroll', filtered.length > 6);

  if (!filtered.length) {
    showEmptyList(archivedReports.length ? 'No archived reports match this view.' : 'No archived reports.');
    return;
  }
  archiveList.replaceChildren(...visible.map(renderReport));
}

async function restoreReport() {
  if (!activeReport) return;
  const insight = activeReport;
  const status = document.querySelector('#archive-restore-status').value;
  const button = document.querySelector('#restore-archived-report');
  const formattedStatus = formatStatus(status);
  if (!window.confirm(`Restore ${insight.tracking_id} to ${formattedStatus}? It will return to active submissions.`)) return;
  button.disabled = true;
  try {
    const result = await api(`${reportEndpoint(insight)}/${encodeURIComponent(insight.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        statusComment: document.querySelector('#archive-restore-comment').value.trim() || null,
      }),
    });
    archiveDialog.close();
    activeReport = null;
    await loadArchive();
    archiveMessage.textContent = `Report restored to ${formattedStatus}.`;
    archiveMessage.className = 'form-message';
  } catch (error) {
    archiveMessage.textContent = error.message;
    archiveMessage.className = 'form-message is-error';
  } finally {
    button.disabled = false;
  }
}

async function loadArchive() {
  document.querySelector('#archive-pagination').hidden = true;
  archiveList.classList.remove('has-scroll');
  showEmptyList('Loading archive…');
  try {
    const [result, portalResult] = await Promise.all([
      api('/api/admin/insights'),
      api('/api/admin/portal-insights'),
    ]);
    if (!Array.isArray(result.archived) || !Array.isArray(portalResult.archived)) {
      throw new Error('The server returned an invalid archive list.');
    }
    archivedReports = [...result.archived, ...portalResult.archived];
    currentPage = 1;
    renderArchive();
  } catch (error) {
    archivedReports = [];
    showEmptyList(error.message, 'form-message is-error');
  }
}

function resetPageAndRender() {
  currentPage = 1;
  renderArchive();
}

document.querySelector('#archive-search-input').addEventListener('input', resetPageAndRender);
document.querySelector('#archive-type-filter').addEventListener('change', resetPageAndRender);
document.querySelector('#archive-status-filter').addEventListener('change', resetPageAndRender);
document.querySelector('#archive-previous-page').addEventListener('click', () => {
  currentPage -= 1;
  renderArchive();
});
document.querySelector('#archive-next-page').addEventListener('click', () => {
  currentPage += 1;
  renderArchive();
});
document.querySelector('#archive-restore-status').addEventListener('change', (event) => {
  document.querySelector('#restore-archived-report').textContent = `Restore to ${formatStatus(event.currentTarget.value)}`;
  updateRestoreCommentVisibility();
});
document.querySelector('#restore-archived-report').addEventListener('click', restoreReport);
document.querySelector('#download-archived-report').addEventListener('click', downloadReport);
document.querySelector('#delete-archived-report').addEventListener('click', deleteReport);
document.querySelector('#start-archive-rollover').addEventListener('click', openArchiveRollover);
document.querySelector('#archive-rollover-form').addEventListener('submit', runArchiveRollover);
document.querySelector('#cancel-archive-rollover').addEventListener('click', () => rolloverDialog.close());
document.querySelector('#close-archive-rollover').addEventListener('click', () => rolloverDialog.close());
rolloverDialog.addEventListener('click', (event) => {
  if (event.target === rolloverDialog) rolloverDialog.close();
});
document.querySelector('.archive-rollover-phrase').addEventListener('contextmenu', (event) => event.preventDefault());
document.querySelector('.archive-rollover-phrase').addEventListener('copy', (event) => event.preventDefault());
document.querySelector('.archive-rollover-phrase').addEventListener('cut', (event) => event.preventDefault());
document.querySelector('.archive-rollover-phrase').addEventListener('selectstart', (event) => event.preventDefault());
document.querySelector('.archive-rollover-phrase').addEventListener('dragstart', (event) => event.preventDefault());
const rolloverConfirmation = document.querySelector('#archive-rollover-confirmation');
rolloverConfirmation.addEventListener('paste', (event) => event.preventDefault());
rolloverConfirmation.addEventListener('drop', (event) => event.preventDefault());
document.querySelector('#close-archive-detail').addEventListener('click', () => archiveDialog.close());
archiveDialog.addEventListener('click', (event) => {
  if (event.target === archiveDialog) archiveDialog.close();
});
document.querySelector('#refresh-button').addEventListener('click', loadArchive);
document.querySelector('#logout-button').addEventListener('click', async () => {
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
    document.querySelector('#officer-name').textContent = session.name || session.email;
    document.querySelector('#officer-email').textContent = session.email;
    document.querySelector('#access-role').textContent = session.role === 'superadmin' ? 'Superadmin' : 'Admin';
    for (const id of ['archive-link', 'sender-tags-link', 'officer-access-link', 'privacy-link']) {
      document.querySelector(`#${id}`).hidden = session.role !== 'superadmin';
    }
    await loadArchive();
  } catch (error) {
    showEmptyList(error.message, 'form-message is-error');
  }
}

initialize();
