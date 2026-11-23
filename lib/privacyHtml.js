function sanitizePrivacyHtml(value) {
  const allowedTags = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u',
    'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'br', 'hr',
  ]);
  const voidTags = new Set(['br', 'hr']);
  const stack = [];
  const tokens = value.match(/<\/?[a-z][^>]*>|[^<]+|</gi) || [];
  let sanitized = '';
  for (const token of tokens) {
    const tagMatch = token.match(/^<(\/?)([a-z][a-z0-9]*)\b[^>]*>$/i);
    if (!tagMatch) {
      sanitized += token
        .replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);)/gi, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      continue;
    }

    const closing = Boolean(tagMatch[1]);
    const tagName = tagMatch[2].toLowerCase();
    if (!allowedTags.has(tagName)) continue;
    if (voidTags.has(tagName)) {
      if (!closing) sanitized += `<${tagName}>`;
      continue;
    }
    if (!closing) {
      sanitized += `<${tagName}>`;
      stack.push(tagName);
      continue;
    }
    const openIndex = stack.lastIndexOf(tagName);
    if (openIndex === -1) continue;
    while (stack.length > openIndex) sanitized += `</${stack.pop()}>`;
  }
  while (stack.length) sanitized += `</${stack.pop()}>`;
  return sanitized.trim();
}

module.exports = sanitizePrivacyHtml;
