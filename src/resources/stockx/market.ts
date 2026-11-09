import type { RequestOptions } from '../../client';
import { formatSize, pathSegment } from '../../core';
import type { Size } from '../../core';
import type { HotStylesResponse, MarketSearchResponse, StockXObject } from '../../types';
import { APIResource } from '../shared';
import type { ConnectionOptions } from '../shared';

export interface MarketSearchParams extends RequestOptions {
  size?: Size;
  /** Skip the cache and spend StockX quota. */
  force?: boolean;
}

export interface HotStylesParams extends RequestOptions {
  limit?: number;
  page?: number;
}

export interface HotStylesIterParams extends RequestOptions {
  /** Default 100. */
  pageSize?: number;
}

export interface VariantMarketParams extends ConnectionOptions {
  currencyCode?: string;
}

export class StockXMarketResource extends APIResource {
  /**
   * `GET /v2/stockx/market/search` — lowest ask / highest bid per size.
   *
   * Served from cache when fresh; `force: true` skips the cache and spends
   * StockX quota. Check `fetched_at` for freshness.
   */
  search(styleId: string, params: MarketSearchParams = {}): Promise<MarketSearchResponse> {
    return this._get(
      '/v2/stockx/market/search',
      {
        style_id: styleId,
        size: params.size === undefined || params.size === null ? undefined : formatSize(params.size),
        force: params.force,
      },
      params,
    );
  }

  /** `GET /v2/stockx/market/hot` — style codes with recently cached quotes. */
  hot(params: HotStylesParams = {}): Promise<HotStylesResponse> {
    return this._get('/v2/stockx/market/hot', { limit: params.limit, page: params.page }, params);
  }

  /** Iterate every recently quoted style code across pages. */
  async *iterHot(params: HotStylesIterParams = {}): AsyncGenerator<string, void, undefined> {
    const { pageSize = 100, ...options } = params;
    for (let page = 1; ; page++) {
      const data = await this.hot({ ...options, limit: pageSize, page });
      yield* data.items ?? [];
      if (!data.has_next) return;
    }
  }

  /**
   * `GET /v2/stockx/catalog/products/{productId}/variants/{variantId}/market-data`
   *
   * Live quote for one size. Always calls StockX. Returns StockX's market data
   * object as received.
   */
  variant(productId: string, variantId: string, params: VariantMarketParams = {}): Promise<StockXObject> {
    return this._get(
      `/v2/stockx/catalog/products/${pathSegment(productId)}/variants/${pathSegment(variantId)}/market-data`,
      { currency_code: params.currencyCode, connection_id: this._conn(params.connectionId) },
      params,
    );
  }
}
