import { Client } from '../src';
import type { ClientOptions, Fetch } from '../src';

export const BASE = 'https://api.test';

export interface Recorded {
  method: string;
  url: URL;
  rawUrl: string;
  headers: Headers;
  body: string;
}

type Handler = (req: Recorded, init: RequestInit) => Response | Promise<Response>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Collects requests and answers them with a swappable handler. */
export class Recorder {
  requests: Recorded[] = [];
  handler: Handler = () => json(200, {});

  readonly fetch: Fetch = async (url, init) => {
    const request = new Request(url, { ...init, signal: undefined });
    const recorded: Recorded = {
      method: request.method,
      url: new URL(url),
      rawUrl: url,
      headers: request.headers,
      body: await request.text(),
    };
    this.requests.push(recorded);
    return this.handler(recorded, init);
  };

  get last(): Recorded {
    const last = this.requests[this.requests.length - 1];
    if (!last) throw new Error('no requests recorded');
    return last;
  }

  lastJson(): unknown {
    return JSON.parse(this.last.body);
  }

  params(req: Recorded = this.last): Record<string, string> {
    return Object.fromEntries(req.url.searchParams);
  }
}

export function makeClient(rec: Recorder, options: ClientOptions = {}): Client {
  return new Client({ apiKey: 'sr_live_test', baseURL: BASE, fetch: rec.fetch, ...options });
}

/** An undici-style `fetch failed` error. */
export function fetchFailed(code: string): TypeError {
  const cause = Object.assign(new Error(`connect ${code} 127.0.0.1:443`), { code });
  return new TypeError('fetch failed', { cause });
}

/** A handler that never answers until the request is aborted. */
export function hang(_req: Recorded, init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}
