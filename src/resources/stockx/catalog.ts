import { pathSegment } from '../../core';
import type { StockXObject } from '../../types';
import { APIResource } from '../shared';
import type { ConnectionOptions } from '../shared';

export interface CatalogSearchParams extends ConnectionOptions {
  pageNumber?: number;
  pageSize?: number;
}

export interface CatalogVariantsParams extends ConnectionOptions {
  /** Pass the style code so the product is cached for your account. */
  styleId?: string;
}

export class StockXCatalogResource extends APIResource {
  /**
   * `GET /v2/stockx/catalog/search` — StockX catalog search (usually by style
   * code), returned as received from StockX.
   */
  search(q: string, params: CatalogSearchParams = {}): Promise<StockXObject> {
    return this._get(
      '/v2/stockx/catalog/search',
      {
        q,
        page_number: params.pageNumber,
        page_size: params.pageSize,
        connection_id: this._conn(params.connectionId),
      },
      params,
    );
  }

  /**
   * `GET /v2/stockx/catalog/products/{productId}/variants` — every size variant
   * of a product, as received from StockX.
   */
  variants(productId: string, params: CatalogVariantsParams = {}): Promise<StockXObject[]> {
    return this._get(
      `/v2/stockx/catalog/products/${pathSegment(productId)}/variants`,
      { style_id: params.styleId, connection_id: this._conn(params.connectionId) },
      params,
    );
  }
}
