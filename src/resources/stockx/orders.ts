import type { RequestOptions } from '../../client';
import { formatDate } from '../../core';
import type { DateLike } from '../../core';
import type { Order, OrderAnalyticsResponse, OrderListResponse, OrderSyncResponse } from '../../types';
import { APIResource } from '../shared';

export interface OrderFilters extends RequestOptions {
  orderStatus?: string;
  /** `"2026-01-01"` or a `Date` (its UTC calendar date). */
  fromDate?: DateLike;
  toDate?: DateLike;
  search?: string;
}

export interface ListOrdersParams extends OrderFilters {
  page?: number;
  pageSize?: number;
}

export interface IterOrdersParams extends OrderFilters {
  /** Default 200. */
  pageSize?: number;
}

export interface OrderAnalyticsParams extends RequestOptions {
  fromDate?: DateLike;
  toDate?: DateLike;
  /** Default `monthly`. */
  granularity?: 'daily' | 'weekly' | 'monthly';
}

const date = (value: DateLike | null | undefined) => (value == null ? undefined : formatDate(value));

/** Locally synced StockX orders. All endpoints need the advanced plan. */
export class StockXOrdersResource extends APIResource {
  /**
   * `POST /v2/stockx/orders/sync` — start a background sync from StockX. There
   * is no status endpoint; query again later.
   */
  sync(options: RequestOptions = {}): Promise<OrderSyncResponse> {
    return this._send('POST', '/v2/stockx/orders/sync', {}, options);
  }

  /** `GET /v2/stockx/orders` — synced orders, newest first. */
  list(params: ListOrdersParams = {}): Promise<OrderListResponse> {
    return this._get(
      '/v2/stockx/orders',
      {
        page: params.page,
        page_size: params.pageSize,
        order_status: params.orderStatus,
        from_date: date(params.fromDate),
        to_date: date(params.toDate),
        search: params.search,
      },
      params,
    );
  }

  /** Iterate every matching order across pages. */
  async *iterList(params: IterOrdersParams = {}): AsyncGenerator<Order, void, undefined> {
    const { pageSize = 200, ...rest } = params;
    let seen = 0;
    for (let page = 1; ; page++) {
      const data = await this.list({ ...rest, page, pageSize });
      const orders = data.orders ?? [];
      yield* orders;
      seen += orders.length;
      if (orders.length === 0 || seen >= Number(data.total ?? 0)) return;
    }
  }

  /**
   * `GET /v2/stockx/orders/analytics` — summary, top products/brands, sales
   * trend and status breakdown.
   */
  analytics(params: OrderAnalyticsParams = {}): Promise<OrderAnalyticsResponse> {
    return this._get(
      '/v2/stockx/orders/analytics',
      { from_date: date(params.fromDate), to_date: date(params.toDate), granularity: params.granularity },
      params,
    );
  }
}
