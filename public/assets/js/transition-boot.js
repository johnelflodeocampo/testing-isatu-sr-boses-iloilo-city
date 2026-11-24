(() => {
  const transitionTargetKey = 'publicPageTransitionTarget';

  try {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches
      && sessionStorage.getItem(transitionTargetKey) === window.location.href
      && navigation?.type === 'navigate') {
      document.documentElement.classList.add('public-transition-pending');
      window.setTimeout(() => {
        document.documentElement.classList.remove('public-transition-pending');
      }, 1200);
    }
  } catch (error) {
    console.error('Unable to prepare the public page transition.', error);
  }
})();
