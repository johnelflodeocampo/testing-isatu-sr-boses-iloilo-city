const conversationList = document.querySelector('#conversation-list');
const conversationSearch = document.querySelector('#conversation-search');
const conversationStatus = document.querySelector('#conversation-status');
const conversationHeading = document.querySelector('#conversation-heading');
const messageList = document.querySelector('#chat-messages');
const messageError = document.querySelector('#chat-error');
const messageForm = document.querySelector('#chat-compose');
const messageInput = document.querySelector('#chat-body');
const sendButton = messageForm.querySelector('button[type="submit"]');

let role;
let insights = [];
let activeInsight = null;
let loadingMessages = false;
let refreshRequested = false;
let renderedMessageIds = new Set();
const renderedMessages = new Map();
const renderedMessageItems = new Map();
let chatEnabled = true;

function isOfficerRole() {
  return role === 'admin' || role === 'superadmin';
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatStatus(status) {
  return {
    under_review: 'Under Review',
    in_progress: 'In Progress',
    not_implemented: 'Not Implemented',
  }[status] || status[0].toUpperCase() + status.slice(1);
}

function reportTypeLabel(insight) {
  return insight.report_type === 'concern' ? 'Concern' : 'Feedback';
}

function statusClass(status) {
  return `status-${status.replaceAll('_', '-')}`;
}

function emailDisplayName(email) {
  return typeof email === 'string' ? email.split('@')[0] : '';
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method ? { 'X-Requested-With': 'BOSES-Client' } : {}),
      ...options.headers,
    },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`The server returned an unexpected response (HTTP ${response.status}). Refresh and try again.`);
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('The server returned invalid JSON. Refresh the page and try again.');
    }
    throw error;
  }
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

function messagesPath(insight) {
  const base = isOfficerRole() ? '/api/admin/insights' : '/api/my/insights';
  return `${base}/${encodeURIComponent(insight.id)}/messages`;
}

function messageMutationPath(insight, message) {
  return `/api/insights/${encodeURIComponent(insight.id)}/messages/${encodeURIComponent(message.id)}`;
}

function messageActionButton(action, label, paths) {
  const button = element('button', 'chat-message-action');
  button.type = 'button';
  button.dataset.messageAction = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  for (const pathData of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    icon.append(path);
  }
  button.append(icon);
  return button;
}

function renderMessageActions(message, item) {
  item.querySelector('.chat-message-actions')?.remove();
  if (!message.can_manage || message.is_unsent) return;
  const actions = element('div', 'chat-message-actions');
  const menuButton = element('button', 'chat-message-action chat-message-menu-button');
  menuButton.type = 'button';
  menuButton.dataset.messageAction = 'menu';
  menuButton.setAttribute('aria-label', 'Message options');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.title = 'Message options';
  const menuIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  menuIcon.setAttribute('viewBox', '0 0 24 24');
  menuIcon.setAttribute('aria-hidden', 'true');
  for (const circle of [[5, 12], [12, 12], [19, 12]]) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(circle[0]));
    dot.setAttribute('cy', String(circle[1]));
    dot.setAttribute('r', '1.6');
    menuIcon.append(dot);
  }
  menuButton.append(menuIcon);

  const menu = element('div', 'chat-message-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const editButton = element('button', 'chat-message-menu-option', 'Edit');
  editButton.type = 'button';
  editButton.dataset.messageAction = 'edit';
  editButton.setAttribute('role', 'menuitem');
  const unsendButton = element('button', 'chat-message-menu-option is-danger', 'Unsend');
  unsendButton.type = 'button';
  unsendButton.dataset.messageAction = 'unsend';
  unsendButton.setAttribute('role', 'menuitem');
  menu.append(editButton, unsendButton);
  actions.append(menuButton, menu);
  item.append(actions);
}

