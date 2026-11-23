const privacyForm = document.querySelector('#privacy-form');
const privacyMessage = document.querySelector('#privacy-message');
const deleteNoticeButton = document.querySelector('#delete-notice');
const noticeEditor = document.querySelector('#notice-editor');
const editorCount = document.querySelector('#privacy-editor-count');
let hasNotice = false;

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

function setMessage(text, isError = false) {
  privacyMessage.textContent = text;
  privacyMessage.className = `form-message${isError ? ' is-error' : ''}`;
}

function updateEditorCount() {
  const length = noticeEditor.innerHTML.length;
  const maximum = Number(noticeEditor.dataset.maxlength);
  editorCount.textContent = `${length.toLocaleString()} / ${maximum.toLocaleString()} formatted characters`;
  editorCount.classList.toggle('is-error', length > maximum);
}

async function loadNotice() {
  const result = await api('/api/privacy-notice');
  hasNotice = Boolean(result.notice);
  privacyForm.elements.title.value = result.notice?.title || '';
  noticeEditor.innerHTML = window.BosesPrivacyHtml.sanitize(result.notice?.body || '');
  updateEditorCount();
  deleteNoticeButton.hidden = !hasNotice;
  document.querySelector('#privacy-form-heading').textContent = hasNotice ? 'Edit public notice' : 'Create public notice';
}

document.querySelectorAll('.privacy-editor-toolbar [data-command], .privacy-editor-toolbar [data-block]')
  .forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      noticeEditor.focus();
      if (button.dataset.block) {
        document.execCommand('formatBlock', false, button.dataset.block);
      } else {
        document.execCommand(button.dataset.command, false, button.dataset.value || null);
      }
      updateEditorCount();
    });
  });
noticeEditor.addEventListener('input', updateEditorCount);
noticeEditor.addEventListener('paste', (event) => {
  event.preventDefault();
  document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
  updateEditorCount();
});

privacyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!noticeEditor.textContent.trim() || noticeEditor.innerHTML.length > Number(noticeEditor.dataset.maxlength)) {
    setMessage('Add notice content and keep the formatted content within 10,000 characters.', true);
    return;
  }
  const submitButton = privacyForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  setMessage('');
  try {
    await api('/api/superadmin/privacy-notice', {
      method: hasNotice ? 'PUT' : 'POST',
      body: JSON.stringify({
        title: privacyForm.elements.title.value,
        body: window.BosesPrivacyHtml.sanitize(noticeEditor.innerHTML),
      }),
    });
    await loadNotice();
    setMessage('Privacy notice saved and published.');
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

deleteNoticeButton.addEventListener('click', async () => {
  if (!hasNotice || !window.confirm('Delete the public Privacy & Confidentiality Notice?')) return;
  deleteNoticeButton.disabled = true;
  setMessage('');
  try {
    await api('/api/superadmin/privacy-notice', { method: 'DELETE' });
    await loadNotice();
    setMessage('Privacy notice deleted.');
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    deleteNoticeButton.disabled = false;
  }
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
    if (session.role !== 'superadmin') {
      window.bosesNavigate('/admin');
      return;
    }
    document.querySelector('#officer-name').textContent = session.name || session.email;
    document.querySelector('#officer-email').textContent = session.email;
    document.querySelector('#access-role').textContent = 'Superadmin';
    for (const id of ['archive-link', 'sender-tags-link', 'officer-access-link', 'privacy-link']) {
      document.querySelector(`#${id}`).hidden = false;
    }
    await loadNotice();
  } catch (error) {
    setMessage(error.message, true);
  }
}

initialize();
