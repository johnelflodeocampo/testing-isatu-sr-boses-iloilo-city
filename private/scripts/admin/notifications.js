const list = document.querySelector('#notification-list');
const markAll = document.querySelector('#mark-all-read');
const officerEmail = document.querySelector('#officer-email');

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.method ? { 'X-Requested-With': 'BOSES-Client' } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load notifications.');
  return result;
}

async function loadNotifications() {
  markAll.disabled = true;
  try {
    const session = await api('/api/me');
    if (officerEmail) officerEmail.textContent = session.email || '—';
    document.querySelector('#access-role').textContent =
      session.role === 'superadmin' ? 'Superadmin' : 'Admin';
    for (const id of ['archive-link', 'sender-tags-link', 'officer-access-link', 'privacy-link']) {
      document.querySelector(`#${id}`).hidden = session.role !== 'superadmin';
    }
    const result = await api('/api/notifications');
    if (!Array.isArray(result.notifications)) {
      throw new Error('The server returned an invalid notifications list.');
    }
    window.dispatchEvent(new CustomEvent('boses:notifications-loaded', { detail: result }));
    if (!result.notifications.length) {
      list.innerHTML = '<p class="empty-state">You have no notifications.</p>';
      return;
    }
    markAll.disabled = !result.notifications.some((item) => !item.is_read);
    list.replaceChildren(...result.notifications.map((item) => {
      const card = document.createElement('article');
      card.className = `notification-card${item.is_read ? '' : ' is-unread'}`;
      card.innerHTML = `<div class="notification-card-copy"><strong>${item.title}</strong><p>${item.body}</p><time>${new Date(item.created_at).toLocaleString()}</time></div><a class="button button-small" href="${item.link}">View details</a>`;
      card.querySelector('a').addEventListener('click', async () => {
        if (!item.is_read) await api(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: 'PATCH' }).catch(() => {});
      });
      return card;
    }));
  } catch (error) {
    list.innerHTML = `<p class="form-message is-error">${error.message}</p>`;
    markAll.disabled = true;
  }
}

markAll?.addEventListener('click', async () => {
  markAll.disabled = true;
  try {
    const result = await api('/api/notifications');
    await Promise.all(result.notifications
      .filter((item) => !item.is_read)
      .map((item) => api(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: 'PATCH' })));
    await loadNotifications();
  } catch (error) {
    list.innerHTML = `<p class="form-message is-error">${error.message}</p>`;
  }
});

loadNotifications();