function renderMessageContent(message, item) {
  item.classList.toggle('is-unsent', Boolean(message.is_unsent));
  const content = element('div', 'chat-message-content');
  content.append(element(
    'p',
    `chat-message-body${message.is_unsent ? ' is-unsent' : ''}`,
    message.is_unsent ? 'This message was unsent' : message.body,
  ));
  const bubble = item.querySelector('.chat-message-bubble');
  const previousContent = bubble.querySelector('.chat-message-content, .chat-message-edit');
  if (previousContent) previousContent.replaceWith(content);
  else bubble.append(content);
  renderMessageActions(message, item);
}

function renderConversations() {
  if (!insights.length) {
    conversationList.classList.remove('has-overflow');
    conversationList.replaceChildren(element('p', 'empty-state', 'No reports have conversations yet.'));
    conversationHeading.replaceChildren(element('p', 'empty-state', 'No conversations to display.'));
    messageList.replaceChildren();
    messageForm.hidden = true;
    return;
  }

  const searchTerm = conversationSearch.value.trim().toLocaleLowerCase();
  const selectedStatus = conversationStatus.value;
  const matchingInsights = insights.filter((insight) => [
    insight.tracking_id,
    reportTypeLabel(insight),
    insight.priority,
    insight.status,
    insight.sender_label,
    insight.content,
  ].some((value) => String(value || '').toLocaleLowerCase().includes(searchTerm))
    && (!selectedStatus || insight.status === selectedStatus));

  conversationList.classList.toggle('has-overflow', matchingInsights.length > 5);
  if (!matchingInsights.length) {
    conversationList.replaceChildren(element('p', 'empty-state', 'No conversations match your search.'));
    return;
  }

  conversationList.replaceChildren(...matchingInsights.map((insight) => {
    const link = element('a', `conversation-link${activeInsight?.id === insight.id ? ' is-active' : ''}`);
    link.href = `/inbox?report=${encodeURIComponent(insight.id)}`;
    link.dataset.reportId = insight.id;
    link.setAttribute('aria-current', activeInsight?.id === insight.id ? 'page' : 'false');
    const title = element('strong', '', insight.tracking_id);
    const status = element('span', `status-pill ${statusClass(insight.status)}`, formatStatus(insight.status));
    const summary = element('span', 'conversation-preview', `${reportTypeLabel(insight)} · ${insight.content}`);
    link.append(title, status, summary);
    return link;
  }));
}

conversationSearch.addEventListener('input', renderConversations);
conversationStatus.addEventListener('change', renderConversations);

function selectInsight(insight) {
  activeInsight = insight;
  renderedMessageIds = new Set();
  renderedMessages.clear();
  renderedMessageItems.clear();
  renderConversations();
  const title = element('strong', 'tracking-code', insight.tracking_id);
  const subtitle = element(
    'span',
    'conversation-subtitle',
    `${reportTypeLabel(insight)}${isOfficerRole() && insight.report_type === 'concern' ? ` · ${insight.priority} priority` : ''} · ${formatStatus(insight.status)} · ${isOfficerRole() ? (insight.is_anonymous ? 'Anonymous' : emailDisplayName(insight.sender_label) || 'Submitter') : 'Officer team'}`,
  );
  conversationHeading.replaceChildren(title, subtitle);
  if (insight.status_comment) {
    const comment = element('section', 'status-comment');
    comment.append(
      element('strong', '', 'Officer outcome note'),
      element('p', '', insight.status_comment),
    );
    conversationHeading.append(comment);
  }
  messageList.replaceChildren(element('p', 'chat-empty', 'Loading messages…'));
  messageForm.hidden = true;
  messageError.textContent = '';
  loadMessages();
}

