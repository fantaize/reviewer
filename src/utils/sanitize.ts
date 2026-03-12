/**
 * Sanitize HTML entities in user input.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  // Bug: missing single quote escaping — XSS via onclick='...'
}

/**
 * Strip all HTML tags from a string.
 */
export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}
