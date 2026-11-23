function initTopbarActions() {
  const topbar = document.querySelector('.dashboard-topbar');
  if (!topbar) return;

  document.querySelector('.dashboard-actions-wrap')?.remove();
  topbar.querySelector('[data-topbar-actions]')?.remove();

  const actions = document.createElement('div');
  actions.className = 'dashboard-actions-wrap topbar-actions-wrap';
  actions.dataset.topbarActions = 'true';

  const bellWrap = document.createElement('div');
  bellWrap.className = 'notification-bell-wrap';
  bellWrap.innerHTML = `
    <button class="notification-bell" type="button" aria-label="Open notifications" aria-expanded="false" data-notification-bell>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16H6l1.5-2v-3.5a4.5 4.5 0 0 1 9 0V14z"/><path d="M10 18.5h4"/></svg>
      <span class="notification-badge" data-notification-badge hidden>0</span>
    </button>
    <div class="notification-dropdown" data-notification-dropdown hidden>
      <div class="notification-dropdown-heading"><strong>Notifications</strong><a data-notification-view-all href="/notifications">View all</a></div>
      <div class="notification-dropdown-list" data-notification-list><p class="empty-state">Loading…</p></div>
    </div>
  `;
  const signout = document.createElement('button');
  signout.className = 'topbar-signout';
  signout.type = 'button';
  signout.id = 'topbar-logout-button';
  signout.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/><path d="M14 16l4-4-4-4M18 12H9"/></svg><span>Sign out</span>';
  actions.append(bellWrap, signout);

  const user = topbar.querySelector('.dashboard-user');
  if (user) topbar.insertBefore(actions, user);
  else topbar.append(actions);

  bellWrap.querySelector('[data-notification-view-all]').href =
    document.body.classList.contains('admin-dashboard-page') ? '/admin/notifications' : '/notifications';

  const bell = actions.querySelector('[data-notification-bell]');
  const dropdown = actions.querySelector('[data-notification-dropdown]');
  const list = actions.querySelector('[data-notification-list]');
  const badge = actions.querySelector('[data-notification-badge]');

  async function loadNotifications() {
    try {
      const response = await fetch('/api/notifications', { credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load notifications.');
      badge.textContent = String(result.unread);
      badge.hidden = result.unread === 0;
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
    if (open) loadNotifications();
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

  signout.addEventListener('click', async () => {
    signout.disabled = true;
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'BOSES-Client' },
      });
      const result = await response.json();
      if (!response.ok || result?.signedOut !== true) throw new Error(result?.error || 'Could not sign out.');
      window.location.assign('/');
    } catch (error) {
      window.alert(error.message);
      signout.disabled = false;
    }
  });

  loadNotifications();
}

initTopbarActions();
