const faqAdminList = document.querySelector('#faq-admin-list');
const faqTableWrap = document.querySelector('#faq-table-wrap');
const faqCategoryFilter = document.querySelector('#faq-category-filter');
const faqMessage = document.querySelector('#faq-message');
const faqListMessage = document.querySelector('#faq-list-message');
const faqForm = document.querySelector('#faq-form');
const faqEditorDialog = document.querySelector('#faq-editor-dialog');
const categoryDialog = document.querySelector('#resource-category-dialog');
const categoryForm = document.querySelector('#resource-category-form');
const categoryList = document.querySelector('#resource-category-list');
const categoryMessage = document.querySelector('#resource-category-message');
const faqCategories = [];
let faqEntries = [];
let faqPage = 1;
const resourcePageSize = 8;

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
  const responseBody = await response.text();
  let result;
  try {
    result = JSON.parse(responseBody);
  } catch {
    throw new Error(`The server returned an invalid response (HTTP ${response.status}). Refresh the page and try again.`);
  }
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setMessage(node, text, isError = false) {
  node.textContent = text;
  node.className = `form-message${isError ? ' is-error' : ''}`;
}

function renderFaqCategorySelect(preferredName) {
  const previousName = preferredName ?? faqForm.elements.category.value;
  faqForm.elements.category.replaceChildren(...faqCategories.map((category) => element('option', '', category.name)));
  if (faqCategories.some((category) => category.name === previousName)) {
    faqForm.elements.category.value = previousName;
  } else if (faqCategories.some((category) => category.name === 'General')) {
    faqForm.elements.category.value = 'General';
  } else if (faqCategories.length) {
    faqForm.elements.category.value = faqCategories[0].name;
  }
  faqForm.elements.category.disabled = !faqCategories.length;
}

function renderFaqCategoryFilter() {
  const previousCategory = faqCategoryFilter.value;
  faqCategoryFilter.replaceChildren(element('option', '', 'All categories'));
  faqCategoryFilter.options[0].value = 'all';
  for (const category of faqCategories) {
    faqCategoryFilter.append(element('option', '', category.name));
  }
  faqCategoryFilter.value = faqCategories.some((category) => category.name === previousCategory)
    ? previousCategory
    : 'all';
}

function resetCategoryForm() {
  categoryForm.reset();
  categoryForm.elements.id.value = '';
  document.querySelector('#category-form-heading').textContent = 'Add category';
  document.querySelector('#save-resource-category').textContent = 'Add category';
  document.querySelector('#cancel-resource-category-edit').hidden = true;
}

function renderCategoryManager() {
  if (!faqCategories.length) {
    categoryList.replaceChildren(element('p', 'empty-state', 'No categories yet. Add one to use it in a FAQ.'));
    return;
  }
  categoryList.replaceChildren(...faqCategories.map((category) => {
    const row = element('article', 'resource-category-row');
    const name = element('strong', '', category.name);
    const isDefault = category.name.toLocaleLowerCase() === 'general';
    const actions = element('div', 'resource-category-actions');
    if (!isDefault) {
      const edit = element('button', 'button button-small button-muted', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', () => {
        categoryForm.elements.id.value = category.id;
        categoryForm.elements.name.value = category.name;
        document.querySelector('#category-form-heading').textContent = 'Edit category';
        document.querySelector('#save-resource-category').textContent = 'Save category';
        document.querySelector('#cancel-resource-category-edit').hidden = false;
        categoryMessage.textContent = '';
        categoryForm.elements.name.focus();
      });
      actions.append(edit);
      const remove = element('button', 'button button-small button-danger', 'Delete');
      remove.type = 'button';
      remove.addEventListener('click', () => deleteCategory(category, remove));
      actions.append(remove);
    }
    row.append(name, ...(isDefault ? [element('span', 'resource-category-default', 'Default')] : []), actions);
    return row;
  }));
}

function openCategoryManager() {
  document.querySelector('#category-dialog-title').textContent = 'FAQ categories';
  document.querySelector('#category-dialog-description').textContent = (
    'Add, rename, or delete FAQ categories. Deleting a category moves its answers to General.'
  );
  resetCategoryForm();
  categoryMessage.textContent = '';
  renderCategoryManager();
  categoryDialog.showModal();
}

function resetFaqForm() {
  faqForm.reset();
  faqForm.elements.id.value = '';
  faqForm.querySelector('[data-cancel]').hidden = true;
  faqForm.querySelector('[type="submit"]').textContent = 'Add answer';
  document.querySelector('#faq-editor-title').textContent = 'Add answer';
  setMessage(faqMessage, '');
}

