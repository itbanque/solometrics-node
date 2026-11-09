import * as core from './core';
import type { CsvFile, Query } from './core';
import {
  APIConnectionError,
  APITimeoutError,
  APIUserAbortError,
  SolometricsError,
  makeStatusError,
  parseRetryAfter,
} from './errors';
import { GoatResource } from './resources/goat';
import { InventoryResource } from './resources/inventory';
import { StockXResource } from './resources/stockx';
import { VERSION } from './version';

/** A `fetch`-compatible function. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ClientOptions {
  /** Your `sr_live_...` key. Defaults to `process.env.SOLOMETRICS_API_KEY`. */
  apiKey?: string;
  /** Defaults to `process.env.SOLOMETRICS_BASE_URL` or `https://api.sneakers.itbanque.com`. */
  baseURL?: string;
  /** Per-attempt timeout in milliseconds, including reading the body. Default 60 000. `null` disables it. */
  timeout?: number | null;
  /**
   * Retries for 429 (all methods), and for 502/503/504, timeouts and dropped
   * connections on idempotent methods. Default 2. `0` disables.
   */
  maxRetries?: number;
  /** Default StockX connection for endpoints that accept `connectionId`. Per-call values override it. */
  connectionId?: number | null;
  /** Extra headers sent with every request. */
  defaultHeaders?: Record<string, string>;
  /** Bring your own `fetch` (proxies, custom agents, instrumentation, ...). Defaults to `globalThis.fetch`. */
  fetch?: Fetch;
}

/** Per-call options accepted by every API method. */
export interface RequestOptions {
  /** Override the client's per-attempt timeout (milliseconds); `null` disables it. */
  timeout?: number | null;
  /** Override the client's `maxRetries`. */
  maxRetries?: number;
  /** Abort the request; throws {@link APIUserAbortError}. */
  signal?: AbortSignal | null;
  /** Extra headers for this request. */
  headers?: Record<string, string>;
}

/** Options for the low-level {@link Client.get} / {@link Client.post} / ... methods. */
export interface RawRequestOptions extends RequestOptions {
  query?: Query;
  /** JSON body. */
  body?: unknown;
}

/** @internal */
export interface FinalRequestOptions extends RequestOptions {
  method: HttpMethod;
  path: string;
  query?: Query;
  body?: unknown;
  file?: CsvFile;
}

const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * SneakersRadar API client.
 *
 * ```ts
 * const client = new Client({ apiKey: 'sr_live_...' }); // or set SOLOMETRICS_API_KEY
 * const quotes = await client.stockx.market.search('DZ5485-612');
 * ```
 *
 * There is nothing to close: requests go through `fetch`.
 */
export class Client {
  readonly baseURL: string;
  readonly timeout: number | null;
  readonly maxRetries: number;
  readonly connectionId: number | null;

  readonly inventory: InventoryResource;
  readonly stockx: StockXResource;
  readonly goat: GoatResource;

  readonly #apiKey: string;
  readonly #customHeaders: Record<string, string>;
  readonly #fetch: Fetch;

