const senderTableBody = document.querySelector('#sender-table-body');
const senderTableWrap = document.querySelector('#sender-table-wrap');
const senderMessage = document.querySelector('#sender-message');
let senders = [];
let currentRole = 'admin';
let currentPage = 1;
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

async function updateSender(sender, action, value, button) {
  button.disabled = true;
  try {
    if (action === 'messages') {
      await api(`/api/admin/senders/${encodeURIComponent(sender.sender_id)}/messages`, {
        method: 'PATCH',
        body: JSON.stringify({ restricted: value }),
      });
    } else {
      await api(`/api/admin/senders/${encodeURIComponent(sender.sender_id)}/ban`, {
        method: 'PATCH',
        body: JSON.stringify({ banned: value }),
      });
    }
    await loadSenders();
    senderMessage.textContent = action === 'messages'
      ? (value ? 'Messaging restricted for this sender across all reports.' : 'Messaging restored for this sender.')
      : (value ? 'Member access banned for this sender.' : 'Member access restored for this sender.');
    senderMessage.className = 'form-message';
  } catch (error) {
    senderMessage.textContent = error.message;
    senderMessage.className = 'form-message is-error';
    button.disabled = false;
  }
}

function renderSenders() {
  const query = document.querySelector('#sender-search').value.trim().toLowerCase();
  const submissionType = document.querySelector('#sender-type-filter').value;
  const visible = senders.filter((sender) => (
    (submissionType === 'all'
      || (submissionType === 'anonymous' && sender.has_anonymous_reports)
      || (submissionType === 'identified' && !sender.has_anonymous_reports))
    && (
      (sender.has_anonymous_reports && sender.sender_id.toLowerCase().includes(query))
      || (!sender.has_anonymous_reports && (sender.sender_email || '').toLowerCase().includes(query))
      || (sender.has_anonymous_reports && 'anonymous submissions'.includes(query))
    )
  ));
  const pageCount = Math.ceil(visible.length / pageSize);
  currentPage = Math.min(currentPage, Math.max(pageCount, 1));
  const start = (currentPage - 1) * pageSize;
  const pageSenders = visible.slice(start, start + pageSize);
  const pagination = document.querySelector('#sender-pagination');
  pagination.hidden = visible.length <= pageSize;
  document.querySelector('#sender-page-status').textContent = (
    `Page ${currentPage} of ${pageCount} · ${start + 1}–${Math.min(start + pageSize, visible.length)} of ${visible.length}`
  );
  document.querySelector('#sender-previous-page').disabled = currentPage <= 1;
  document.querySelector('#sender-next-page').disabled = currentPage >= pageCount;
  senderTableWrap.classList.toggle('is-scrollable', visible.length > 6);
  if (!visible.length) {
    senderTableBody.replaceChildren();
    const row = document.createElement('tr');
    row.append(element('td', 'empty-state', senders.length ? 'No senders match this search.' : 'No senders found.'));
    row.firstElementChild.colSpan = 6;
    senderTableBody.append(row);
    return;
  }

  senderTableBody.replaceChildren(...pageSenders.map((sender) => {
    const row = document.createElement('tr');
    row.append(
      element('td', 'sender-id-cell', sender.has_anonymous_reports ? sender.sender_id : '—'),
      element(
        'td',
        '',
        sender.has_anonymous_reports ? 'Anonymous submissions' : sender.sender_email || 'Email unavailable',
      ),
      element('td', '', `${sender.report_count} total · ${sender.active_report_count} active · ${sender.archived_report_count} archived`),
      element('td', '', sender.is_message_restricted ? 'Restricted' : 'Allowed'),
      element('td', '', sender.is_banned ? 'Banned' : 'Active'),
    );
    const actions = element('div', 'table-actions');
    const restrictButton = element(
      'button',
      `button button-small${sender.is_message_restricted ? ' button-muted' : ''}`,
      sender.is_message_restricted ? 'Unrestrict messages' : 'Restrict messages',
    );
    restrictButton.type = 'button';
    restrictButton.addEventListener('click', () => updateSender(
      sender,
      'messages',
      !sender.is_message_restricted,
      restrictButton,
    ));
    actions.append(restrictButton);
    if (currentRole === 'superadmin') {
      const banButton = element(
        'button',
        `button button-small${sender.is_banned ? ' button-muted' : ' button-danger'}`,
        sender.is_banned ? 'Unban member' : 'Ban member',
      );
      banButton.type = 'button';
      banButton.addEventListener('click', () => {
        const verb = sender.is_banned ? 'restore member access for' : 'ban';
        if (window.confirm(`Are you sure you want to ${verb} ${sender.sender_id}?`)) {
          updateSender(sender, 'ban', !sender.is_banned, banButton);
        }
      });
      actions.append(banButton);
    } else {
      actions.append(element('span', 'report-meta', 'Ban controls: superadmin'));
    }
    const actionsCell = document.createElement('td');
    actionsCell.append(actions);
    row.append(actionsCell);
    return row;
  }));
}

async function loadSenders() {
  currentPage = 1;
  senderTableWrap.classList.remove('is-scrollable');
  document.querySelector('#sender-pagination').hidden = true;
  senderTableBody.replaceChildren();
  const loadingRow = document.createElement('tr');
  loadingRow.append(element('td', 'empty-state', 'Loading senders…'));
  loadingRow.firstElementChild.colSpan = 6;
  senderTableBody.append(loadingRow);
  try {
    const result = await api('/api/admin/senders');
    if (!Array.isArray(result.senders)) throw new Error('The server returned an invalid sender list.');
    senders = result.senders;
    renderSenders();
  } catch (error) {
    senderTableBody.replaceChildren();
    const errorRow = document.createElement('tr');
    errorRow.append(element('td', 'form-message is-error', error.message));
    errorRow.firstElementChild.colSpan = 6;
    senderTableBody.append(errorRow);
  }
}

function resetSenderPage() {
  currentPage = 1;
  renderSenders();
}

document.querySelector('#sender-search').addEventListener('input', resetSenderPage);
document.querySelector('#sender-type-filter').addEventListener('change', resetSenderPage);
document.querySelector('#sender-previous-page').addEventListener('click', () => {
  currentPage -= 1;
  renderSenders();
});
document.querySelector('#sender-next-page').addEventListener('click', () => {
  currentPage += 1;
  renderSenders();
});
document.querySelector('#refresh-button').addEventListener('click', loadSenders);
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
    currentRole = session.role;
    document.querySelector('#officer-name').textContent = session.name || session.email;
    document.querySelector('#officer-email').textContent = session.email;
    document.querySelector('#access-role').textContent = currentRole === 'superadmin' ? 'Superadmin' : 'Admin';
    for (const id of ['archive-link', 'sender-tags-link', 'officer-access-link', 'privacy-link']) {
      document.querySelector(`#${id}`).hidden = currentRole !== 'superadmin';
    }
    await loadSenders();
  } catch (error) {
    senderTableBody.replaceChildren();
    const errorRow = document.createElement('tr');
    errorRow.append(element('td', 'form-message is-error', error.message));
    errorRow.firstElementChild.colSpan = 6;
    senderTableBody.append(errorRow);
  }
}

initialize();
