import type { Client, RequestOptions } from '../client';
import type { MarketSearchResponse } from '../types';
import { APIResource } from './shared';

export class GoatMarketResource extends APIResource {
  /**
   * `GET /v2/goat/market/search` — per-size GOAT prices. Needs a linked GOAT
   * account (`ConflictError` otherwise).
   */
  search(styleId: string, options: RequestOptions = {}): Promise<MarketSearchResponse> {
    return this._get('/v2/goat/market/search', { style_id: styleId }, options);
  }
}

export class GoatResource extends APIResource {
  readonly market: GoatMarketResource;

  constructor(client: Client) {
    super(client);
    this.market = new GoatMarketResource(client);
  }
}