function openFaqEditor(entry) {
  resetFaqForm();
  if (entry) {
    faqForm.elements.id.value = entry.id;
    faqForm.elements.category.value = entry.category;
    faqForm.elements.question.value = entry.question;
    faqForm.elements.answer.value = entry.answer;
    faqForm.querySelector('[data-cancel]').hidden = false;
    faqForm.querySelector('[type="submit"]').textContent = 'Save changes';
    document.querySelector('#faq-editor-title').textContent = 'Edit answer';
  }
  faqEditorDialog.showModal();
  faqForm.elements.category.focus();
}

function labelFaqCell(cell, label) {
  const visualLabel = element('span', 'resource-faq-cell-label', label);
  visualLabel.setAttribute('aria-hidden', 'true');
  cell.dataset.label = label;
  cell.prepend(visualLabel, element('span', 'sr-only resource-faq-sr-label', `${label}: `));
}

function renderFaqs(entries) {
  faqEntries = entries;
  faqPage = 1;
  renderFaqCategoryFilter();
  renderFaqTable();
}

function renderFaqTable() {
  const query = document.querySelector('#faq-search').value.trim().toLocaleLowerCase();
  const selectedCategory = faqCategoryFilter.value;
  const visibleEntries = faqEntries.filter((entry) => (
    (selectedCategory === 'all' || entry.category === selectedCategory)
    && `${entry.category} ${entry.question} ${entry.answer}`.toLocaleLowerCase().includes(query)
  ));
  const pageCount = Math.ceil(visibleEntries.length / resourcePageSize);
  faqPage = Math.min(faqPage, Math.max(pageCount, 1));
  const pageEntries = visibleEntries.slice((faqPage - 1) * resourcePageSize, faqPage * resourcePageSize);
  faqTableWrap.classList.toggle('is-scrollable', pageEntries.length > 4);
  updateFaqPagination(faqPage, pageCount, visibleEntries.length);

  if (!visibleEntries.length) {
    const message = element(
      'td',
      'empty-state',
      faqEntries.length ? 'No answers match these filters.' : 'No FAQ entries yet.',
    );
    message.colSpan = 4;
    const row = document.createElement('tr');
    row.append(message);
    faqAdminList.replaceChildren(row);
    return;
  }

  faqAdminList.replaceChildren(...pageEntries.map((entry) => {
    const row = document.createElement('tr');
    const categoryCell = element('td', '', entry.category);
    labelFaqCell(categoryCell, 'Category');
    const questionCell = element('td', 'faq-question-cell');
    labelFaqCell(questionCell, 'Question');
    questionCell.append(element('strong', '', entry.question));
    const answerCell = element('td', 'faq-answer-cell', entry.answer);
    labelFaqCell(answerCell, 'Answer');
    row.append(categoryCell, questionCell, answerCell);
    const actionsCell = document.createElement('td');
    labelFaqCell(actionsCell, 'Actions');
    const actions = element('div', 'table-actions resource-faq-actions');
    const edit = element('button', 'button button-small button-muted', 'Edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Edit answer: ${entry.question}`);
    edit.addEventListener('click', () => openFaqEditor(entry));
    const remove = element('button', 'button button-small button-danger', 'Delete');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Delete answer: ${entry.question}`);
    remove.addEventListener('click', () => deleteFaq(entry, remove));
    actions.append(edit, remove);
    actionsCell.append(actions);
    row.append(actionsCell);
    return row;
  }));
}

function updateFaqPagination(page, pageCount, total) {
  const pagination = document.querySelector('#faq-pagination');
  pagination.hidden = total <= resourcePageSize;
  document.querySelector('#faq-page-status').textContent = (
    `Page ${page} of ${pageCount} · ${Math.min((page - 1) * resourcePageSize + 1, total)}–${Math.min(page * resourcePageSize, total)} of ${total}`
  );
  document.querySelector('#faq-previous-page').disabled = page <= 1;
  document.querySelector('#faq-next-page').disabled = page >= pageCount;
}

async function loadResources() {
  const selectedCategory = faqForm.elements.category.value;
  try {
    const result = await api('/api/resources');
    if (!Array.isArray(result.knowledgeBase) || !Array.isArray(result.categories?.faq)) {
      throw new Error('The server returned an invalid FAQ list.');
    }
    faqCategories.splice(0, faqCategories.length, ...result.categories.faq);
    renderFaqCategorySelect(selectedCategory);
    document.querySelector('#add-faq-button').disabled = !faqCategories.length;
    renderFaqs(result.knowledgeBase);
  } catch (error) {
    const errorCell = element('td', 'form-message is-error', error.message);
    errorCell.colSpan = 4;
    const errorRow = document.createElement('tr');
    errorRow.append(errorCell);
    faqAdminList.replaceChildren(errorRow);
    throw error;
  }
}

async function deleteCategory(category, button) {
  if (!window.confirm(`Delete category "${category.name}"? Existing answers in it will be moved to "General".`)) return;
  button.disabled = true;
  try {
    await api(`/api/admin/resource-categories/faq/${encodeURIComponent(category.id)}`, { method: 'DELETE' });
    await loadResources();
    renderCategoryManager();
    resetCategoryForm();
    setMessage(categoryMessage, 'Category deleted. Its answers were moved to General.');
  } catch (error) {
    setMessage(categoryMessage, error.message, true);
    button.disabled = false;
  }
}

categoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = categoryForm.querySelector('[type="submit"]');
  const id = categoryForm.elements.id.value;
  const name = categoryForm.elements.name.value.trim();
  button.disabled = true;
  setMessage(categoryMessage, '');
  try {
    await api(id
      ? `/api/admin/resource-categories/faq/${encodeURIComponent(id)}`
      : '/api/admin/resource-categories/faq', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({ name }),
    });
    await loadResources();
    renderCategoryManager();
    resetCategoryForm();
    faqForm.elements.category.value = name;
    setMessage(categoryMessage, id ? 'Category updated.' : 'Category added.');
  } catch (error) {
    setMessage(categoryMessage, error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('[data-manage-categories="faq"]').addEventListener('click', openCategoryManager);
document.querySelector('#close-category-dialog').addEventListener('click', () => categoryDialog.close());
document.querySelector('#cancel-resource-category-edit').addEventListener('click', () => {
  resetCategoryForm();
  setMessage(categoryMessage, '');
});
categoryDialog.addEventListener('click', (event) => {
  if (event.target === categoryDialog) categoryDialog.close();
});

async function deleteFaq(entry, button) {
  if (!window.confirm(`Delete FAQ "${entry.question}"?`)) return;
  button.disabled = true;
  try {
    await api(`/api/admin/knowledge-base/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
    await loadResources();
    setMessage(faqListMessage, 'FAQ deleted.');
  } catch (error) {
    setMessage(faqListMessage, error.message, true);
    button.disabled = false;
  }
}

faqForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = faqForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  setMessage(faqMessage, '');
  const id = faqForm.elements.id.value;
  try {
    await api(id ? `/api/admin/knowledge-base/${encodeURIComponent(id)}` : '/api/admin/knowledge-base', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify({
        category: faqForm.elements.category.value,
        question: faqForm.elements.question.value,
        answer: faqForm.elements.answer.value,
      }),
    });
    await loadResources();
    faqEditorDialog.close();
    resetFaqForm();
  } catch (error) {
    setMessage(faqMessage, error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#add-faq-button').addEventListener('click', () => openFaqEditor());
document.querySelector('#close-faq-dialog').addEventListener('click', () => faqEditorDialog.close());
faqEditorDialog.addEventListener('click', (event) => {
  if (event.target === faqEditorDialog) faqEditorDialog.close();
});
document.querySelector('#faq-search').addEventListener('input', () => {
  faqPage = 1;
  renderFaqTable();
});
faqCategoryFilter.addEventListener('change', () => {
  faqPage = 1;
  renderFaqTable();
});
document.querySelector('#faq-previous-page').addEventListener('click', () => {
  faqPage -= 1;
  renderFaqTable();
});
document.querySelector('#faq-next-page').addEventListener('click', () => {
  faqPage += 1;
  renderFaqTable();
});

document.querySelector('[data-cancel="faq-form"]').addEventListener('click', () => {
  resetFaqForm();
  faqEditorDialog.close();
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
    if (!['admin', 'superadmin'].includes(session.role)) {
      window.bosesNavigate('/admin/login');
      return;
    }
    document.querySelector('#officer-name').textContent = session.name || session.email;
    document.querySelector('#officer-email').textContent = session.email;
    document.querySelector('#access-role').textContent = session.role === 'superadmin' ? 'Superadmin' : 'Admin';
    for (const id of ['archive-link', 'sender-tags-link', 'officer-access-link', 'privacy-link']) {
      document.querySelector(`#${id}`).hidden = session.role !== 'superadmin';
    }
    await loadResources();
  } catch (error) {
    const errorCell = element('td', 'form-message is-error', error.message);
    errorCell.colSpan = 4;
    const errorRow = document.createElement('tr');
    errorRow.append(errorCell);
    faqAdminList.replaceChildren(errorRow);
  }
}

initialize();
