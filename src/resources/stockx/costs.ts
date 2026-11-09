import { cleanBody, formatSize, pathSegment, prepareCsvUpload } from '../../core';
import type { CsvSource, Size } from '../../core';
import type { CostClearResponse, CostImportResponse, CostListResponse, CostRecord, OkResponse } from '../../types';
import { APIResource } from '../shared';
import type { ConnectionOptions } from '../shared';

export interface ListCostsParams extends ConnectionOptions {
  page?: number;
  /** 1–200, default 50. */
  pageSize?: number;
  /** Partial match. */
  styleId?: string;
}

export interface IterCostsParams extends ConnectionOptions {
  /** Default 200. */
  pageSize?: number;
  styleId?: string;
}

export interface UpdateCostParams extends ConnectionOptions {
  cost?: number;
  /** `false` keeps the record but excludes it from profit and smart pricing. */
  isActive?: boolean;
}

/** Acquisition costs per style code / size / variant. Uses no StockX quota. */
export class StockXCostsResource extends APIResource {
  /** `PATCH /v2/stockx/cost` — create or overwrite the cost for one style/size/variant. Basic plan. */
  set(
    styleId: string,
    size: Size,
    variantId: string,
    cost: number,
    params: ConnectionOptions = {},
  ): Promise<OkResponse> {
    return this._send(
      'PATCH',
      '/v2/stockx/cost',
      {
        query: { connection_id: this._conn(params.connectionId) },
        body: { styleId, size: formatSize(size), variantId, cost },
      },
      params,
    );
  }

  /** `GET /v2/stockx/costs` — cost records, newest first. */
  list(params: ListCostsParams = {}): Promise<CostListResponse> {
    return this._get(
      '/v2/stockx/costs',
      {
        page: params.page,
        page_size: params.pageSize,
        style_id: params.styleId,
        connection_id: this._conn(params.connectionId),
      },
      params,
    );
  }

  /** Iterate every cost record across pages. */
  async *iterList(params: IterCostsParams = {}): AsyncGenerator<CostRecord, void, undefined> {
    const { pageSize = 200, ...rest } = params;
    let seen = 0;
    for (let page = 1; ; page++) {
      const data = await this.list({ ...rest, page, pageSize });
      const items = data.items ?? [];
      yield* items;
      seen += items.length;
      if (items.length === 0 || seen >= Number(data.total ?? 0)) return;
    }
  }

  /**
   * `POST /v2/stockx/costs/import` — upsert costs from a CSV with
   * `style_id, size, variant_id, cost`. Synchronous. Advanced plan.
   */
  async importCsv(source: CsvSource, params: ConnectionOptions = {}): Promise<CostImportResponse> {
    const file = await prepareCsvUpload(source, 'costs.csv');
    return this._send(
      'POST',
      '/v2/stockx/costs/import',
      { query: { connection_id: this._conn(params.connectionId) }, file },
      params,
    );
  }

  /** `PATCH /v2/stockx/costs/{costId}` — edit one record. Basic plan. */
  update(costId: number, params: UpdateCostParams = {}): Promise<OkResponse> {
    return this._send(
      'PATCH',
      `/v2/stockx/costs/${pathSegment(costId)}`,
      {
        query: { connection_id: this._conn(params.connectionId) },
        body: cleanBody({ cost: params.cost, is_active: params.isActive }),
      },
      params,
    );
  }

  /** `DELETE /v2/stockx/costs` — delete EVERY cost record on the connection. Cannot be undone. Basic plan. */
  clear(params: ConnectionOptions = {}): Promise<CostClearResponse> {
    return this._send(
      'DELETE',
      '/v2/stockx/costs',
      { query: { connection_id: this._conn(params.connectionId) } },
      params,
    );
  }
}
