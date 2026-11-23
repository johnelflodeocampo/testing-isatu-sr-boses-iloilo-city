const officerAccessList = document.querySelector('#officer-access-list');
const officerTableWrap = document.querySelector('#officer-table-wrap');
const accessMessage = document.querySelector('#access-message');
const accessDialog = document.querySelector('#officer-access-dialog');
const accessForm = document.querySelector('#admin-access-form');
let admins = [];
let currentRole = 'superadmin';
let currentEmail = '';
let currentName = '';
let currentPage = 1;
let editingAdmin = null;
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

function showAccessDialog(admin = null) {
  editingAdmin = admin;
  accessForm.reset();
  document.querySelector('#officer-access-dialog-title').textContent = admin
    ? 'Update officer access'
    : 'Add officer';
  document.querySelector('#save-officer-access').textContent = admin
    ? 'Save changes'
    : 'Add access';
  document.querySelector('#access-name').value = admin?.name || '';
  document.querySelector('#access-email').value = admin?.email || '';
  document.querySelector('#access-role').value = admin?.role || 'admin';
  accessDialog.showModal();
}

function showEmptyTable(message) {
  officerAccessList.replaceChildren();
  const row = document.createElement('tr');
  row.append(element('td', 'empty-state', message));
  row.firstElementChild.colSpan = 6;
  officerAccessList.append(row);
}

async function removeOfficer(admin, button) {
  if (!window.confirm(`Remove officer access for ${admin.email}? Any concerns assigned to this officer will become unassigned.`)) return;
  button.disabled = true;
  try {
    const result = await api(`/api/superadmin/admins/${encodeURIComponent(admin.email)}`, { method: 'DELETE' });
    if (admin.email === currentEmail) {
      window.bosesNavigate('/admin/login');
      return;
    }
    const unassignedConcerns = result.unassignedConcerns || 0;
    accessMessage.textContent = `Removed officer access for ${admin.email}. ${unassignedConcerns} assigned ${unassignedConcerns === 1 ? 'concern is' : 'concerns are'} now unassigned.`;
    accessMessage.className = 'form-message';
    await loadOfficerAccess();
  } catch (error) {
    accessMessage.textContent = error.message;
    accessMessage.className = 'form-message is-error';
    button.disabled = false;
  }
}

function renderOfficerAccess() {
  const query = document.querySelector('#officer-search').value.trim().toLowerCase();
  const selectedRole = document.querySelector('#officer-role-filter').value;
  const visible = admins.filter((admin) => (
    (selectedRole === 'all' || admin.role === selectedRole)
    && (
      (admin.name || '').toLowerCase().includes(query)
      || admin.email.toLowerCase().includes(query)
    )
  ));
  const pageCount = Math.ceil(visible.length / pageSize);
  currentPage = Math.min(currentPage, Math.max(pageCount, 1));
  const start = (currentPage - 1) * pageSize;
  const pageAdmins = visible.slice(start, start + pageSize);
  const pagination = document.querySelector('#officer-pagination');
  pagination.hidden = visible.length <= pageSize;
  document.querySelector('#officer-page-status').textContent = (
    `Page ${currentPage} of ${pageCount} · ${start + 1}–${Math.min(start + pageSize, visible.length)} of ${visible.length}`
  );
  document.querySelector('#officer-previous-page').disabled = currentPage <= 1;
  document.querySelector('#officer-next-page').disabled = currentPage >= pageCount;
  officerTableWrap.classList.toggle('is-scrollable', visible.length > 6);

  if (!visible.length) {
    showEmptyTable(admins.length ? 'No officers match this search.' : 'No officer accounts are configured.');
    return;
  }

  officerAccessList.replaceChildren(...pageAdmins.map((admin) => {
    const row = document.createElement('tr');
    row.append(
      element('td', '', admin.name || 'Name not set'),
      element('td', 'officer-email-cell', admin.email),
      element('td', '', admin.role === 'superadmin' ? 'Superadmin' : 'Admin'),
      element('td', '', new Date(admin.added_at).toLocaleString()),
      element('td', '', new Date(admin.updated_at).toLocaleString()),
    );
    const actions = element('div', 'table-actions officer-table-actions');
    const updateButton = element('button', 'button button-small button-muted', 'Update');
    updateButton.type = 'button';
    updateButton.setAttribute('aria-label', `Update access for ${admin.email}`);
    updateButton.addEventListener('click', () => showAccessDialog(admin));
    const removeButton = element('button', 'button button-small button-danger', 'Remove');
    removeButton.type = 'button';
    removeButton.setAttribute('aria-label', `Remove access for ${admin.email}`);
    removeButton.addEventListener('click', () => removeOfficer(admin, removeButton));
    actions.append(updateButton, removeButton);
    const actionsCell = document.createElement('td');
    actionsCell.append(actions);
    row.append(actionsCell);
    return row;
  }));
}

