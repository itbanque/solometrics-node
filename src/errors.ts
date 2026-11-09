/**
 * Error hierarchy for the SneakersRadar API.
 *
 * Every non-2xx response throws a subclass of {@link APIStatusError}, chosen by
 * status code. Network failures throw {@link APIConnectionError} (or its
 * {@link APITimeoutError} subclass).
 */

/** Base class for every error thrown by this SDK. */
export class SolometricsError extends Error {
  constructor(message?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** An error talking to the API (network failure or non-2xx response). */
export class APIError extends SolometricsError {}

/** The request never produced a response (DNS, TLS, connection reset, ...). */
export class APIConnectionError extends APIError {
  constructor(message = 'Connection error.', options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** The request timed out on the client side. */
export class APITimeoutError extends APIConnectionError {
  constructor(options?: { cause?: unknown }) {
    super('Request timed out.', options);
  }
}

/** The caller's `AbortSignal` fired before the request (or job wait) finished. */
export class APIUserAbortError extends APIError {
  constructor(options?: { cause?: unknown }) {
    super('Request was aborted.', options);
  }
}

/** One entry of a 422 `detail` list. */
export interface ValidationErrorItem {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * The API returned a non-2xx status.
 *
 * - `status`: HTTP status code.
 * - `detail`: the `detail` field of the JSON error body: a message string, or
 *   a list of field errors for 422. `null` if the body had none.
 * - `body`: the full decoded JSON body (or raw text if it was not JSON).
 * - `headers`: the response headers.
 */
export class APIStatusError extends APIError {
  readonly status: number;
  readonly detail: unknown;
  readonly body: unknown;
  readonly headers: Headers;

  constructor(message: string, init: { status: number; headers: Headers; body: unknown }) {
    super(`${init.status}: ${message}`);
    this.status = init.status;
    this.headers = init.headers;
    this.body = init.body;
    this.detail = isRecord(init.body) && 'detail' in init.body ? init.body.detail : null;
  }
}

/**
 * 400 — invalid request, plan pagination cap, bad CSV, no usable StockX
 * connection, or the connection's daily request cap was reached.
 */
export class BadRequestError extends APIStatusError {}

/** 401 — the API key is missing, invalid or revoked. */
export class AuthenticationError extends APIStatusError {}

/** 403 — the endpoint is not included in the account's plan. */
export class PermissionDeniedError extends APIStatusError {}

/**
 * 404 — style code, size, SKU or record not found (cost endpoints also return
 * 404 when no StockX account is linked).
 */
export class NotFoundError extends APIStatusError {}

/** 409 — keep-listing mode skipped the listing, or a GOAT account is needed but not linked. */
export class ConflictError extends APIStatusError {}

/** 422 — a parameter has the wrong type or is out of range. `errors` holds the field errors. */
export class UnprocessableEntityError extends APIStatusError {
  get errors(): ValidationErrorItem[] {
    return Array.isArray(this.detail) ? (this.detail as ValidationErrorItem[]) : [];
  }
}

/** 429 — rate limit exceeded. `retryAfter` is the `Retry-After` header in seconds, when present. */
export class RateLimitError extends APIStatusError {
  get retryAfter(): number | null {
    return parseRetryAfter(this.headers);
  }
}

/** 5xx not covered by a more specific class. */
export class InternalServerError extends APIStatusError {}

/** 502 — the request to StockX/GOAT failed; `detail` carries the upstream error. */
export class UpstreamError extends InternalServerError {}

/** 504 — StockX did not respond in time. */
export class UpstreamTimeoutError extends InternalServerError {}

/**
 * A `waitFor*` helper gave up before the background job finished.
 * `lastStatus` is the last status payload seen.
 */
export class JobTimeoutError extends SolometricsError {
  readonly taskId: string;
  readonly lastStatus: unknown;

  constructor(taskId: string, lastStatus: unknown) {
    const status = isRecord(lastStatus) ? lastStatus.status : lastStatus;
    super(`Job ${taskId} did not finish in time (last status: ${String(status)})`);
    this.taskId = taskId;
    this.lastStatus = lastStatus;
  }
}

type StatusErrorClass = new (
  message: string,
  init: { status: number; headers: Headers; body: unknown },
) => APIStatusError;

const STATUS_MAP: Record<number, StatusErrorClass> = {
  400: BadRequestError,
  401: AuthenticationError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  422: UnprocessableEntityError,
  429: RateLimitError,
  502: UpstreamError,
  504: UpstreamTimeoutError,
};

/** @internal */
export function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** @internal */
export function makeStatusError(status: number, statusText: string, headers: Headers, text: string): APIStatusError {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text || null;
  }

  const detail = isRecord(body) ? body.detail : undefined;
  let message: string;
  if (typeof detail === 'string') {
    message = detail;
  } else if (Array.isArray(detail)) {
    const parts = detail.map((err) => {
      if (isRecord(err)) {
        const loc = Array.isArray(err.loc) ? err.loc.map(String).join('.') : '';
        return loc ? `${loc}: ${String(err.msg)}` : String(err.msg);
      }
      return String(err);
    });
    message = parts.join('; ') || 'Validation error';
  } else if (typeof body === 'string' && body) {
    message = body.slice(0, 500);
  } else {
    message = statusText || 'API error';
  }

  const cls = STATUS_MAP[status] ?? (status >= 500 ? InternalServerError : APIStatusError);
  return new cls(message, { status, headers, body });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
