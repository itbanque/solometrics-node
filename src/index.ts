/** Node.js / TypeScript SDK for the SneakersRadar API (https://www.sneakers.itbanque.com/docs). */

export { Client } from './client';
export type { ClientOptions, Fetch, HttpMethod, RawRequestOptions, RequestOptions } from './client';
export {
  APIConnectionError,
  APIError,
  APIStatusError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  JobTimeoutError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  SolometricsError,
  UnprocessableEntityError,
  UpstreamError,
  UpstreamTimeoutError,
} from './errors';
export type { ValidationErrorItem } from './errors';
export type { Amount, BatchDeleteItem, CsvRow, CsvSource, DateLike, Query, QueryValue, Size } from './core';
export { GoatMarketResource, GoatResource } from './resources/goat';
export { InventoryResource } from './resources/inventory';
export type {
  InventoryFilters,
  InventoryIterParams,
  InventorySearchParams,
  SkuHistoryParams,
} from './resources/inventory';
export type { ConnectionOptions, WaitOptions } from './resources/shared';
export {
  StockXCatalogResource,
  StockXCostsResource,
  StockXListingsResource,
  StockXMarketResource,
  StockXOrdersResource,
  StockXResource,
} from './resources/stockx';
export type { CatalogSearchParams, CatalogVariantsParams } from './resources/stockx/catalog';
export type { IterCostsParams, ListCostsParams, UpdateCostParams } from './resources/stockx/costs';
export type {
  ActivateListingParams,
  CreateBySkuParams,
  CreateListingParams,
  DeleteListingParams,
  ListListingsParams,
  UpdateListingParams,
  UploadParams,
} from './resources/stockx/listings';
export type {
  HotStylesIterParams,
  HotStylesParams,
  MarketSearchParams,
  VariantMarketParams,
} from './resources/stockx/market';
export type { IterOrdersParams, ListOrdersParams, OrderAnalyticsParams, OrderFilters } from './resources/stockx/orders';
export type * from './types';
export { VERSION } from './version';
