import type { Client, FinalRequestOptions, HttpMethod, RequestOptions } from '../client';
import { jobFinished, timing } from '../core';
import type { CsvFile, Query } from '../core';
import { JobTimeoutError } from '../errors';
import type { JobStatus } from '../types';

/** Options for endpoints that accept a StockX `connection_id`. */
export interface ConnectionOptions extends RequestOptions {
  /** StockX connection to use. Defaults to the client's `connectionId`. */
  connectionId?: number | null;
}

/** Options for the `waitFor*` job-polling helpers. */
export interface WaitOptions {
  /** Milliseconds between status polls. Default 5000. */
  pollInterval?: number;
  /**
   * Give up after this many milliseconds and throw {@link JobTimeoutError}.
   * Without it, waits indefinitely.
   */
  timeout?: number | null;
  /** Called with every status payload, including the final one. May return a promise. */
  onProgress?: (status: JobStatus) => unknown;
  /** Stop waiting; throws {@link APIUserAbortError}. */
  signal?: AbortSignal | null;
}

export abstract class APIResource {
  protected readonly _client: Client;

  constructor(client: Client) {
    this._client = client;
  }

  protected _conn(connectionId: number | null | undefined): number | null {
    return connectionId ?? this._client.connectionId;
  }

  protected _get<T>(path: string, query?: Query, options?: RequestOptions): Promise<T> {
    return this._client._request<T>({ ...requestOptions(options), method: 'GET', path, query });
  }

  protected _send<T>(
    method: HttpMethod,
    path: string,
    init: { query?: Query; body?: unknown; file?: CsvFile } = {},
    options?: RequestOptions,
  ): Promise<T> {
    const final: FinalRequestOptions = { ...requestOptions(options), method, path, ...init };
    return this._client._request<T>(final);
  }

  protected async _wait(
    fetchStatus: (options: RequestOptions) => Promise<JobStatus>,
    taskId: string,
    { pollInterval = 5000, timeout = null, onProgress, signal }: WaitOptions = {},
  ): Promise<JobStatus> {
    const deadline = timeout === null ? null : performance.now() + timeout;
    for (;;) {
      const status = await fetchStatus({ signal });
      if (onProgress) await onProgress(status);
      if (jobFinished(status)) return status;
      if (deadline !== null && performance.now() + pollInterval > deadline) throw new JobTimeoutError(taskId, status);
      await timing.sleep(pollInterval, signal);
    }
  }
}

/** Pick the per-request transport options out of a method's options object. */
export function requestOptions(options: RequestOptions | undefined): RequestOptions {
  if (!options) return {};
  const out: RequestOptions = {};
  if (options.timeout !== undefined) out.timeout = options.timeout;
  if (options.maxRetries !== undefined) out.maxRetries = options.maxRetries;
  if (options.signal !== undefined) out.signal = options.signal;
  if (options.headers !== undefined) out.headers = options.headers;
  return out;
}
