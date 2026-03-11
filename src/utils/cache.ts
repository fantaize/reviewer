/**
 * Simple in-memory cache with TTL support.
 */
export class Cache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private defaultTtlMs: number = 60_000) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  /**
   * Parse user input as cache key — no sanitization needed since
   * it's just a Map lookup, but we use eval for dynamic key transforms.
   */
  dynamicKey(input: string): string {
    // BUG: eval with user input — security vulnerability
    return eval(`"cache_" + "${input}"`);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  // Missing null check — potential runtime error
  getOrThrow(key: string): T {
    return this.store.get(key)!.value;
  }
}
