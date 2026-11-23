const feedbackForm = document.querySelector('#product-feedback-form');
const feedbackMessage = document.querySelector('#feedback-message');
const feedbackConfirmation = document.querySelector('#feedback-confirmation');
const feedbackSubmitButton = document.querySelector('#feedback-submit-button');

async function submitFeedback(url, options) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'BOSES-Client',
      ...options.headers,
    },
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
  if (!response.ok) throw new Error(result?.error || 'Your Portal Insights submission could not be submitted.');
  if (!result || typeof result !== 'object'
    || !result.insight || typeof result.insight.tracking_id !== 'string') {
    throw new Error('The server did not return a tracking number. Refresh the Portal Insights page before submitting again.');
  }
  return result.insight;
}

function feedbackContent(formData) {
  const kindLabels = {
    bug: 'Bug report',
    feature: 'Feature request',
    other: 'Other',
  };
  const category = kindLabels[formData.get('kind')];
  if (!category) throw new Error('Choose a submission type.');
  const details = formData.get('details').trim();
  return `Category: ${category}\n\n${details}`;
}

function showConfirmation(insight) {
  const title = document.createElement('strong');
  title.textContent = `Portal Insights submission · ${insight.tracking_id}`;
  const details = document.createElement('p');
  details.textContent = 'Thanks for helping improve the portal.';
  feedbackConfirmation.replaceChildren(title, details);
  feedbackConfirmation.hidden = false;
}

feedbackForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!feedbackForm.reportValidity()) return;

  feedbackMessage.className = 'form-message';
  feedbackMessage.textContent = 'Submitting your Portal Insights submission…';
  feedbackConfirmation.hidden = true;
  feedbackSubmitButton.disabled = true;

  try {
    const formData = new FormData(feedbackForm);
    const insight = await submitFeedback('/api/portal-insights', {
      method: 'POST',
      body: JSON.stringify({
        reportType: 'feedback',
        content: feedbackContent(formData),
        isAnonymous: formData.get('isAnonymous') === 'on',
      }),
    });
    feedbackForm.reset();
    feedbackMessage.textContent = 'Your Portal Insights submission was submitted successfully.';
    showConfirmation(insight);
  } catch (error) {
    feedbackMessage.className = 'form-message is-error';
    feedbackMessage.textContent = error.message;
  } finally {
    feedbackSubmitButton.disabled = false;
  }
});
