import type { RequestOptions } from '../../client';
import {
  cleanBody,
  formatAmount,
  formatDateTime,
  formatSize,
  joinStatuses,
  normalizeBatchDeleteItems,
  pathSegment,
  prepareCsvUpload,
} from '../../core';
import type { Amount, BatchDeleteItem, CsvSource, Size } from '../../core';
import type {
  CancelUnlistResponse,
  JobStatus,
  StockXObject,
  TaskQueuedResponse,
  UnlistJobResponse,
  UnmatchedResponse,
  UploadJobResponse,
  UploadValidationResponse,
} from '../../types';
import { APIResource } from '../shared';
import type { ConnectionOptions, WaitOptions } from '../shared';

interface ListingFields extends ConnectionOptions {
  currencyCode?: string;
  /** ISO 8601 string or `Date`. */
  expiresAt?: string | Date;
  active?: boolean;
  inventoryType?: string;
}

export interface CreateBySkuParams extends ListingFields {
  /** Acquisition cost, stored as a cost record for this style/size/variant. */
  cost?: number;
}

export interface CreateListingParams extends ListingFields {
  /** Acquisition cost. Stored only together with `styleId` and `size`. */
  cost?: number;
  styleId?: string;
  size?: Size;
}

export interface UpdateListingParams extends ConnectionOptions {
  amount?: Amount;
  currencyCode?: string;
  /** ISO 8601 string or `Date`. */
  expiresAt?: string | Date;
}

export interface ListListingsParams extends ConnectionOptions {
  pageNumber?: number;
  pageSize?: number;
  /** Defaults to `ACTIVE` on the server; pass an array for several. */
  listingStatuses?: string | readonly string[];
  /** A style code already cached for your account (404 otherwise). */
  sku?: string;
}

export interface ActivateListingParams extends ConnectionOptions {
  /** Relist at a new price. */
  amount?: Amount;
}

export interface DeleteListingParams extends ConnectionOptions {
  /** Also delete the variant's cost records. */
  variantId?: string;
}

export interface UploadParams extends RequestOptions {
  batchSize?: number;
}

/** Create, reprice and take down listings on your linked StockX account. */
export class StockXListingsResource extends APIResource {
  // -------------------------------------------------------------- single items

  /**
   * `POST /v2/stockx/simple-listing` — list by style code and size.
   *
   * The backend resolves the variant. Throws `NotFoundError` if no variant
   * matches and `ConflictError` when keep-listing mode skips it. Requires the
   * basic plan.
   */
  async createBySku(
    styleId: string,
    size: Size,
    amount: Amount,
    params: CreateBySkuParams = {},
  ): Promise<StockXObject> {
    return this._send(
      'POST',
      '/v2/stockx/simple-listing',
      {
        query: { connection_id: this._conn(params.connectionId) },
        body: cleanBody({
          styleId,
          size: formatSize(size),
          amount: formatAmount(amount),
          cost: params.cost,
          currencyCode: params.currencyCode,
          expiresAt: params.expiresAt == null ? undefined : formatDateTime(params.expiresAt),
          active: params.active,
          inventoryType: params.inventoryType,
        }),
      },
      params,
    );
  }

  /**
   * `POST /v2/stockx/listings` — list a specific `variantId`.
   *
   * To store a cost record too, pass `cost`, `styleId` and `size` together (the
   * API silently skips the cost if one is missing, so the SDK throws a
   * `TypeError` instead). Requires the basic plan.
   */
  async create(variantId: string, amount: Amount, params: CreateListingParams = {}): Promise<StockXObject> {
    if (params.cost != null && (params.styleId == null || params.size == null)) {
      throw new TypeError('`cost` is only stored together with `styleId` and `size`; pass all three.');
    }
    return this._send(
      'POST',
      '/v2/stockx/listings',
      {
        query: { connection_id: this._conn(params.connectionId) },
        body: cleanBody({
          variantId,
          amount: formatAmount(amount),
          currencyCode: params.currencyCode,
          expiresAt: params.expiresAt == null ? undefined : formatDateTime(params.expiresAt),
          active: params.active,
          inventoryType: params.inventoryType,
          cost: params.cost,
          styleId: params.styleId,
          size: params.size == null ? undefined : formatSize(params.size),
        }),
      },
      params,
    );
  }

