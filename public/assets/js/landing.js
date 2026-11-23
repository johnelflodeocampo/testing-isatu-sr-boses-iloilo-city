async function updateMemberLinks() {
  const links = document.querySelectorAll('[data-member-link]');
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    if (!response.ok) return;
    const session = await response.json();
    if (session.signedIn && session.role === 'user') {
      links.forEach((link) => {
        link.href = '/dashboard';
        if (link.classList.contains('button')) link.textContent = 'Open dashboard';
      });
    } else if (session.signedIn && ['admin', 'superadmin'].includes(session.role)) {
      links.forEach((link) => {
        link.href = '/admin';
        if (link.classList.contains('button')) {
          link.textContent = session.role === 'superadmin' ? 'Superadmin console' : 'Admin console';
        }
      });
    }
  } catch (error) {
    console.error('Could not check the current session:', error);
  }
}

updateMemberLinks();