const knowledgeBaseList = document.querySelector('#knowledge-base-list');
const faqSearch = document.querySelector('#faq-search');
const faqCount = document.querySelector('#faq-count');
let knowledgeBaseEntries = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderKnowledgeBase() {
  const query = faqSearch.value.trim().toLocaleLowerCase();
  const entries = knowledgeBaseEntries.filter((entry) => (
    `${entry.category} ${entry.question} ${entry.answer}`.toLocaleLowerCase().includes(query)
  ));
  faqCount.textContent = `${entries.length} ${entries.length === 1 ? 'answer' : 'answers'}`;
  if (!entries.length) {
    knowledgeBaseList.replaceChildren(element(
      'p',
      'empty-state',
      knowledgeBaseEntries.length ? 'No answers match your search.' : 'No answers have been published yet.',
    ));
    return;
  }
  knowledgeBaseList.replaceChildren(...entries.map((entry) => {
    const details = document.createElement('details');
    details.className = 'resource-faq-item';
    const summary = element('summary', '', entry.question);
    details.append(
      summary,
      element('span', 'resource-category', entry.category),
      element('p', 'resource-answer', entry.answer),
    );
    return details;
  }));
}

async function loadResources() {
  try {
    const response = await fetch('/api/resources', { credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load FAQs.');
    if (!Array.isArray(result.knowledgeBase)) {
      throw new Error('The server returned an invalid FAQ list.');
    }
    knowledgeBaseEntries = result.knowledgeBase;
    renderKnowledgeBase();
  } catch (error) {
    knowledgeBaseList.replaceChildren(element('p', 'form-message is-error', error.message));
  }
}

faqSearch.addEventListener('input', renderKnowledgeBase);
loadResources();
