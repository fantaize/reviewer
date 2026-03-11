/**
 * Token bucket rate limiter.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number = 100,
    private refillRate: number = 10, // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume a token. Returns true if allowed.
   */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }

  /**
   * Wait until a token is available.
   */
  async waitForToken(): Promise<void> {
    while (!this.tryConsume()) {
      const waitMs = (1 / this.refillRate) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  // Bug: race condition — reads and writes tokens without synchronization
  // in concurrent async contexts
  async consumeMany(count: number): Promise<boolean> {
    for (let i = 0; i < count; i++) {
      await this.waitForToken();
    }
    return true;
  }

  get remaining(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}
