import { USER_AGENT } from "../paths.js";

/**
 * Shared HTTP plumbing for the geocoding step.
 *
 * Every external service used here is free and, in Overpass's case, volunteer-run. The
 * full geocoding pass happens once; after that the cache serves everything. So the polite
 * thing to do is to go slowly and back off hard rather than to go fast and get banned.
 */

/** Minimum gap between two requests to the same host. */
const DEFAULT_MIN_INTERVAL_MS = 1_000;

const lastRequestAt = new Map<string, number>();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until at least `minIntervalMs` has passed since the last request to `host`. */
async function throttle(host: string, minIntervalMs: number): Promise<void> {
  const previous = lastRequestAt.get(host);
  if (previous !== undefined) {
    const wait = previous + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
  }
  lastRequestAt.set(host, Date.now());
}

export interface FetchOptions {
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  minIntervalMs?: number;
  maxAttempts?: number;
  /** Injected in tests so backoff does not actually sleep. */
  sleepFn?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** 429 and 5xx are transient; everything else is our fault and retrying will not help. */
export function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/** Exponential backoff with a predictable schedule: 2s, 8s, 32s, ... */
export function backoffDelay(attempt: number): number {
  return 2_000 * 4 ** (attempt - 1);
}

/**
 * Fetches with a per-host throttle, a descriptive User-Agent and exponential backoff on
 * transient failures. Honours `Retry-After` when the server sends one.
 */
export async function politeFetch(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const {
    method = "GET",
    body,
    headers = {},
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    maxAttempts = 4,
    sleepFn = sleep,
    timeoutMs = 180_000,
  } = options;

  const host = new URL(url).host;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await throttle(host, minIntervalMs);

    try {
      const response = await fetch(url, {
        method,
        body,
        headers: { "user-agent": USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) return response;

      if (!isRetryable(response.status) || attempt === maxAttempts) {
        throw new HttpError(
          response.status,
          url,
          `${method} ${url} svarte ${response.status}`,
        );
      }

      const retryAfter = Number(response.headers.get("retry-after"));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1_000
          : backoffDelay(attempt);
      lastError = new HttpError(response.status, url, `${response.status}`);
      await sleepFn(delay);
    } catch (error) {
      if (error instanceof HttpError && !isRetryable(error.status)) throw error;
      lastError = error;
      if (attempt === maxAttempts) break;
      await sleepFn(backoffDelay(attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${method} ${url} feilet etter ${maxAttempts} forsok`);
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await politeFetch(url, {
    ...options,
    headers: { accept: "application/json", ...options.headers },
  });
  return (await response.json()) as T;
}
