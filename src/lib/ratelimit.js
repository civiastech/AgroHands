// Fixed-window rate limiter held in memory. Right for a single-instance SQLite app; swap the store for
// Redis if you ever run several app instances behind one load balancer.

export class RateLimiter {
  constructor({ max, windowSec, now = () => Date.now() }) {
    this.max = max;
    this.windowMs = windowSec * 1000;
    this.now = now;
    this.hits = new Map();
    // Sweep expired buckets so memory stays flat under a flood of unique IPs.
    this.timer = setInterval(() => this.sweep(), Math.min(this.windowMs, 60000));
    this.timer.unref();
  }

  /** Counts a hit. Returns { ok, remaining, retryAfterSec }. */
  hit(key) {
    const t = this.now();
    let b = this.hits.get(key);
    if (!b || b.reset <= t) {
      b = { count: 0, reset: t + this.windowMs };
      this.hits.set(key, b);
    }
    b.count++;
    const ok = b.count <= this.max;
    return { ok, remaining: Math.max(0, this.max - b.count), retryAfterSec: ok ? 0 : Math.ceil((b.reset - t) / 1000) };
  }

  sweep() {
    const t = this.now();
    for (const [k, b] of this.hits) if (b.reset <= t) this.hits.delete(k);
  }

  reset() {
    this.hits.clear();
  }

  stop() {
    clearInterval(this.timer);
  }
}
