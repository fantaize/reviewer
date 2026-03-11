/**
 * Convert a string to a URL-friendly slug.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Truncate a string to a max length, adding ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (maxLength < 4) return str.slice(0, maxLength);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}
