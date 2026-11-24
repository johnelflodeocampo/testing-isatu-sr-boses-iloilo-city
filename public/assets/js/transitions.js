const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const publicPage = document.body.classList.contains('public-page');
const transitionPage = publicPage;
const transitionTargetKey = 'publicPageTransitionTarget';
const transitionFallbackDelay = 600;
let navigationPending = false;
let pendingDestination = null;
let transitionFallbackTimer = null;

let transitionOverlay = null;

if (transitionPage) {
  transitionOverlay = document.createElement('div');
  transitionOverlay.className = 'page-transition-overlay';
  transitionOverlay.setAttribute('aria-hidden', 'true');
  transitionOverlay.innerHTML = `
    <div class="page-transition-logos">
      <img src="/assets/assests/logo/isatu_logo.png" alt="">
      <img src="/assets/assests/logo/sr_logo.png" alt="">
    </div>
  `;
  document.body.append(transitionOverlay);

  transitionOverlay.addEventListener('animationend', (event) => {
    if (event.target !== transitionOverlay) return;

    if (event.animationName === 'public-yellow-reveal') {
      clearTransitionFallback();
      document.body.classList.remove('is-entering');
    } else if (event.animationName === 'public-yellow-cover') {
      finishLeavingTransition();
    }
  });

  transitionOverlay.addEventListener('animationcancel', (event) => {
    if (event.target !== transitionOverlay) return;

    if (event.animationName === 'public-yellow-reveal') {
      clearTransitionFallback();
      document.body.classList.remove('is-entering');
    } else if (event.animationName === 'public-yellow-cover') {
      finishLeavingTransition();
    }
  });
}

for (const link of document.querySelectorAll('.site-nav a[href], .header-actions a[href]')) {
  const destination = new URL(link.href, window.location.href);
  if (destination.origin === window.location.origin
    && destination.pathname === window.location.pathname) {
    link.setAttribute('aria-current', 'page');
  }
}

function consumeTransitionTarget() {
  try {
    const target = sessionStorage.getItem(transitionTargetKey);
    sessionStorage.removeItem(transitionTargetKey);
    const navigation = performance.getEntriesByType('navigation')[0];
    return target === window.location.href && navigation && navigation.type === 'navigate';
  } catch (error) {
    console.error('Unable to read the public page transition state.', error);
    return false;
  }
}

let animateIncomingTransition = consumeTransitionTarget() && transitionPage;

function clearTransitionFallback() {
  if (transitionFallbackTimer === null) return;
  window.clearTimeout(transitionFallbackTimer);
  transitionFallbackTimer = null;
}

function scheduleTransitionFallback(callback) {
  clearTransitionFallback();
  transitionFallbackTimer = window.setTimeout(() => {
    transitionFallbackTimer = null;
    callback();
  }, transitionFallbackDelay);
}

function finishLeavingTransition() {
  if (!pendingDestination) return;
  const destination = pendingDestination;
  pendingDestination = null;
  clearTransitionFallback();
  window.location.assign(destination);
}

function resetPageTransition() {
  clearTransitionFallback();
  navigationPending = false;
  pendingDestination = null;
  document.body.classList.remove('is-leaving');
  document.body.classList.remove('is-entering');
  if (animateIncomingTransition && !reducedMotion.matches) {
    document.body.classList.add('is-entering');
    scheduleTransitionFallback(() => document.body.classList.remove('is-entering'));
  }
  document.documentElement.classList.remove('public-transition-pending');
  animateIncomingTransition = false;
}

function navigateWithTransition(url) {
  const destination = new URL(url, window.location.href);
  const signInDestination = ['/login', '/admin/login'].includes(destination.pathname);
  if (destination.origin !== window.location.origin || !transitionPage || reducedMotion.matches
    || signInDestination
    || destination.pathname === window.location.pathname
      && destination.search === window.location.search) {
    window.location.assign(destination.href);
    return;
  }
  if (navigationPending) return;

  try {
    sessionStorage.setItem(transitionTargetKey, destination.href);
  } catch (error) {
    console.error('Unable to save the page transition state.', error);
    window.location.assign(destination.href);
    return;
  }

  navigationPending = true;
  pendingDestination = destination.href;
  document.body.classList.add('is-leaving');
  scheduleTransitionFallback(finishLeavingTransition);
}

window.bosesNavigate = navigateWithTransition;

