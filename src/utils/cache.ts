/**
 * Simple in-memory TTL cache.
 */
export class Cache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Get a value from cache, or compute and store it if missing/expired.
   * If the compute function throws, the error is cached to prevent repeated
   * calls to a failing resource (negative caching).
   */
  async getOrSet(key: string, fn: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    try {
      const value = await fn();
      this.set(key, value);
      return value;
    } catch (err) {
      this.set(key, err as T);
      throw err;
    }
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
