module.exports = function getErrorRecoveryAction(role) {
  if (role === 'user' || role === 'student') {
    return {
      label: 'Back to dashboard',
      href: '/dashboard',
      bodyClass: 'portal-page portal-dashboard-page student-dashboard-page error-page student-error-page',
      context: '',
    };
  }
  if (role === 'admin' || role === 'superadmin') {
    return {
      label: 'Back to dashboard',
      href: '/admin',
      bodyClass: `portal-page portal-dashboard-page admin-portal-page admin-dashboard-page error-page officer-error-page${role === 'superadmin' ? ' superadmin-error-page' : ''}`,
      context: '',
    };
  }
  return {
    label: 'Back to index',
    href: '/',
    bodyClass: 'home-page public-page error-page guest-error-page',
    context: 'You are not signed in. Return to the index to continue.',
  };
};