  /** `PATCH /v2/stockx/listings/{listingId}` — reprice or change expiry. Requires the basic plan. */
  async update(listingId: string, params: UpdateListingParams = {}): Promise<StockXObject> {
    return this._send(
      'PATCH',
      `/v2/stockx/listings/${pathSegment(listingId)}`,
      {
        query: { connection_id: this._conn(params.connectionId) },
        body: cleanBody({
          amount: params.amount == null ? undefined : formatAmount(params.amount),
          currencyCode: params.currencyCode,
          expiresAt: params.expiresAt == null ? undefined : formatDateTime(params.expiresAt),
        }),
      },
      params,
    );
  }

  /**
   * `GET /v2/stockx/listings` — your listings, fetched live from StockX.
   * ACTIVE listings carry `cost` and `netPrice`.
   */
  list(params: ListListingsParams = {}): Promise<StockXObject> {
    return this._get(
      '/v2/stockx/listings',
      {
        page_number: params.pageNumber,
        page_size: params.pageSize,
        listing_statuses: joinStatuses(params.listingStatuses),
        sku: params.sku,
        connection_id: this._conn(params.connectionId),
      },
      params,
    );
  }

  /** `GET /v2/stockx/listings/{listingId}` — one listing. */
  get(listingId: string, params: ConnectionOptions = {}): Promise<StockXObject> {
    return this._get(
      `/v2/stockx/listings/${pathSegment(listingId)}`,
      { connection_id: this._conn(params.connectionId) },
      params,
    );
  }

  /**
   * `GET /v2/stockx/listings/{listingId}/operations/{operationId}` — result of
   * an asynchronous StockX operation.
   */
  getOperation(listingId: string, operationId: string, params: ConnectionOptions = {}): Promise<StockXObject> {
    return this._get(
      `/v2/stockx/listings/${pathSegment(listingId)}/operations/${pathSegment(operationId)}`,
      { connection_id: this._conn(params.connectionId) },
      params,
    );
  }

  /** `PUT /v2/stockx/listings/{listingId}/deactivate` — take off market, keep the listing. Basic plan. */
  deactivate(listingId: string, params: ConnectionOptions = {}): Promise<StockXObject> {
    return this._send(
      'PUT',
      `/v2/stockx/listings/${pathSegment(listingId)}/deactivate`,
      { query: { connection_id: this._conn(params.connectionId) } },
      params,
    );
  }

  /**
   * `PUT /v2/stockx/listings/{listingId}/activate` — put back on market,
   * optionally at a new `amount`. Basic plan.
   */
  async activate(listingId: string, params: ActivateListingParams = {}): Promise<StockXObject> {
    return this._send(
      'PUT',
      `/v2/stockx/listings/${pathSegment(listingId)}/activate`,
      {
        query: { connection_id: this._conn(params.connectionId) },
        body: params.amount == null ? undefined : { amount: formatAmount(params.amount) },
      },
      params,
    );
  }

  /**
   * `DELETE /v2/stockx/listings/{listingId}` — permanent. With `variantId` the
   * variant's cost records are deleted too. Basic plan.
   */
  delete(listingId: string, params: DeleteListingParams = {}): Promise<StockXObject> {
    return this._send(
      'DELETE',
      `/v2/stockx/listings/${pathSegment(listingId)}`,
      { query: { variant_id: params.variantId, connection_id: this._conn(params.connectionId) } },
      params,
    );
  }

  /**
   * `POST /v2/stockx/batch/delete-listing` — delete several listings in one
   * StockX batch. Advanced plan.
   *
   * `items` may be listing ID strings, `[listingId, variantId]` tuples, or
   * objects with `listingId`/`listing_id` and optional `variantId`/`variant_id`.
   */
  async batchDelete(items: Iterable<BatchDeleteItem>, params: ConnectionOptions = {}): Promise<StockXObject> {
    const normalized = normalizeBatchDeleteItems(items);
    return this._send(
      'POST',
      '/v2/stockx/batch/delete-listing',
      { query: { connection_id: this._conn(params.connectionId) }, body: { items: normalized } },
      params,
    );
  }

  // -------------------------------------------------------------- CSV upload