function initAuthenticatedTopbarActions() {
  if (publicPage || document.body.classList.contains('auth-page')) return;
  const sidebar = document.querySelector('.portal-sidebar');
  const nav = sidebar?.querySelector('.sidebar-nav');
  const signout = sidebar?.querySelector('.sidebar-signout');
  const account = document.querySelector('.dashboard-user');
  if (!sidebar || !nav || !signout) return;
  if (sidebar.querySelector('[data-sidebar-actions]')) return;

  const actions = document.createElement('div');
  actions.className = 'sidebar-account-actions';
  actions.dataset.sidebarActions = 'true';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', 'Account actions');
  actions.innerHTML = `
    <div class="notification-bell-wrap sidebar-notification-wrap">
      <button class="notification-bell" type="button" aria-label="Open notifications" aria-expanded="false" data-notification-bell>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16H6l1.5-2v-3.5a4.5 4.5 0 0 1 9 0V14z"/><path d="M10 18.5h4"/></svg>
        <span class="notification-badge" data-notification-badge hidden>0</span>
      </button>
      <div class="notification-dropdown" data-notification-dropdown hidden>
        <div class="notification-dropdown-heading"><strong>Notifications</strong><a data-notification-view-all href="/notifications">View all</a></div>
        <div class="notification-dropdown-list" data-notification-list><p class="empty-state">Loading…</p></div>
      </div>
    </div>
  `;
  const isOfficer = document.body.classList.contains('admin-portal-page')
    || document.body.classList.contains('admin-dashboard-page')
    || document.body.classList.contains('admin-notifications-page');
  actions.querySelector('[data-notification-view-all]').href =
    isOfficer ? '/admin/notifications' : '/notifications';
  let closeAccountMenu = () => {};
  let closeNotificationMenu = () => {};
  if (account) {
    const accountMenu = document.createElement('div');
    accountMenu.className = 'dashboard-account-menu';

    const accountButton = document.createElement('button');
    accountButton.type = 'button';
    accountButton.className = `${account.className} dashboard-account-button`;
    accountButton.setAttribute('aria-haspopup', 'true');
    accountButton.setAttribute('aria-expanded', 'false');
    accountButton.setAttribute('aria-controls', 'dashboard-account-dropdown');
    accountButton.append(...account.childNodes);

    const accountDropdown = document.createElement('div');
    accountDropdown.className = 'dashboard-account-dropdown';
    accountDropdown.id = 'dashboard-account-dropdown';
    accountDropdown.hidden = true;
    accountDropdown.append(nav, signout);
    nav.setAttribute('aria-label', 'Dashboard navigation');
    const accountTopbar = account.closest('.dashboard-topbar');
    account.remove();
    accountMenu.append(accountButton, accountDropdown);
    actions.append(accountMenu);
    if (accountTopbar && !accountTopbar.children.length) accountTopbar.remove();

    closeAccountMenu = () => {
      accountDropdown.hidden = true;
      accountButton.setAttribute('aria-expanded', 'false');
    };
    accountButton.addEventListener('click', (event) => {
      event.stopPropagation();
      closeNotificationMenu();
      const open = accountDropdown.hidden;
      accountDropdown.hidden = !open;
      accountButton.setAttribute('aria-expanded', String(open));
    });
    accountDropdown.addEventListener('click', (event) => {
      if (event.target.closest('a')) closeAccountMenu();
    });
    document.addEventListener('click', (event) => {
      if (!accountMenu.contains(event.target)) closeAccountMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !accountDropdown.hidden) {
        closeAccountMenu();
        accountButton.focus();
      }
    });
  } else {
    actions.append(signout);
  }
  sidebar.append(actions);

  const bell = actions.querySelector('[data-notification-bell]');
  const dropdown = actions.querySelector('[data-notification-dropdown]');
  const list = actions.querySelector('[data-notification-list]');
  const badge = actions.querySelector('[data-notification-badge]');
  let loadingNotifications = false;
  let lastNotificationsLoadedAt = 0;

  function renderNotifications(result) {
    if (!Array.isArray(result?.notifications)) {
      throw new Error('The server returned an invalid notifications list.');
    }
    const unread = Number.isInteger(result.unread)
      ? result.unread
      : result.notifications.filter((item) => !item.is_read).length;
    badge.textContent = String(unread);
    badge.hidden = unread === 0;
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
  }

  closeNotificationMenu = () => {
    dropdown.hidden = true;
    bell.setAttribute('aria-expanded', 'false');
  };

  async function loadNotifications() {
    if (loadingNotifications || Date.now() - lastNotificationsLoadedAt < 30_000) return;
    loadingNotifications = true;
    try {
      const response = await fetch('/api/notifications', { credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load notifications.');
      lastNotificationsLoadedAt = Date.now();
      renderNotifications(result);
    } catch (error) {
      list.innerHTML = `<p class="form-message is-error">${error.message}</p>`;
    } finally {
      loadingNotifications = false;
    }
  }

  window.addEventListener('boses:notifications-loaded', (event) => {
    if (!document.body.classList.contains('admin-notifications-page')) return;
    try {
      renderNotifications(event.detail);
      lastNotificationsLoadedAt = Date.now();
    } catch (error) {
      list.innerHTML = `<p class="form-message is-error">${error.message}</p>`;
    }
  });

  bell.addEventListener('click', (event) => {
    event.stopPropagation();
    closeAccountMenu();
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

  if (!signout.id) {
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
  }

  if (!document.body.classList.contains('admin-notifications-page')) loadNotifications();
}

initAuthenticatedTopbarActions();

if (!reducedMotion.matches) {
  document.documentElement.classList.add('motion-ready');
  const revealItems = document.querySelectorAll(
    'main > .portal-title, main .auth-layout > *, main .dashboard-choices > *, main .entry-card, main > .page-intro, main > .dashboard-grid > .panel, main > .stats-grid, main > .admin-panel, main > .messages-layout > *, main > .notice, main > .panel, main > .resource-faq-section, main .error-card, body.portal-dashboard-page .dashboard-topbar, body.portal-dashboard-page main > .dashboard-shortcuts > *, body.portal-dashboard-page main > .dashboard-overview-grid > *',
  );
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
    for (const item of revealItems) {
      item.classList.add('scroll-reveal');
      revealObserver.observe(item);
    }
  } else {
    for (const item of revealItems) item.classList.add('is-visible');
  }
}

window.addEventListener('pageshow', resetPageTransition);

document.addEventListener('click', (event) => {
  if (reducedMotion.matches || event.defaultPrevented || event.button !== 0
    || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const link = event.target.closest('a[href]');
  if (!link || link.target || link.hasAttribute('download')) return;

  const destination = new URL(link.href, window.location.href);
  if (destination.origin !== window.location.origin
    || destination.pathname === window.location.pathname
      && destination.search === window.location.search) return;

  event.preventDefault();
  navigateWithTransition(destination.href);
});
