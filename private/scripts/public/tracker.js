const trackerForm = document.querySelector('#tracker-form');
const trackerMessage = document.querySelector('#tracker-message');
const trackerResult = document.querySelector('#tracker-result');

function formatStatus(status) {
  return {
    under_review: 'Under Review',
    in_progress: 'In Progress',
    not_implemented: 'Not Implemented',
  }[status] || status[0].toUpperCase() + status.slice(1);
}

function statusClass(status) {
  return `status-${status.replaceAll('_', '-')}`;
}

trackerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  trackerResult.hidden = true;
  trackerMessage.textContent = 'Looking up your report…';
  trackerMessage.className = 'form-message';
  const trackingId = trackerForm.trackingId.value.trim().toUpperCase();

  try {
    const response = await fetch(`/api/tracker/${encodeURIComponent(trackingId)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not find that report.');

    trackerMessage.textContent = '';
    const insight = result.insight;
    const displayStatus = insight.status;
    trackerResult.replaceChildren();
    const label = document.createElement('span');
    label.className = 'eyebrow';
    label.textContent = 'Current status';
    const status = document.createElement('strong');
    status.className = `status-pill ${statusClass(displayStatus)}`;
    status.textContent = formatStatus(displayStatus);
    const id = document.createElement('p');
    id.className = 'result-tracking-id';
    id.textContent = insight.tracking_id;
    const date = document.createElement('p');
    date.className = 'muted small-text';
    date.textContent = `Last updated ${new Date(insight.updated_at).toLocaleString()}`;
    trackerResult.append(label, status, id, date);
    trackerResult.hidden = false;
  } catch (error) {
    trackerMessage.textContent = error.message;
    trackerMessage.classList.add('is-error');
  }
});