  /**
   * `POST /v2/stockx/listings/upload` — start a bulk listing job.
   *
   * Pass a CSV (path, bytes, Blob or stream) or `{ rows }` with
   * `sku, size, quantity, amount, cost`. Returns a `taskId`; poll with
   * {@link uploadStatus} or {@link waitForUpload}. Advanced plan.
   */
  async upload(source: CsvSource, params: UploadParams = {}): Promise<UploadJobResponse> {
    const file = await prepareCsvUpload(source, 'listings.csv');
    return this._send('POST', '/v2/stockx/listings/upload', { query: { batch_size: params.batchSize }, file }, params);
  }

  /**
   * `POST /v2/stockx/listings/upload/validate` — count valid, invalid and
   * duplicate rows without listing anything.
   */
  async validateUpload(source: CsvSource, options: RequestOptions = {}): Promise<UploadValidationResponse> {
    const file = await prepareCsvUpload(source, 'listings.csv');
    return this._send('POST', '/v2/stockx/listings/upload/validate', { file }, options);
  }

  /** `GET /v2/stockx/listings/upload/{taskId}` */
  uploadStatus(taskId: string, options: RequestOptions = {}): Promise<JobStatus> {
    return this._get(`/v2/stockx/listings/upload/${pathSegment(taskId)}`, undefined, options);
  }

  /**
   * Poll {@link uploadStatus} until the job is SUCCESS, FAILURE or CANCELLED,
   * and return the final status. Throws `JobTimeoutError` after `timeout` ms.
   */
  waitForUpload(taskId: string, options: WaitOptions = {}): Promise<JobStatus> {
    return this._wait((o) => this.uploadStatus(taskId, o), taskId, options);
  }

  /** `GET /v2/stockx/listings/upload/unmatched` — uploaded rows that could not be matched to a variant. */
  unmatched(options: RequestOptions = {}): Promise<UnmatchedResponse> {
    return this._get('/v2/stockx/listings/upload/unmatched', undefined, options);
  }

  // -------------------------------------------------------------- CSV unlist

  /**
   * `POST /v2/stockx/listings/unlist` — start a bulk delist job.
   *
   * Rows carry `listing_id` (optionally `variant_id`), or `sku` (or `style_id`)
   * plus `size` to match ACTIVE listings. Advanced plan.
   */
  async unlist(source: CsvSource, options: RequestOptions = {}): Promise<UnlistJobResponse> {
    const file = await prepareCsvUpload(source, 'unlist.csv');
    return this._send('POST', '/v2/stockx/listings/unlist', { file }, options);
  }

  /** `GET /v2/stockx/listings/unlist/{taskId}` */
  unlistStatus(taskId: string, options: RequestOptions = {}): Promise<JobStatus> {
    return this._get(`/v2/stockx/listings/unlist/${pathSegment(taskId)}`, undefined, options);
  }

  /** Poll {@link unlistStatus} until the job finishes. */
  waitForUnlist(taskId: string, options: WaitOptions = {}): Promise<JobStatus> {
    return this._wait((o) => this.unlistStatus(taskId, o), taskId, options);
  }

  /** `POST /v2/stockx/listings/unlist/cancel` — cancel your running unlist job. */
  cancelUnlist(options: RequestOptions = {}): Promise<CancelUnlistResponse> {
    return this._send('POST', '/v2/stockx/listings/unlist/cancel', {}, options);
  }

  // -------------------------------------------------------------- clear all

  /**
   * `POST /v2/stockx/listings/clear-all` — delete EVERY active listing in the
   * account's `clear_all_scope`. Cannot be undone. Advanced plan.
   */
  clearAll(options: RequestOptions = {}): Promise<TaskQueuedResponse> {
    return this._send('POST', '/v2/stockx/listings/clear-all', {}, options);
  }

  /** `GET /v2/stockx/listings/clear-all/{taskId}` */
  clearAllStatus(taskId: string, options: RequestOptions = {}): Promise<JobStatus> {
    return this._get(`/v2/stockx/listings/clear-all/${pathSegment(taskId)}`, undefined, options);
  }

  /** Poll {@link clearAllStatus} until the job finishes. */
  waitForClearAll(taskId: string, options: WaitOptions = {}): Promise<JobStatus> {
    return this._wait((o) => this.clearAllStatus(taskId, o), taskId, options);
  }
}