async function loadOfficerAccess() {
  try {
    const result = await api('/api/superadmin/admins');
    if (!Array.isArray(result.admins)) {
      throw new Error('The server returned an invalid officer list.');
    }
    admins = result.admins;
    renderOfficerAccess();
  } catch (error) {
    showEmptyTable(error.message);
    document.querySelector('#officer-pagination').hidden = true;
    officerTableWrap.classList.remove('is-scrollable');
  }
}

accessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = document.querySelector('#save-officer-access');
  const name = form.elements.name.value.trim();
  const email = form.elements.email.value.trim().toLowerCase();
  const role = form.elements.role.value;
  submitButton.disabled = true;
  accessMessage.textContent = '';
  try {
    if (editingAdmin) {
      await api(`/api/superadmin/admins/${encodeURIComponent(editingAdmin.email)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, email, role }),
      });
      if (editingAdmin.email === currentEmail && (email !== currentEmail || role !== currentRole)) {
        window.bosesNavigate('/admin/login');
        return;
      }
      if (editingAdmin.email === currentEmail) {
        currentName = name;
        document.querySelector('#officer-name').textContent = currentName || currentEmail;
      }
      accessMessage.textContent = `Saved officer access for ${name}.`;
    } else {
      await api('/api/superadmin/admins', {
        method: 'POST',
        body: JSON.stringify({ name, email, role }),
      });
      currentPage = 1;
      accessMessage.textContent = 'Officer access added.';
    }
    accessMessage.className = 'form-message';
    accessDialog.close();
    await loadOfficerAccess();
  } catch (error) {
    accessMessage.textContent = error.message;
    accessMessage.className = 'form-message is-error';
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#add-officer-button').addEventListener('click', () => showAccessDialog());
document.querySelector('#cancel-officer-access').addEventListener('click', () => accessDialog.close());
accessDialog.addEventListener('click', (event) => {
  if (event.target === accessDialog) accessDialog.close();
});
document.querySelector('#officer-search').addEventListener('input', () => {
  currentPage = 1;
  renderOfficerAccess();
});
document.querySelector('#officer-role-filter').addEventListener('change', () => {
  currentPage = 1;
  renderOfficerAccess();
});
document.querySelector('#officer-previous-page').addEventListener('click', () => {
  currentPage -= 1;
  renderOfficerAccess();
});
document.querySelector('#officer-next-page').addEventListener('click', () => {
  currentPage += 1;
  renderOfficerAccess();
});
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
    currentEmail = session.email;
    currentName = session.name || '';
    if (currentRole !== 'superadmin') {
      window.bosesNavigate('/admin');
      return;
    }
    document.querySelector('#officer-name').textContent = currentName || currentEmail;
    document.querySelector('#officer-email').textContent = currentEmail;
    document.querySelector('#access-role-label').textContent = 'Superadmin';
    for (const id of ['archive-link', 'sender-tags-link', 'officer-access-link', 'privacy-link']) {
      document.querySelector(`#${id}`).hidden = false;
    }
    await loadOfficerAccess();
  } catch (error) {
    showEmptyTable(error.message);
  }
}

initialize();
