/**
 * Conservative HTTP client for public/government APIs: timeout, a fixed
 * minimum gap between requests, at most 3 retries on 429/5xx/network
 * errors with Retry-After or exponential backoff. Never hammers a source.
 */
export class PoliteHttpClient {
  private lastRequestAt = 0;

  constructor(
    private readonly minGapMs: number,
    private readonly timeoutMs = 30_000,
    private readonly maxRetries = 3,
  ) {}

  async getJson(url: string): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      await this.pace();
      let res: Response;
      try {
        res = await fetch(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { Accept: 'application/json' },
        });
      } catch (error) {
        if (attempt++ >= this.maxRetries)
          throw new Error(
            `Network error after ${attempt} attempts: ${(error as Error).name}`,
          );
        await sleep(5_000 * 2 ** attempt);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt++ >= this.maxRetries)
          throw new Error(`HTTP ${res.status} after ${attempt} attempts`);
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 10_000 * 2 ** (attempt - 1),
        );
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(
          'Malformed JSON response (possibly a partial download)',
        );
      }
    }
  }

  private async pace() {
    const wait = this.lastRequestAt + this.minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