  constructor(options?: ClientOptions);
  constructor(apiKey: string, options?: Omit<ClientOptions, 'apiKey'>);
  constructor(apiKeyOrOptions: string | ClientOptions = {}, maybeOptions: Omit<ClientOptions, 'apiKey'> = {}) {
    const options: ClientOptions =
      typeof apiKeyOrOptions === 'string' ? { ...maybeOptions, apiKey: apiKeyOrOptions } : apiKeyOrOptions;

    const apiKey = options.apiKey || core.readEnv(core.API_KEY_ENV);
    if (!apiKey) {
      throw new SolometricsError(
        `No API key provided. Pass { apiKey: '...' } or set the ${core.API_KEY_ENV} environment variable.`,
      );
    }
    this.#apiKey = apiKey;
    this.baseURL = (options.baseURL || core.readEnv(core.BASE_URL_ENV) || core.DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout === undefined ? core.DEFAULT_TIMEOUT : options.timeout;
    this.maxRetries = options.maxRetries ?? core.DEFAULT_MAX_RETRIES;
    this.connectionId = options.connectionId ?? null;
    this.#customHeaders = { ...options.defaultHeaders };

    if (options.fetch) {
      this.#fetch = options.fetch;
    } else if (typeof globalThis.fetch === 'function') {
      this.#fetch = (url, init) => globalThis.fetch(url, init);
    } else {
      throw new SolometricsError('`fetch` is not available; use Node.js 18+ or pass { fetch } in the client options.');
    }

    this.inventory = new InventoryResource(this);
    this.stockx = new StockXResource(this);
    this.goat = new GoatResource(this);
  }

  get apiKey(): string {
    return this.#apiKey;
  }

  /**
   * Return a copy with some options changed. The copy shares `fetch` and the
   * default headers. Pass `connectionId: null` to clear the default connection.
   */
  withOptions(options: Pick<ClientOptions, 'apiKey' | 'timeout' | 'maxRetries' | 'connectionId'>): Client {
    return new Client({
      apiKey: options.apiKey || this.#apiKey,
      baseURL: this.baseURL,
      timeout: options.timeout === undefined ? this.timeout : options.timeout,
      maxRetries: options.maxRetries ?? this.maxRetries,
      connectionId: options.connectionId === undefined ? this.connectionId : options.connectionId,
      defaultHeaders: this.#customHeaders,
      fetch: this.#fetch,
    });
  }

  // ------------------------------------------------------------------ low-level requests

  /** Low-level GET for endpoints the SDK does not wrap yet. */
  get<T = unknown>(path: string, options: RawRequestOptions = {}): Promise<T> {
    return this._request<T>({ ...options, method: 'GET', path });
  }

  post<T = unknown>(path: string, options: RawRequestOptions = {}): Promise<T> {
    return this._request<T>({ ...options, method: 'POST', path });
  }

  put<T = unknown>(path: string, options: RawRequestOptions = {}): Promise<T> {
    return this._request<T>({ ...options, method: 'PUT', path });
  }

  patch<T = unknown>(path: string, options: RawRequestOptions = {}): Promise<T> {
    return this._request<T>({ ...options, method: 'PATCH', path });
  }

  delete<T = unknown>(path: string, options: RawRequestOptions = {}): Promise<T> {
    return this._request<T>({ ...options, method: 'DELETE', path });
  }

  /** @internal */
  async _request<T>(options: FinalRequestOptions): Promise<T> {
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const timeout = options.timeout === undefined ? this.timeout : options.timeout;
    const url = core.buildURL(this.baseURL, options.path, options.query);
    const userSignal = options.signal ?? undefined;

    for (let attempt = 0; ; attempt++) {
      if (userSignal?.aborted) throw new APIUserAbortError({ cause: userSignal.reason });

      const controller = new AbortController();
      let timedOut = false;
      const timer =
        timeout !== null && Number.isFinite(timeout)
          ? setTimeout(
              () => {
                timedOut = true;
                controller.abort();
              },
              Math.min(Math.max(timeout, 0), MAX_TIMER_MS),
            )
          : undefined;
      const onUserAbort = () => controller.abort(userSignal?.reason);
      userSignal?.addEventListener('abort', onUserAbort, { once: true });

      let response: Response;
      let text: string;
      try {
        response = await this.#fetch(url, {
          method: options.method,
          headers: this.#headers(options),
          body: this.#body(options),
          signal: controller.signal,
        });
        text = await response.text();
      } catch (err) {
        if (userSignal?.aborted) throw new APIUserAbortError({ cause: err });
        const kind: core.NetworkErrorKind = timedOut ? 'timeout' : core.classifyNetworkError(err);
        if (attempt < maxRetries && core.shouldRetryNetworkError(options.method, kind)) {
          await core.timing.sleep(core.retryDelay(attempt, null), userSignal);
          continue;
        }
        if (kind === 'timeout') throw new APITimeoutError({ cause: err });
        throw new APIConnectionError(connectionErrorMessage(err), { cause: err });
      } finally {
        clearTimeout(timer);
        userSignal?.removeEventListener('abort', onUserAbort);
      }

      if (response.ok) return parseBody(response.status, text) as T;

      if (attempt < maxRetries && core.shouldRetryStatus(options.method, response.status)) {
        const retryAfter = parseRetryAfter(response.headers);
        await core.timing.sleep(core.retryDelay(attempt, retryAfter), userSignal);
        continue;
      }
      throw makeStatusError(response.status, response.statusText, response.headers, text);
    }
  }

  #headers(options: FinalRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      'X-API-Key': this.#apiKey,
      Accept: 'application/json',
      'User-Agent': `solometrics-node/${VERSION}`,
    };
    if (options.body !== undefined && !options.file) headers['Content-Type'] = 'application/json';
    return { ...headers, ...this.#customHeaders, ...options.headers };
  }

  /** Built per attempt, so a multipart body can be resent on retry. */
  #body(options: FinalRequestOptions): BodyInit | undefined {
    if (options.file) {
      const form = new FormData();
      form.append(
        'file',
        new Blob([options.file.content as Uint8Array<ArrayBuffer>], { type: 'text/csv' }),
        options.file.name,
      );
      return form;
    }
    return options.body === undefined ? undefined : JSON.stringify(options.body);
  }

  toString(): string {
    return `Client { baseURL: '${this.baseURL}' }`;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

function parseBody(status: number, text: string): unknown {
  if (status === 204 || text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function connectionErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? `: ${err.cause.message}` : '';
    return `${err.message}${cause}` || 'Connection error.';
  }
  return 'Connection error.';
}
