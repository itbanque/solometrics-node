/** Transport-independent helpers shared by the client and the resources. @internal */

import { APIUserAbortError } from './errors';

export const DEFAULT_BASE_URL = 'https://api.sneakers.itbanque.com';
/** Milliseconds. */
export const DEFAULT_TIMEOUT = 60_000;
export const DEFAULT_MAX_RETRIES = 2;
export const API_KEY_ENV = 'SOLOMETRICS_API_KEY';
export const BASE_URL_ENV = 'SOLOMETRICS_BASE_URL';

/** Background-job statuses after which polling stops. */
const TERMINAL_JOB_STATUSES = new Set(['SUCCESS', 'FAILURE', 'CANCELLED']);

/**
 * Methods the API treats as safe to repeat. POST is excluded: retrying a
 * create-listing call after a 502/504 could list the same pair twice.
 */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']);

const MAX_BACKOFF_MS = 8_000;
const MAX_RETRY_AFTER_MS = 60_000;

/** A price. Sent to the API as a string: `250`, `250.0` and `"250"` all become `"250"`. */
export type Amount = number | string | bigint;
/** A shoe size, e.g. `10`, `"10.5"`, `"10W"`. */
export type Size = number | string;
/** `"2026-01-01"` or a `Date` (formatted as its UTC calendar date). */
export type DateLike = string | Date;

export type QueryPrimitive = string | number | boolean | Date;
export type QueryValue = QueryPrimitive | readonly QueryPrimitive[] | null | undefined;
export type Query = Record<string, QueryValue>;

/**
 * A CSV for an upload endpoint:
 *
 * - a file path (`string`);
 * - the CSV content as a `Uint8Array` / `Buffer` / `ArrayBuffer`;
 * - a `Blob` or `File` (a `File`'s name is kept);
 * - a Node readable stream (e.g. `fs.createReadStream(...)`), web `ReadableStream`, or any
 *   async iterable of chunks;
 * - `{ rows }`: objects that become CSV rows (header = union of keys, in first-seen order).
 */
export type CsvSource =
  | string
  | Uint8Array
  | ArrayBuffer
  | Blob
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array | string>
  | { rows: Iterable<CsvRow> };

export type CsvRow = Record<string, unknown>;

export interface CsvFile {
  name: string;
  content: Uint8Array;
}

export function readEnv(name: string): string | undefined {
  const value = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  return value || undefined;
}

// ----------------------------------------------------------------------- formatting

export function formatAmount(amount: Amount): string {
  if (typeof amount === 'boolean') throw new TypeError('amount must be a number or string, not boolean');
  if (typeof amount === 'number' && !Number.isFinite(amount)) throw new TypeError(`Invalid amount: ${amount}`);
  return String(amount);
}

export function formatSize(size: Size): string {
  return String(size);
}

export function formatDate(value: DateLike): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

export function formatDateTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Percent-encode a value for use as a single path segment. */
export function pathSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

function queryString(value: QueryPrimitive): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return formatDate(value);
  return String(value);
}

/** Build `base + path` with the query string; `null`/`undefined` values are dropped. */
export function buildURL(baseURL: string, path: string, query: Query | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value as readonly QueryPrimitive[]) params.append(key, queryString(item));
    } else {
      params.append(key, queryString(value as QueryPrimitive));
    }
  }
  const qs = params.toString();
  return `${baseURL}${path}${qs ? `?${qs}` : ''}`;
}

/**
 * Drop `undefined` and `null` values from a JSON body: no documented body field
 * accepts `null`.
 */
export function cleanBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

export function joinStatuses(statuses: string | readonly string[] | undefined | null): string | undefined {
  if (statuses === undefined || statuses === null) return undefined;
  return typeof statuses === 'string' ? statuses : statuses.join(',');
}

// ----------------------------------------------------------------------- batch delete

/**
 * A listing to delete: a listing ID, a `[listingId, variantId]` tuple, or an
 * object with `listingId`/`listing_id` and optional `variantId`/`variant_id`.
 */
export type BatchDeleteItem =
  | string
  | readonly [listingId: string, variantId?: string | null]
  | { listingId: string; variantId?: string | null }
  | { listing_id: string; variant_id?: string | null };

export function normalizeBatchDeleteItems(
  items: Iterable<BatchDeleteItem>,
): { listingId: string; variantId?: string }[] {
  const out: { listingId: string; variantId?: string }[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      out.push({ listingId: item });
      continue;
    }
    let listingId: unknown;
    let variantId: unknown;
    if (Array.isArray(item)) {
      [listingId, variantId] = item as readonly unknown[];
    } else if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      listingId = obj.listingId ?? obj.listing_id;
      variantId = obj.variantId ?? obj.variant_id;
    } else {
      throw new TypeError(`Unsupported batch-delete item: ${JSON.stringify(item)}`);
    }
    if (!listingId) throw new TypeError(`Batch-delete item is missing a listing ID: ${JSON.stringify(item)}`);
    const entry: { listingId: string; variantId?: string } = { listingId: String(listingId) };
    if (variantId) entry.variantId = String(variantId);
    out.push(entry);
  }
  if (out.length === 0) throw new TypeError('`items` is empty.');
  return out;
}