async function loadMessages() {
  if (!activeInsight) return;
  if (loadingMessages) {
    refreshRequested = true;
    return;
  }
  loadingMessages = true;
  const requestedInsight = activeInsight;
  try {
    const result = await request(messagesPath(requestedInsight));
    if (activeInsight?.id !== requestedInsight.id) return;
    chatEnabled = result.chatEnabled !== false && result.messageRestricted !== true;
    messageForm.hidden = !chatEnabled;
    messageError.className = 'form-message chat-error';
    messageError.textContent = result.messageRestricted
      ? 'Messaging has been restricted for this sender. You can still view the conversation.'
      : chatEnabled
        ? ''
        : 'Messaging is disabled for this report. You can still view the conversation.';
    const wasAtBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 48;
    if (!result.messages.length) {
      if (!messageList.children.length || messageList.querySelector('.chat-empty')) {
        messageList.replaceChildren(element('p', 'chat-empty', 'No messages yet. Start the conversation below.'));
      }
    } else {
      messageList.querySelector('.chat-empty')?.remove();
      for (const message of result.messages) {
        const existing = renderedMessages.get(message.id);
        const item = renderedMessageItems.get(message.id);
        if (!existing || !item || item.querySelector('.chat-message-edit')) continue;
        if (existing.body !== message.body
          || existing.is_unsent !== message.is_unsent
          || existing.can_manage !== message.can_manage) {
          Object.assign(existing, message);
          renderMessageContent(existing, item);
        }
      }
      const newMessages = result.messages.filter((message) => !renderedMessageIds.has(message.id));
      for (const message of newMessages) {
        const ownMessage = isOfficerRole()
          ? message.sender_role === 'officer'
          : message.sender_role === 'member';
        const item = element('article', `chat-message${ownMessage ? ' is-own' : ''}`);
        item.dataset.messageId = message.id;
        const header = element('div', 'chat-message-header');
        const sender = ownMessage
          ? message.sender_name || 'You'
          : message.sender_name || (message.sender_role === 'member'
            ? (requestedInsight.is_anonymous ? 'Anonymous' : 'Submitter')
            : 'Officer');
        header.append(
          element('strong', '', sender),
          element('time', '', new Date(message.created_at).toLocaleString()),
        );
        const bubble = element('div', 'chat-message-bubble');
        bubble.append(header);
        item.append(bubble);
        renderMessageContent(message, item);
        messageList.append(item);
        renderedMessageIds.add(message.id);
        renderedMessages.set(message.id, message);
        renderedMessageItems.set(message.id, item);
      }
    }
    if (wasAtBottom) messageList.scrollTop = messageList.scrollHeight;
  } catch (error) {
    if (activeInsight?.id === requestedInsight.id) messageError.textContent = error.message;
  } finally {
    loadingMessages = false;
    if (refreshRequested || (activeInsight && activeInsight.id !== requestedInsight.id)) {
      refreshRequested = false;
      loadMessages();
    }
  }
}

messageList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-message-action]');
  if (!button || !messageList.contains(button) || !activeInsight) return;
  const item = button.closest('.chat-message');
  const message = renderedMessages.get(item?.dataset.messageId);
  if (!item || !message) return;

  if (button.dataset.messageAction === 'menu') {
    const menu = item.querySelector('.chat-message-menu');
    const willOpen = menu.hidden;
    messageList.querySelectorAll('.chat-message-menu').forEach((otherMenu) => {
      otherMenu.hidden = true;
      otherMenu.closest('.chat-message-actions')
        ?.querySelector('.chat-message-menu-button')
        ?.setAttribute('aria-expanded', 'false');
    });
    menu.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
    return;
  }

  if (button.dataset.messageAction === 'cancel-edit') {
    renderMessageContent(message, item);
    return;
  }
  if (button.dataset.messageAction === 'edit') {
    const form = element('form', 'chat-message-edit');
    const input = element('textarea');
    input.name = 'body';
    input.maxLength = 2000;
    input.required = true;
    input.setAttribute('aria-label', 'Edit message');
    input.value = message.body;
    const actions = element('div', 'chat-message-actions');
    const saveButton = element('button', 'button button-small', 'Save');
    saveButton.type = 'submit';
    const cancelButton = element('button', 'button button-small button-muted', 'Cancel');
    cancelButton.type = 'button';
    cancelButton.dataset.messageAction = 'cancel-edit';
    actions.append(saveButton, cancelButton);
    form.append(input, actions);
    const content = item.querySelector('.chat-message-bubble > .chat-message-content');
    if (!content) return;
    content.replaceWith(form);
    item.querySelector(':scope > .chat-message-actions')?.remove();
    input.focus();
    return;
  }
  if (button.dataset.messageAction === 'unsend') {
    if (!window.confirm('Unsend this message? It will be replaced with an unsent notice for everyone.')) return;
    button.disabled = true;
    try {
      await request(messageMutationPath(activeInsight, message), { method: 'DELETE' });
      message.body = 'This message was unsent';
      message.is_unsent = true;
      message.can_manage = false;
      renderMessageContent(message, item);
      messageError.textContent = '';
    } catch (error) {
      messageError.className = 'form-message is-error chat-error';
      messageError.textContent = error.message;
      button.disabled = false;
    }
  }
});

