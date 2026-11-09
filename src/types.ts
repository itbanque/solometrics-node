/**
 * Shapes of documented responses. Responses are plain objects parsed from JSON;
 * these types only help editors and the type checker. Endpoints that pass
 * StockX's own response through unchanged (catalog search, variant list,
 * listing detail, ...) are typed as {@link StockXObject}.
 */

/** A JSON object passed through from StockX as received. */
export type StockXObject = Record<string, any>;

// ------------------------------------------------------------------ retail data

export interface InventorySku {
  id: number;
  retailer: string;
  size: string;
  retailer_sku: string;
  supplier_sku: string | null;
  title: string | null;
  original_price: number | null;
  price: number | null;
  coupon_code_eligible: boolean | null;
}

export interface InventoryProduct {
  id: number;
  style_color: string;
  brand: string | null;
  model_name: string | null;
  gender: string | null;
}

/** `HIGH` | `MEDIUM` | `LOW` | `OOS` | `IN_STOCK` */
export type StockLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'OOS' | 'IN_STOCK' | (string & {});

export interface InventoryLocation {
  location_code: string;
  stock_level: StockLevel;
  as_of: string;
}

export interface InventoryItem {
  sku: InventorySku;
  product: InventoryProduct;
  inventory: InventoryLocation[];
}

export interface InventorySearchResponse {
  total_skus: number;
  count: number;
  limit: number;
  offset: number;
  has_next_page: boolean;
  items: InventoryItem[];
}

export interface SkuHistoryRecord {
  stock_level: StockLevel;
  location: string;
  record_created_at: string;
  price: number | null;
  original_price: number | null;
  coupon_code_eligible: boolean | null;
}

export interface SkuHistorySku {
  retailer_sku: string;
  size: string;
  style_color: string;
  model_name: string | null;
  brand: string | null;
}

export interface SkuHistoryResponse {
  retailer: string;
  cutoff_ts: string;
  sku: SkuHistorySku;
  history: SkuHistoryRecord[];
  count: number;
  limit: number | null;
  has_more: boolean;
}

// ------------------------------------------------------------------ market data

export interface MarketVariant {
  size: string;
  lowestAsk: number | null;
  highestBid: number | null;
  lastSale: number | null;
  currency: string;
  // GOAT only, depending on how the account is connected
  highDemandPrice?: number | null;
  productCondition?: string;
  packagingCondition?: string;
  regionId?: unknown;
}

export interface MarketSearchResponse {
  platform: 'stockx' | 'goat' | (string & {});
  style_id: string;
  fetched_at: string;
  variants: MarketVariant[];
}

export interface HotStylesResponse {
  items: string[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  has_next: boolean;
  has_prev: boolean;
}

// ------------------------------------------------------------------ listings

export interface OkResponse {
  ok: boolean;
}

export interface UploadJobResponse {
  taskId: string;
  status: string;
  filename: string;
  processedRows: number;
  batchSize: number;
  duplicateRowsRemoved?: number;
}

export interface UploadValidationResponse {
  filename: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
}

export interface UnlistJobResponse {
  taskId: string;
  status: string;
  filename: string;
  processedRows: number;
  duplicateRowsRemoved: number;
  resolveRows: number;
}

/** `PENDING` / `STARTED` / `PAUSED` while running; `SUCCESS` / `FAILURE` / `CANCELLED` when finished. */
export type JobState = 'PENDING' | 'STARTED' | 'PAUSED' | 'SUCCESS' | 'FAILURE' | 'CANCELLED' | (string & {});

/**
 * Background job progress. `result` holds job-specific progress counters
 * (`null` until the job starts).
 */
export interface JobStatus {
  taskId: string;
  status: JobState;
  result: Record<string, unknown> | null;
}

export interface UnmatchedResponse {
  items: unknown[];
}

export interface CancelUnlistResponse {
  cancelled: boolean;
  result: unknown;
}

export interface TaskQueuedResponse {
  taskId: string;
  status: string;
}

// ------------------------------------------------------------------ costs

export interface CostRecord {
  id: number;
  style_id: string;
  size: string;
  variant_id: string;
  cost: number;
  is_active: boolean;
  updated_at: string;
}

export interface CostListResponse {
  items: CostRecord[];
  total: number;
  page: number;
  page_size: number;
}

export interface CostImportResponse {
  total_rows: number;
  imported: number;
  skipped: number;
}

export interface CostClearResponse {
  ok: boolean;
  deleted: number;
}

// ------------------------------------------------------------------ orders

export interface OrderSyncResponse {
  task_id: string;
  status: string;
}

export interface Order {
  id: number;
  order_number: string;
  listing_id: string | null;
  amount: number | null;
  currency_code: string | null;
  status: string | null;
  inventory_type: string | null;
  order_created_at: string | null;
  order_updated_at: string | null;
  product_id: string | null;
  product_name: string | null;
  style_id: string | null;
  variant_id: string | null;
  variant_name: string | null;
  variant_value: string | null;
  total_payout: number | null;
  sale_price: number | null;
  total_adjustments: number | null;
  payout_currency: string | null;
  auth_status: string | null;
}

export interface OrderListResponse {
  total: number;
  page: number;
  page_size: number;
  orders: Order[];
}

export interface OrderAnalyticsSummary {
  total_orders: number;
  total_revenue: number;
  avg_payout: number;
  total_fees: number;
}

export interface TopProduct {
  product_name: string;
  style_id: string | null;
  units_sold: number;
  total_revenue: number;
  avg_payout: number;
}

export interface TopBrand {
  brand: string;
  units_sold: number;
  total_revenue: number;
}

export interface SalesTrendPoint {
  period: string;
  units: number;
  revenue: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface OrderAnalyticsResponse {
  summary: OrderAnalyticsSummary;
  top_products: TopProduct[];
  top_brands: TopBrand[];
  sales_trend: SalesTrendPoint[];
  status_breakdown: StatusCount[];
}
