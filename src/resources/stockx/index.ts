import type { Client } from '../../client';
import { APIResource } from '../shared';
import { StockXCatalogResource } from './catalog';
import { StockXCostsResource } from './costs';
import { StockXListingsResource } from './listings';
import { StockXMarketResource } from './market';
import { StockXOrdersResource } from './orders';

export class StockXResource extends APIResource {
  readonly market: StockXMarketResource;
  readonly catalog: StockXCatalogResource;
  readonly listings: StockXListingsResource;
  readonly costs: StockXCostsResource;
  readonly orders: StockXOrdersResource;

  constructor(client: Client) {
    super(client);
    this.market = new StockXMarketResource(client);
    this.catalog = new StockXCatalogResource(client);
    this.listings = new StockXListingsResource(client);
    this.costs = new StockXCostsResource(client);
    this.orders = new StockXOrdersResource(client);
  }
}

export {
  StockXCatalogResource,
  StockXCostsResource,
  StockXListingsResource,
  StockXMarketResource,
  StockXOrdersResource,
};
