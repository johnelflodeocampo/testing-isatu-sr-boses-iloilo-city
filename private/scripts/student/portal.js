const logoutButton = document.querySelector('#logout-button');
const memberEmail = document.querySelector('#member-email');

if (memberEmail) {
  fetch('/api/me', { credentials: 'same-origin' })
    .then(async (response) => {
      const session = await response.json();
      if (!response.ok) throw new Error(session.error || 'Could not load the signed-in account.');
      if (session.signedIn !== true || typeof session.email !== 'string') {
        throw new Error('The signed-in account could not be verified.');
      }
      memberEmail.textContent = session.email;
    })
    .catch((error) => {
      memberEmail.textContent = error.message;
    });
}

logoutButton?.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'BOSES-Client' },
    });
    let result;
    try {
      result = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('The server returned an invalid response. Please refresh and try again.');
      }
      throw error;
    }
    if (!response.ok || result?.signedOut !== true) {
      throw new Error(result?.error || 'Could not sign out. Please try again.');
    }
    window.bosesNavigate('/');
  } catch (error) {
    window.alert(error.message);
    logoutButton.disabled = false;
  }
});

function initNotifications() {
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

