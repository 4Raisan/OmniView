import DOMPurify from 'dompurify';

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

export function sanitizeDocument(html) {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'style', 'link', 'meta'],
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false
  });
}

// docx-preview expresses page layout, fonts and spacing through <style> blocks and
// style attributes, so those must survive. Only active content is removed.
export function sanitizeRenderedDocument(html) {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'],
    ALLOW_DATA_ATTR: false
  });
}