// ----------------------------------------------------------------------- CSV uploads

const encoder = new TextEncoder();

function isRowsSource(source: CsvSource): source is { rows: Iterable<CsvRow> } {
  return (
    typeof source === 'object' &&
    source !== null &&
    !(source instanceof Uint8Array) &&
    !(source instanceof ArrayBuffer) &&
    !(typeof Blob !== 'undefined' && source instanceof Blob) &&
    'rows' in source
  );
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

async function collect(chunks: AsyncIterable<Uint8Array | string>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of chunks) {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : new Uint8Array(chunk);
    parts.push(bytes);
    length += bytes.length;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function* readWebStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Turn a {@link CsvSource} into an in-memory file, so the request can be
 * retried. The API only accepts file names ending in `.csv`.
 */
export async function prepareCsvUpload(source: CsvSource, defaultName: string): Promise<CsvFile> {
  if (source === undefined || source === null) {
    throw new TypeError('Pass a CSV file (path, bytes, Blob or stream) or `{ rows }`.');
  }

  let name = defaultName;
  let content: Uint8Array;

  if (typeof source === 'string') {
    const { readFile } = await import('node:fs/promises');
    content = new Uint8Array(await readFile(source));
    name = basename(source);
  } else if (source instanceof Uint8Array) {
    content = source;
  } else if (source instanceof ArrayBuffer) {
    content = new Uint8Array(source);
  } else if (typeof Blob !== 'undefined' && source instanceof Blob) {
    content = new Uint8Array(await source.arrayBuffer());
    const fileName = (source as { name?: unknown }).name;
    if (typeof fileName === 'string' && fileName) name = basename(fileName);
  } else if (isRowsSource(source)) {
    content = rowsToCsv(source.rows);
  } else if (typeof (source as ReadableStream).getReader === 'function') {
    content = await collect(readWebStream(source as ReadableStream<Uint8Array>));
  } else if (typeof (source as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
    content = await collect(source as AsyncIterable<Uint8Array | string>);
    const path = (source as { path?: unknown }).path; // fs.ReadStream
    if (typeof path === 'string' && path) name = basename(path);
  } else {
    throw new TypeError(`Unsupported CSV source: ${Object.prototype.toString.call(source)}`);
  }

  if (!name.toLowerCase().endsWith('.csv')) name = `${name}.csv`;
  return { name, content };
}

function csvField(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows: Iterable<CsvRow>): Uint8Array {
  const list = Array.from(rows);
  if (list.length === 0) throw new TypeError('`rows` is empty.');
  const header: string[] = [];
  const seen = new Set<string>();
  for (const row of list) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        header.push(key);
      }
    }
  }
  const lines = [header.map(csvField).join(',')];
  for (const row of list) lines.push(header.map((key) => csvField(row[key])).join(','));
  return encoder.encode(`${lines.join('\n')}\n`);
}

// ----------------------------------------------------------------------- retries

/** Why a request produced no response. */
export type NetworkErrorKind = 'connect' | 'timeout' | 'network';

/** Error codes meaning the request never reached the server. */
const CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function errorCodes(err: unknown, depth = 0): string[] {
  if (typeof err !== 'object' || err === null || depth > 3) return [];
  const e = err as { code?: unknown; cause?: unknown; errors?: unknown };
  const codes = typeof e.code === 'string' ? [e.code] : [];
  if (Array.isArray(e.errors)) for (const inner of e.errors) codes.push(...errorCodes(inner, depth + 1));
  codes.push(...errorCodes(e.cause, depth + 1));
  return codes;
}

/** Classify an error thrown by `fetch` (or while reading the body). */
export function classifyNetworkError(err: unknown): NetworkErrorKind {
  const codes = errorCodes(err);
  if (codes.length > 0 && codes.every((code) => CONNECT_ERROR_CODES.has(code))) return 'connect';
  return 'network';
}

export function shouldRetryStatus(method: string, status: number): boolean {
  if (status === 429) return true;
  if (status === 502 || status === 503 || status === 504) return IDEMPOTENT_METHODS.has(method.toUpperCase());
  return false;
}

export function shouldRetryNetworkError(method: string, kind: NetworkErrorKind): boolean {
  // A connect failure means the request never reached the server, so it is
  // always safe to repeat. A timeout or dropped connection may have been
  // processed already.
  if (kind === 'connect') return true;
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

/** Milliseconds to wait before retry number `attempt` (0-based). */
export function retryDelay(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null) return Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
  const base = Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
  return base * (0.75 + Math.random() * 0.5);
}

export function jobFinished(payload: unknown): boolean {
  const status = typeof payload === 'object' && payload !== null ? (payload as { status?: unknown }).status : undefined;
  return typeof status === 'string' && TERMINAL_JOB_STATUSES.has(status.toUpperCase());
}

function defaultSleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new APIUserAbortError({ cause: signal.reason }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new APIUserAbortError({ cause: signal?.reason }));
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Indirection so tests can skip real waits. */
export const timing = {
  sleep: defaultSleep,
};
