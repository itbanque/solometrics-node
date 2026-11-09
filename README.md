# solometrics — SneakersRadar API Node.js SDK

[![CI](https://github.com/itbanque/solometrics-node/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/itbanque/solometrics-node/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/solometrics)](https://www.npmjs.com/package/solometrics)
[![GitHub release](https://img.shields.io/github/v/release/itbanque/solometrics-node)](https://github.com/itbanque/solometrics-node/releases)
[![Node](https://img.shields.io/node/v/solometrics)](https://www.npmjs.com/package/solometrics)
[![Types](https://img.shields.io/npm/types/solometrics)](https://www.npmjs.com/package/solometrics)
[![Downloads/month](https://img.shields.io/npm/dm/solometrics)](https://www.npmjs.com/package/solometrics)
[![License](https://img.shields.io/github/license/itbanque/solometrics-node)](LICENSE)
[![API docs](https://img.shields.io/badge/API-docs-35CC91)](https://www.sneakers.itbanque.com/docs)

TypeScript / JavaScript client for the [SneakersRadar API](https://www.sneakers.itbanque.com/docs): retailer inventory and SKU history, StockX / GOAT market quotes, and StockX listings, costs and orders.

The Node counterpart of the [Python SDK](https://github.com/itbanque/solometrics-python): same endpoints, same behaviour.

- Typed responses, plain objects at runtime
- Typed errors per status code (`NotFoundError`, `RateLimitError`, ...)
- Automatic retries with backoff, honouring `Retry-After`
- Auto-pagination (`iter*` async iterators) and background-job polling (`waitFor*`)
- CSV uploads from a path, bytes, `Blob`, stream, or an array of objects
- `AbortSignal` and per-call timeout support
- Zero runtime dependencies (built-in `fetch`); ESM and CommonJS

Node.js 18+.

## Install

```bash
npm install solometrics
```

## Quick start

Generate a key at <https://www.sneakers.itbanque.com/account> → **API Keys**.

```ts
import { Client } from 'solometrics';

const client = new Client({ apiKey: 'sr_live_...' }); // or set SOLOMETRICS_API_KEY

const quotes = await client.stockx.market.search('DZ5485-612');
for (const v of quotes.variants) {
  console.log(v.size, v.lowestAsk, v.highestBid);
}
```

Requests are independent promises, so run them concurrently with `Promise.all`:

```ts
const [stockx, goat] = await Promise.all([
  client.stockx.market.search('U9060JBR'),
  client.goat.market.search('U9060JBR'),
]);
```

CommonJS works too: `const { Client } = require('solometrics');`

## Endpoint map

Positional arguments are required; everything else goes in a trailing options object.

| SDK method                                                                                            | HTTP                                                           | Plan     |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------- |
| **Retail data**                                                                                       |                                                                |          |
| `inventory.search({ q, styleColor, brand, retailer, size, retailerSku, supplierSku, limit, offset })` | `GET /v1/inventory/search`                                     | data     |
| `inventory.iterSearch({ ...filters, pageSize, offset })`                                              | auto-paginates the above                                       | data     |
| `inventory.history(retailer, retailerSku, { hours })`                                                 | `GET /v1/reporting/retailers/{retailer}/skus/{sku}/history`    | data     |
| **Market data**                                                                                       |                                                                |          |
| `stockx.market.search(styleId, { size, force })`                                                      | `GET /v2/stockx/market/search`                                 |          |
| `stockx.market.hot({ limit, page })` / `iterHot({ pageSize })`                                        | `GET /v2/stockx/market/hot`                                    |          |
| `stockx.market.variant(productId, variantId, { currencyCode })`                                       | `GET /v2/stockx/catalog/products/{p}/variants/{v}/market-data` | free     |
| `goat.market.search(styleId)`                                                                         | `GET /v2/goat/market/search`                                   |          |
| **StockX catalog**                                                                                    |                                                                |          |
| `stockx.catalog.search(q, { pageNumber, pageSize })`                                                  | `GET /v2/stockx/catalog/search`                                | free     |
| `stockx.catalog.variants(productId, { styleId })`                                                     | `GET /v2/stockx/catalog/products/{p}/variants`                 | free     |
| **StockX listings**                                                                                   |                                                                |          |
| `stockx.listings.createBySku(styleId, size, amount, { cost, ... })`                                   | `POST /v2/stockx/simple-listing`                               | basic    |
| `stockx.listings.create(variantId, amount, { cost, styleId, size, ... })`                             | `POST /v2/stockx/listings`                                     | basic    |
| `stockx.listings.update(listingId, { amount, currencyCode, expiresAt })`                              | `PATCH /v2/stockx/listings/{id}`                               | basic    |
| `stockx.listings.list({ pageNumber, pageSize, listingStatuses, sku })`                                | `GET /v2/stockx/listings`                                      | free     |
| `stockx.listings.get(listingId)`                                                                      | `GET /v2/stockx/listings/{id}`                                 | free     |
| `stockx.listings.getOperation(listingId, operationId)`                                                | `GET /v2/stockx/listings/{id}/operations/{op}`                 | free     |
| `stockx.listings.deactivate(listingId)`                                                               | `PUT .../{id}/deactivate`                                      | basic    |
| `stockx.listings.activate(listingId, { amount })`                                                     | `PUT .../{id}/activate`                                        | basic    |
| `stockx.listings.delete(listingId, { variantId })`                                                    | `DELETE /v2/stockx/listings/{id}`                              | basic    |
| `stockx.listings.batchDelete(items)`                                                                  | `POST /v2/stockx/batch/delete-listing`                         | advanced |
| `stockx.listings.upload(csv, { batchSize })`                                                          | `POST /v2/stockx/listings/upload`                              | advanced |
| `stockx.listings.validateUpload(csv)`                                                                 | `POST /v2/stockx/listings/upload/validate`                     | advanced |
| `stockx.listings.uploadStatus(taskId)` / `waitForUpload(taskId)`                                      | `GET /v2/stockx/listings/upload/{taskId}`                      | advanced |
| `stockx.listings.unmatched()`                                                                         | `GET /v2/stockx/listings/upload/unmatched`                     | advanced |
| `stockx.listings.unlist(csv)`                                                                         | `POST /v2/stockx/listings/unlist`                              | advanced |
| `stockx.listings.unlistStatus(taskId)` / `waitForUnlist(taskId)`                                      | `GET /v2/stockx/listings/unlist/{taskId}`                      | advanced |
| `stockx.listings.cancelUnlist()`                                                                      | `POST /v2/stockx/listings/unlist/cancel`                       | advanced |
| `stockx.listings.clearAll()`                                                                          | `POST /v2/stockx/listings/clear-all`                           | advanced |
| `stockx.listings.clearAllStatus(taskId)` / `waitForClearAll(taskId)`                                  | `GET /v2/stockx/listings/clear-all/{taskId}`                   | advanced |
| **StockX costs**                                                                                      |                                                                |          |
| `stockx.costs.set(styleId, size, variantId, cost)`                                                    | `PATCH /v2/stockx/cost`                                        | basic    |
| `stockx.costs.list({ page, pageSize, styleId })` / `iterList()`                                       | `GET /v2/stockx/costs`                                         | free     |
| `stockx.costs.importCsv(csv)`                                                                         | `POST /v2/stockx/costs/import`                                 | advanced |
| `stockx.costs.update(costId, { cost, isActive })`                                                     | `PATCH /v2/stockx/costs/{id}`                                  | basic    |
| `stockx.costs.clear()`                                                                                | `DELETE /v2/stockx/costs`                                      | basic    |
| **StockX orders**                                                                                     |                                                                |          |
| `stockx.orders.sync()`                                                                                | `POST /v2/stockx/orders/sync`                                  | advanced |
| `stockx.orders.list({ page, pageSize, orderStatus, fromDate, toDate, search })` / `iterList()`        | `GET /v2/stockx/orders`                                        | advanced |
| `stockx.orders.analytics({ fromDate, toDate, granularity })`                                          | `GET /v2/stockx/orders/analytics`                              | advanced |

Methods whose StockX endpoint accepts `connection_id` take `connectionId` in their options.

## Examples

### Retail inventory

```ts
const page = await client.inventory.search({ brand: 'Nike', limit: 20 });
console.log(page.total_skus, page.has_next_page);

// every page, lazily
for await (const item of client.inventory.iterSearch({ styleColor: 'HF1234-100' })) {
  for (const loc of item.inventory) {
    console.log(item.sku.retailer, item.sku.size, loc.location_code, loc.stock_level);
  }
}

const history = await client.inventory.history('DICKS', '11943996', { hours: 24 * 30 });
```

Response fields keep the API's names (`total_skus`, `lowestAsk`, ...); SDK options are camelCase.

### List, reprice, delist on StockX

```ts
// by style code + size (backend resolves the variant)
await client.stockx.listings.createBySku('DZ5485-612', '10', 250, { cost: 180 });

// find listing IDs, then reprice
const listings = await client.stockx.listings.list({ sku: 'DZ5485-612' });
await client.stockx.listings.update('L-1001', { amount: 245 });

await client.stockx.listings.deactivate('L-1001');
await client.stockx.listings.activate('L-1001', { amount: 240 });
await client.stockx.listings.delete('L-1001', { variantId: '1a2b...' }); // also drops cost records

await client.stockx.listings.batchDelete(['L-1002', ['L-1003', 'variant-id']]);
```

Prices may be numbers, strings or bigints; they are sent as strings (`250` → `"250"`).

### Bulk jobs

```ts
const job = await client.stockx.listings.upload('listings.csv', { batchSize: 50 });
// or: upload({ rows: [{ sku: 'DZ5485-612', size: '10', quantity: 1, amount: 250, cost: 180 }] })

const final = await client.stockx.listings.waitForUpload(job.taskId, {
  pollInterval: 5_000, // ms
  timeout: 30 * 60_000, // ms
  onProgress: (s) => console.log(s.status, s.result),
});
if (final.status !== 'SUCCESS') console.log('job ended with', final.status, final.result);
console.log((await client.stockx.listings.unmatched()).items);
```

A CSV can be a file path, a `Buffer` / `Uint8Array` / `ArrayBuffer`, a `Blob` or `File`, a Node readable stream (`fs.createReadStream(...)`), a web `ReadableStream`, or `{ rows }`. A plain string is always treated as a path; to send CSV text, wrap it: `Buffer.from(text)`.

`waitFor*` resolves once `status` is `SUCCESS`, `FAILURE` or `CANCELLED`, and rejects with `JobTimeoutError` if `timeout` (ms) passes first. Without a `timeout` it waits indefinitely; pass `signal` to stop it early. `onProgress` may be async.

### Costs and orders

```ts
await client.stockx.costs.set('DZ5485-612', '10', '1a2b...', 180);
for await (const c of client.stockx.costs.iterList({ styleId: 'DZ5485' })) {
  console.log(c.id, c.size, c.cost);
}
await client.stockx.costs.importCsv('costs.csv');

await client.stockx.orders.sync(); // background; there is no status endpoint, query again later
for await (const o of client.stockx.orders.iterList({ orderStatus: 'COMPLETED', fromDate: '2026-01-01' })) {
  console.log(o.order_number, o.total_payout);
}
const stats = await client.stockx.orders.analytics({ granularity: 'weekly' });
```

Dates may be `"YYYY-MM-DD"` strings or `Date` objects; a `Date` is sent as its UTC calendar date.

## Multiple StockX accounts

```ts
const client = new Client({ connectionId: 12 }); // default for every call
await client.stockx.listings.list({ connectionId: 34 }); // per-call override
const other = client.withOptions({ connectionId: 34 }); // cheap copy
```

Bulk jobs (CSV upload/unlist, clear all, order sync) always run on the default connection.

## Errors

```ts
import { APIStatusError, ConflictError, NotFoundError, PermissionDeniedError } from 'solometrics';

try {
  await client.stockx.listings.createBySku('DZ5485-612', '10', 250, { cost: 180 });
} catch (err) {
  if (err instanceof ConflictError) {
    console.log('skipped:', err.detail); // keep-listing mode skipped it
  } else if (err instanceof NotFoundError) {
    console.log('no such style/size');
  } else if (err instanceof PermissionDeniedError) {
    console.log(err.detail); // not in your StockX plan
  } else if (err instanceof APIStatusError) {
    console.log(err.status, err.detail, err.body);
  } else {
    throw err;
  }
}
```

| Status          | Error                                               |
| --------------- | --------------------------------------------------- |
| 400             | `BadRequestError`                                   |
| 401             | `AuthenticationError`                               |
| 403             | `PermissionDeniedError`                             |
| 404             | `NotFoundError`                                     |
| 409             | `ConflictError`                                     |
| 422             | `UnprocessableEntityError` (`.errors` = field list) |
| 429             | `RateLimitError` (`.retryAfter` in seconds)         |
| 502             | `UpstreamError`                                     |
| 504             | `UpstreamTimeoutError`                              |
| other 5xx       | `InternalServerError`                               |
| network         | `APIConnectionError` / `APITimeoutError`            |
| `signal` abort  | `APIUserAbortError`                                 |
| `waitFor*` time | `JobTimeoutError` (`.taskId`, `.lastStatus`)        |

All extend `SolometricsError`. Invalid arguments (e.g. `cost` without `styleId` and `size` in `create`) reject with a `TypeError` before any request is sent.

## Retries, timeouts and cancellation

By default the client retries twice with exponential backoff (honouring `Retry-After`, capped at 60s):

- **429** — every method (the request was rejected before it ran).
- **502 / 503 / 504, timeouts, dropped connections** — only `GET`, `PUT`, `PATCH`, `DELETE`. `POST` is not retried, because a create-listing that timed out at the gateway may already have been placed on StockX.
- **Connection refused / DNS failures** — every method.

```ts
const client = new Client({ maxRetries: 5, timeout: 30_000 }); // timeout in ms, per attempt
await client.withOptions({ maxRetries: 0 }).stockx.listings.list();

// per call
await client.stockx.market.search('DZ5485-612', { timeout: 10_000, maxRetries: 0 });

// cancel
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
await client.stockx.listings.list({ signal: controller.signal });
```

## Custom fetch

Pass any `fetch`-compatible function, e.g. to route through a proxy with undici:

```ts
import { ProxyAgent, fetch } from 'undici';

const dispatcher = new ProxyAgent('http://127.0.0.1:8080');
const client = new Client({ fetch: (url, init) => fetch(url, { ...init, dispatcher }) as Promise<Response> });
```

## Endpoints not wrapped yet

```ts
await client.get('/v2/stockx/some/new/endpoint', { query: { x: 1 } });
await client.post('/v2/...', { body: { ... } });
```

`put`, `patch` and `delete` work the same way. They follow the same retry and error rules.

## Development

```bash
npm install
npm test            # vitest
npm run typecheck   # tsc
npm run format      # prettier
npm run build       # tsup → dist/ (ESM + CJS + .d.ts)
npm run smoke       # import the built package via ESM and CJS
```

## Releasing

1. Bump `version` in `package.json` and `src/version.ts` (a test checks they match) and merge to `main`.
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`.

The **Release** workflow runs CI, checks the tag matches `package.json`, builds and packs the tarball, smoke-tests it, publishes to npm (trusted publishing with provenance, no token), and creates a GitHub release with the tarball.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
