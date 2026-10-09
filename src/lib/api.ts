export class ApiError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;
  constructor(status: number, code: string, data: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Opts {
  idempotencyKey?: string;
  body?: unknown;
  token?: string | null;
  /** Retries on network errors and 5xx (weak venue Wi-Fi). Only for idempotent calls. */
  retries?: number;
  onRetry?: (attempt: number) => void;
}

export async function api<T>(path: string, o: Opts = {}): Promise<T> {
  const retries = o.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(path, {
        method: o.body === undefined ? 'GET' : 'POST',
        headers: {
          ...(o.idempotencyKey ? { 'idempotency-key': o.idempotencyKey } : {}),
          ...(o.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        },
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return (await res.json()) as T;
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status < 500 || attempt >= retries) throw new ApiError(res.status, String(data.error ?? `http_${res.status}`), data);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (attempt >= retries) throw new ApiError(0, 'network');
    }
    o.onRetry?.(attempt + 1);
    await sleep(Math.min(4000, 600 * 2 ** attempt));
  }
}
