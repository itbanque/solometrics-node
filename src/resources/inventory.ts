import type { RequestOptions } from '../client';
import { formatSize, pathSegment } from '../core';
import type { Size } from '../core';
import type { InventoryItem, InventorySearchResponse, SkuHistoryResponse } from '../types';
import { APIResource } from './shared';

export interface InventoryFilters extends RequestOptions {
  /** Broad search. */
  q?: string;
  /** Partial match. */
  styleColor?: string;
  /** Partial match. */
  brand?: string;
  /** Partial match. */
  retailer?: string;
  /** Exact match. */
  size?: Size;
  /** Partial match. */
  retailerSku?: string;
  /** Partial match. */
  supplierSku?: string;
}

export interface InventorySearchParams extends InventoryFilters {
  /** Capped by your plan's `max_page_size`. */
  limit?: number;
  offset?: number;
}

export interface InventoryIterParams extends InventoryFilters {
  /** Page size for each request (the API's `limit`). */
  pageSize?: number;
  /** Start offset. Default 0. */
  offset?: number;
}

export interface SkuHistoryParams extends RequestOptions {
  /** Look-back window in hours, 1–8760 (default 168). */
  hours?: number;
}

/** Retailer inventory and SKU stock history. */
export class InventoryResource extends APIResource {
  /** `GET /v1/inventory/search` — one page of SKUs with stock per location. */
  search(params: InventorySearchParams = {}): Promise<InventorySearchResponse> {
    return this._get(
      '/v1/inventory/search',
      {
        q: params.q,
        style_color: params.styleColor,
        brand: params.brand,
        retailer: params.retailer,
        size: params.size === undefined || params.size === null ? undefined : formatSize(params.size),
        retailer_sku: params.retailerSku,
        supplier_sku: params.supplierSku,
        limit: params.limit,
        offset: params.offset,
      },
      params,
    );
  }

  /**
   * Iterate every matching SKU across pages.
   *
   * Stops at the last page. Without provider access for `retailer` the plan's
   * `max_page_number` cap applies, and going past it throws `BadRequestError`.
   */
  async *iterSearch(params: InventoryIterParams = {}): AsyncGenerator<InventoryItem, void, undefined> {
    const { pageSize, offset: start, ...rest } = params;
    let offset = start ?? 0;
    for (;;) {
      const page = await this.search({ ...rest, limit: pageSize, offset });
      const items = page.items ?? [];
      yield* items;
      if (!page.has_next_page || items.length === 0) return;
      offset += items.length;
    }
  }

  /**
   * `GET /v1/reporting/retailers/{retailer}/skus/{retailerSku}/history` —
   * stock history of one SKU, newest first.
   */
  history(retailer: string, retailerSku: string, params: SkuHistoryParams = {}): Promise<SkuHistoryResponse> {
    return this._get(
      `/v1/reporting/retailers/${pathSegment(retailer)}/skus/${pathSegment(retailerSku)}/history`,
      { hours: params.hours },
      params,
    );
  }
}
