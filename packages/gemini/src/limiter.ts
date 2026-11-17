/** Simple token bucket: `ratePerSec` sustained, `burst` max. Serializes waits. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private queue: Promise<void> = Promise.resolve();
  constructor(private ratePerSec: number, private burst: number) {
    this.tokens = burst;
  }
  take(): Promise<void> {
    const next = this.queue.then(async () => {
      for (;;) {
        const now = Date.now();
        this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
        this.last = now;
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return;
        }
        await new Promise((r) => setTimeout(r, Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000)));
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
