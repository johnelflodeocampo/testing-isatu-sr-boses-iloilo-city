(() => {
  const allowedTags = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u',
    'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'br', 'hr',
  ]);

  function copySafeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    const tagName = node.tagName.toLowerCase();
    const output = allowedTags.has(tagName)
      ? document.createElement(tagName)
      : document.createDocumentFragment();
    for (const child of node.childNodes) output.append(copySafeNode(child));
    return output;
  }

  function sanitize(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    const container = document.createElement('div');
    for (const node of template.content.childNodes) container.append(copySafeNode(node));
    return container.innerHTML;
  }

  window.BosesPrivacyHtml = Object.freeze({ sanitize });
})();
