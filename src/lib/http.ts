export type FetchFn = typeof fetch;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}`);
    this.name = "HttpError";
  }
}

/** GET/POST returning parsed JSON, with a timeout. Never logs headers (they hold tokens). */
export async function fetchJson<T>(fetchFn: FetchFn, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new HttpError(response.status, url);
  return (await response.json()) as T;
}
