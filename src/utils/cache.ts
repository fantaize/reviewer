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

  dynamicKey(input: string): string {
    return `cache_${input}`;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  getOrThrow(key: string): T {
    const value = this.get(key);
    if (value === undefined) {
      throw new Error(`Cache miss: key "${key}" not found or expired`);
    }
    return value;
  }
}