document.addEventListener('click', (event) => {
  if (event.target.closest('.chat-message-actions')) return;
  messageList.querySelectorAll('.chat-message-menu').forEach((menu) => {
    menu.hidden = true;
    menu.closest('.chat-message-actions')
      ?.querySelector('.chat-message-menu-button')
      ?.setAttribute('aria-expanded', 'false');
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  messageList.querySelectorAll('.chat-message-menu').forEach((menu) => {
    menu.hidden = true;
  });
  const openButton = messageList.querySelector('.chat-message-menu-button[aria-expanded="true"]');
  openButton?.setAttribute('aria-expanded', 'false');
  openButton?.focus();
});

messageList.addEventListener('submit', async (event) => {
  const form = event.target.closest('.chat-message-edit');
  if (!form || !messageList.contains(form) || !activeInsight) return;
  event.preventDefault();
  const item = form.closest('.chat-message');
  const message = renderedMessages.get(item?.dataset.messageId);
  const body = form.elements.body.value.trim();
  if (!message || !body) return;
  const saveButton = form.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  try {
    const result = await request(messageMutationPath(activeInsight, message), {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
    message.body = result.message.body;
    renderMessageContent(message, item);
    messageError.textContent = '';
  } catch (error) {
    messageError.className = 'form-message is-error chat-error';
    messageError.textContent = error.message;
    saveButton.disabled = false;
  }
});

conversationList.addEventListener('click', (event) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('.conversation-link');
  if (!link || !conversationList.contains(link)) return;
  const insight = insights.find((item) => item.id === link.dataset.reportId);
  if (!insight) return;

  event.preventDefault();
  if (activeInsight?.id === insight.id) return;
  window.history.pushState({ reportId: insight.id }, '', link.href);
  selectInsight(insight);
});

window.addEventListener('popstate', () => {
  const requestedId = new URLSearchParams(window.location.search).get('report');
  const insight = requestedId
    ? insights.find((item) => item.id === requestedId) || null
    : insights[0] || null;
  if (insight && insight.id !== activeInsight?.id) selectInsight(insight);
  else if (!insight && requestedId) {
    activeInsight = null;
    renderConversations();
    conversationHeading.replaceChildren(element('p', 'empty-state', 'This report has no inbox conversation.'));
    messageList.replaceChildren();
    messageForm.hidden = true;
  }
});

messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeInsight || !chatEnabled) return;
  const body = messageInput.value.trim();
  if (!body) return;
  sendButton.disabled = true;
  messageError.textContent = '';
  try {
    await request(messagesPath(activeInsight), {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    messageInput.value = '';
    await loadMessages();
  } catch (error) {
    messageError.textContent = error.message;
    if (error.message === 'Messaging is disabled for this report.'
      || error.message === 'Messaging is disabled for archived reports.'
      || error.message === 'Messaging has been restricted for this sender.') {
      chatEnabled = false;
      messageForm.hidden = true;
      messageError.className = 'form-message chat-error';
    } else {
      messageError.className = 'form-message is-error chat-error';
    }
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await request('/api/auth/logout', { method: 'POST' });
    window.bosesNavigate('/');
  } catch (error) {
    window.alert(error.message);
  }
});

async function initialize() {
  try {
    const session = await request('/api/me');
    if (!session.signedIn) {
      window.bosesNavigate('/login');
      return;
    }
    role = session.role;
    const officerSession = isOfficerRole();
    document.body.classList.toggle('admin-portal-page', officerSession);
    document.querySelector('#workspace-tag').textContent =
      officerSession ? (role === 'superadmin' ? 'Superadmin' : 'Admin') : 'Student private space';
    if (!officerSession) conversationStatus.querySelector('option[value="archived"]')?.remove();
    document.title = `Inbox | ISAT U BOSES`;
    document.querySelector('#message-brand-link').href = officerSession ? '/admin' : '/dashboard';
    document.querySelector('#message-brand-subtitle').textContent = officerSession
      ? 'Officer Review Console'
      : 'Concern and Feedback Portal';
    document.querySelector('.dashboard-user').classList.toggle('dashboard-user-officer', officerSession);
    document.querySelector('#message-user').textContent = session.name || session.email;
    const messageEmail = document.querySelector('#message-email');
    messageEmail.textContent = session.email;
    messageEmail.hidden = !session.name || session.name === session.email;
    document.querySelector('#message-role').textContent = 'Signed in as';
    const notificationViewAll = document.querySelector('[data-notification-view-all]');
    if (notificationViewAll) {
      notificationViewAll.href = officerSession ? '/admin/notifications' : '/notifications';
    }
    const workspacePath = officerSession ? '/admin' : '/dashboard';
    document.querySelector('#workspace-link').href = workspacePath;
    document.querySelector('#workspace-label').textContent = 'Dashboard';
    document.querySelector('#student-share-link').hidden = officerSession;
    document.querySelector('#student-reports-link').hidden = officerSession;
    document.querySelector('#student-help-portal-link').hidden = officerSession;
    document.querySelector('#student-resources-link').hidden = officerSession;
    document.querySelector('#student-privacy-link').hidden = officerSession;
    if (officerSession) {
      for (const id of ['admin-reports-link', 'admin-inbox-link', 'admin-resources-link', 'admin-insights-link']) {
        document.querySelector(`#${id}`).hidden = false;
      }
      for (const id of ['archive-link', 'sender-tags-link', 'officer-access-link', 'privacy-link']) {
        document.querySelector(`#${id}`).hidden = role !== 'superadmin';
      }
    } else {
      for (const id of [
        'admin-reports-link',
        'admin-resources-link',
        'admin-insights-link',
        'archive-link',
        'sender-tags-link',
        'officer-access-link',
        'privacy-link',
      ]) {
        document.querySelector(`#${id}`).hidden = true;
      }
    }
    const endpoint = officerSession ? '/api/admin/insights' : '/api/my/insights';
    const result = await request(endpoint);
    insights = result.insights;
    const requestedId = new URLSearchParams(window.location.search).get('report');
    activeInsight = requestedId
      ? insights.find((insight) => insight.id === requestedId) || null
      : insights[0] || null;
    renderConversations();
    if (activeInsight) selectInsight(activeInsight);
    else if (requestedId) {
      conversationHeading.replaceChildren(element('p', 'empty-state', 'This report has no inbox conversation.'));
      messageList.replaceChildren();
      messageForm.hidden = true;
    }
  } catch (error) {
    conversationList.replaceChildren(element('p', 'form-message is-error', error.message));
    conversationHeading.replaceChildren(element('p', 'empty-state', 'Could not load conversations.'));
  }
}

window.setInterval(() => {
  if (!document.hidden) loadMessages();
}, 10000);

initialize();
