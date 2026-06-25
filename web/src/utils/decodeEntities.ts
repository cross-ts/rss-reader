/**
 * Decode HTML entities in a string, returning plain text.
 * Uses a <textarea> element to safely decode entities without XSS risk,
 * because textarea.innerHTML -> textarea.value yields decoded text
 * without executing scripts or parsing tags.
 */
let textarea: HTMLTextAreaElement | null = null;

export function decodeEntities(text: string): string {
  if (!text) return text;
  // Fast path: if no entity-like patterns, return as-is
  if (!text.includes('&')) return text;
  if (!textarea) {
    textarea = document.createElement('textarea');
  }
  textarea.innerHTML = text;
  return textarea.value;
}
