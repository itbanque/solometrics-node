import { createReadStream, readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  APIConnectionError,
  APIStatusError,
  APITimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  Client,
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
  VERSION,
} from '../src';
import type { JobStatus } from '../src';
import { timing } from '../src/core';
import { BASE, Recorder, fetchFailed, hang, json, makeClient } from './helpers';

let rec: Recorder;
let client: Client;
const realSleep = timing.sleep;

beforeEach(() => {
  timing.sleep = async (_ms, signal) => {
    if (signal?.aborted) throw new APIUserAbortError();
  };
  rec = new Recorder();
  client = makeClient(rec);
});

afterEach(() => {
  timing.sleep = realSleep;
  delete process.env.SOLOMETRICS_API_KEY;
  delete process.env.SOLOMETRICS_BASE_URL;
});

// ----------------------------------------------------------------- auth & config

describe('config', () => {
  it('sends the API key and user agent', async () => {
    await client.stockx.market.hot();
    expect(rec.last.headers.get('X-API-Key')).toBe('sr_live_test');
    expect(rec.last.headers.get('User-Agent')).toBe(`solometrics-node/${VERSION}`);
    expect(rec.last.headers.get('Accept')).toBe('application/json');
  });

  it('reads the API key and base URL from the environment', () => {
    process.env.SOLOMETRICS_API_KEY = 'sr_live_env';
    const c = new Client();
    expect(c.apiKey).toBe('sr_live_env');
    expect(c.baseURL).toBe('https://api.sneakers.itbanque.com');
    process.env.SOLOMETRICS_BASE_URL = 'https://staging.test/';
    expect(new Client().baseURL).toBe('https://staging.test');
  });

  it('accepts the API key as the first argument', () => {
    expect(new Client('sr_live_pos', { baseURL: BASE }).apiKey).toBe('sr_live_pos');
  });

  it('throws without an API key', () => {
    expect(() => new Client()).toThrow(SolometricsError);
  });

  it('does not leak the API key when inspected', () => {
    expect(inspect(client)).not.toContain('sr_live_test');
    expect(inspect(client.stockx.listings)).not.toContain('sr_live_test');
    expect(Object.values(client)).not.toContain('sr_live_test');
  });

  it('merges default and per-request headers', async () => {
    const c = makeClient(rec, { defaultHeaders: { 'X-Team': 'a' } });
    await c.stockx.market.hot({ headers: { 'X-Trace': '1' } });
    expect(rec.last.headers.get('X-Team')).toBe('a');
    expect(rec.last.headers.get('X-Trace')).toBe('1');
  });

  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

// ----------------------------------------------------------------- retail data

describe('inventory', () => {
  it('search maps parameters', async () => {
    await client.inventory.search({ brand: 'Nike', size: 10.0, limit: 5, offset: 0 });
    expect(rec.last.method).toBe('GET');
    expect(rec.last.url.pathname).toBe('/v1/inventory/search');
    expect(rec.params()).toEqual({ brand: 'Nike', size: '10', limit: '5', offset: '0' });
  });

  it('iterSearch paginates by offset', async () => {
    const pages: Record<string, unknown> = {
      '0': { items: [{ sku: { id: 1 } }, { sku: { id: 2 } }], has_next_page: true },
      '2': { items: [{ sku: { id: 3 } }], has_next_page: false },
    };
    rec.handler = (r) => json(200, pages[r.url.searchParams.get('offset')!]);
    const ids: number[] = [];
    for await (const item of client.inventory.iterSearch({ brand: 'Nike', pageSize: 2 })) ids.push(item.sku.id);
    expect(ids).toEqual([1, 2, 3]);
    expect(rec.requests).toHaveLength(2);
    expect(rec.params(rec.requests[0])).toEqual({ brand: 'Nike', limit: '2', offset: '0' });
  });

  it('history encodes path segments', async () => {
    await client.inventory.history('DICKS', 'AB/12 3', { hours: 4320 });
    expect(rec.last.rawUrl).toBe(`${BASE}/v1/reporting/retailers/DICKS/skus/AB%2F12%203/history?hours=4320`);
  });
});

// ----------------------------------------------------------------- market data

describe('market', () => {
  it('stockx search', async () => {
    rec.handler = () => json(200, { platform: 'stockx', variants: [] });
    const out = await client.stockx.market.search('DZ5485-612', { size: '10.5', force: true });
    expect(out.platform).toBe('stockx');
    expect(rec.params()).toEqual({ style_id: 'DZ5485-612', size: '10.5', force: 'true' });
  });

  it('default connectionId, per-call override and withOptions', async () => {
    const c = makeClient(rec, { connectionId: 7 });
    await c.stockx.market.variant('p1', 'v1');
    expect(rec.last.url.pathname).toBe('/v2/stockx/catalog/products/p1/variants/v1/market-data');
    expect(rec.params().connection_id).toBe('7');
    await c.stockx.catalog.search('DZ5485-612', { connectionId: 9 });
    expect(rec.params().connection_id).toBe('9');
    await c.withOptions({ connectionId: null }).stockx.catalog.variants('p1', { styleId: 'DZ5485-612' });
    expect(rec.params()).toEqual({ style_id: 'DZ5485-612' });
    await c.withOptions({ maxRetries: 0 }).stockx.listings.list();
    expect(rec.params().connection_id).toBe('7');
  });

  it('iterHot', async () => {
    const pages: Record<string, unknown> = {
      '1': { items: ['A', 'B'], has_next: true },
      '2': { items: ['C'], has_next: false },
    };
    rec.handler = (r) => json(200, pages[r.url.searchParams.get('page')!]);
    const out: string[] = [];
    for await (const style of client.stockx.market.iterHot({ pageSize: 2 })) out.push(style);
    expect(out).toEqual(['A', 'B', 'C']);
  });

  it('goat search', async () => {
    await client.goat.market.search('U9060JBR');
    expect(rec.last.url.pathname).toBe('/v2/goat/market/search');
    expect(rec.params()).toEqual({ style_id: 'U9060JBR' });
  });
});

// ----------------------------------------------------------------- listings

describe('listings', () => {
  it('createBySku body', async () => {
    rec.handler = () => json(201, { ok: true });
    expect(await client.stockx.listings.createBySku('DZ5485-612', 10, 250.0, { cost: 180 })).toEqual({ ok: true });
    expect(rec.last.method).toBe('POST');
    expect(rec.last.url.pathname).toBe('/v2/stockx/simple-listing');
    expect(rec.last.headers.get('Content-Type')).toBe('application/json');
    expect(rec.lastJson()).toEqual({ styleId: 'DZ5485-612', size: '10', amount: '250', cost: 180 });
  });

  it('create requires styleId and size with cost', async () => {
    await expect(client.stockx.listings.create('v1', 250, { cost: 180 })).rejects.toThrow(TypeError);
    expect(rec.requests).toHaveLength(0);
  });

  it('rejects (not throws) on a bad amount', async () => {
    const p = client.stockx.listings.createBySku('S', '10', Number.NaN);
    await expect(p).rejects.toThrow(TypeError);
  });

  it('create by variant', async () => {
    await client.stockx.listings.create('v1', '250', {
      currencyCode: 'USD',
      active: false,
      cost: 180,
      styleId: 'S',
      size: '10',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    });
    expect(rec.lastJson()).toEqual({
      variantId: 'v1',
      amount: '250',
      currencyCode: 'USD',
      expiresAt: '2026-12-01T00:00:00.000Z',
      active: false,
      cost: 180,
      styleId: 'S',
      size: '10',
    });
  });

  it('update and activate', async () => {
    await client.stockx.listings.update('L-1001', { amount: 260 });
    expect(rec.last.method).toBe('PATCH');
    expect(rec.lastJson()).toEqual({ amount: '260' });
    await client.stockx.listings.activate('L-1001');
    expect(rec.last.method).toBe('PUT');
    expect(rec.last.body).toBe('');
    expect(rec.last.headers.get('Content-Type')).toBeNull();
    await client.stockx.listings.activate('L-1001', { amount: 240n });
    expect(rec.lastJson()).toEqual({ amount: '240' });
    await client.stockx.listings.deactivate('L-1001');
    expect(rec.last.url.pathname).toBe('/v2/stockx/listings/L-1001/deactivate');
  });

  it('list joins statuses', async () => {
    await client.stockx.listings.list({ listingStatuses: ['ACTIVE', 'INACTIVE'], sku: 'DZ5485-612' });
    expect(rec.params()).toEqual({ listing_statuses: 'ACTIVE,INACTIVE', sku: 'DZ5485-612' });
  });

  it('get and getOperation', async () => {
    await client.stockx.listings.getOperation('L-1', 'op/1');
    expect(rec.last.rawUrl).toBe(`${BASE}/v2/stockx/listings/L-1/operations/op%2F1`);
  });

  it('delete with variant', async () => {
    await client.stockx.listings.delete('L-1001', { variantId: 'v1' });
    expect(rec.last.method).toBe('DELETE');
    expect(rec.params().variant_id).toBe('v1');
  });

  it('batchDelete normalizes items', async () => {
    await client.stockx.listings.batchDelete(['L-1', ['L-2', 'v2'], { listing_id: 'L-3', variant_id: 'v3' }]);
    expect(rec.lastJson()).toEqual({
      items: [{ listingId: 'L-1' }, { listingId: 'L-2', variantId: 'v2' }, { listingId: 'L-3', variantId: 'v3' }],
    });
    await expect(client.stockx.listings.batchDelete([])).rejects.toThrow(TypeError);
  });

  it('upload from rows', async () => {
    rec.handler = () => json(200, { taskId: 't1', status: 'queued' });
    const out = await client.stockx.listings.upload(
      { rows: [{ sku: 'DZ5485-612', size: '10', quantity: 1, amount: 250, cost: 180 }] },
      { batchSize: 50 },
    );
    expect(out.taskId).toBe('t1');
    expect(rec.params().batch_size).toBe('50');
    expect(rec.last.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
    expect(rec.last.body).toContain('filename="listings.csv"');
    expect(rec.last.body).toContain('Content-Type: text/csv');
    expect(rec.last.body).toContain('sku,size,quantity,amount,cost\nDZ5485-612,10,1,250,180\n');
  });

  it('rows become CSV with a union header and quoting', async () => {
    await client.stockx.listings.unlist({ rows: [{ listing_id: 'L-1' }, { sku: 'A,B', size: 'say "hi"', x: null }] });
    expect(rec.last.body).toContain('filename="unlist.csv"');
    expect(rec.last.body).toContain('listing_id,sku,size,x\nL-1,,,\n,"A,B","say ""hi""",\n');
  });

  it('upload from a path, bytes, Blob, File and stream', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'solometrics-'));
    const path = join(dir, 'mine.csv');
    writeFileSync(path, 'sku,size,quantity,amount,cost\n');

    await client.stockx.listings.validateUpload(path);
    expect(rec.last.body).toContain('filename="mine.csv"');
    expect(rec.last.body).toContain('sku,size,quantity,amount,cost\n');

    await client.stockx.costs.importCsv(Buffer.from('style_id,size,variant_id,cost\n'));
    expect(rec.last.body).toContain('filename="costs.csv"');

    await client.stockx.costs.importCsv(new Blob(['a,b\n']));
    expect(rec.last.body).toContain('filename="costs.csv"');

    if (typeof File !== 'undefined') {
      // File is global from Node 20
      await client.stockx.costs.importCsv(new File(['a,b\n'], 'export'));
      expect(rec.last.body).toContain('filename="export.csv"');
    }

    await client.stockx.listings.unlist(createReadStream(path));
    expect(rec.last.body).toContain('filename="mine.csv"');
    expect(rec.last.body).toContain('sku,size,quantity,amount,cost\n');

    await client.stockx.listings.unlist(new Blob(['x,y\n1,2\n']).stream());
    expect(rec.last.body).toContain('x,y\n1,2\n');
  });

  it('upload needs a source', async () => {
    // @ts-expect-error missing source
    await expect(client.stockx.listings.upload()).rejects.toThrow(TypeError);
    await expect(client.stockx.listings.upload({ rows: [] })).rejects.toThrow(TypeError);
  });

  it('waitForUpload polls until finished', async () => {
    const statuses = ['PENDING', 'STARTED', 'SUCCESS'];
    rec.handler = () => json(200, { taskId: 't1', status: statuses.shift(), result: {} });
    const seen: string[] = [];
    const final = await client.stockx.listings.waitForUpload('t1', {
      pollInterval: 0,
      onProgress: (s) => {
        seen.push(s.status);
      },
    });
    expect(final.status).toBe('SUCCESS');
    expect(seen).toEqual(['PENDING', 'STARTED', 'SUCCESS']);
    expect(rec.last.url.pathname).toBe('/v2/stockx/listings/upload/t1');
  });

  it('waitForUnlist awaits an async callback', async () => {
    const statuses = ['PENDING', 'FAILURE'];
    rec.handler = () => json(200, { taskId: 't', status: statuses.shift() });
    const seen: string[] = [];
    const final = await client.stockx.listings.waitForUnlist('t', {
      pollInterval: 0,
      onProgress: async (s: JobStatus) => {
        await Promise.resolve();
        seen.push(s.status);
      },
    });
    expect(final.status).toBe('FAILURE');
    expect(seen).toEqual(['PENDING', 'FAILURE']);
  });

  it('wait timeout throws JobTimeoutError', async () => {
    rec.handler = () => json(200, { taskId: 't1', status: 'STARTED' });
    const err = await client.stockx.listings
      .waitForClearAll('t1', { pollInterval: 1000, timeout: 0 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobTimeoutError);
    expect((err as JobTimeoutError).taskId).toBe('t1');
    expect((err as JobTimeoutError).lastStatus).toEqual({ taskId: 't1', status: 'STARTED' });
    expect(rec.requests).toHaveLength(1);
  });

  it('wait stops on abort', async () => {
    timing.sleep = realSleep;
    rec.handler = () => json(200, { taskId: 't1', status: 'STARTED' });
    const controller = new AbortController();
    const p = client.stockx.listings.waitForUpload('t1', { pollInterval: 60_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(p).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it('bulk endpoints', async () => {
    await client.stockx.listings.unmatched();
    expect(rec.last.url.pathname).toBe('/v2/stockx/listings/upload/unmatched');
    await client.stockx.listings.cancelUnlist();
    expect([rec.last.method, rec.last.url.pathname]).toEqual(['POST', '/v2/stockx/listings/unlist/cancel']);
    await client.stockx.listings.clearAll();
    expect([rec.last.method, rec.last.url.pathname]).toEqual(['POST', '/v2/stockx/listings/clear-all']);
  });
});

// ----------------------------------------------------------------- costs & orders

describe('costs and orders', () => {
  it('cost set and update', async () => {
    await client.stockx.costs.set('DZ5485-612', '10', 'v1', 180);
    expect(rec.last.method).toBe('PATCH');
    expect(rec.last.url.pathname).toBe('/v2/stockx/cost');
    expect(rec.lastJson()).toEqual({ styleId: 'DZ5485-612', size: '10', variantId: 'v1', cost: 180 });
    await client.stockx.costs.update(4417, { isActive: false });
    expect(rec.last.url.pathname).toBe('/v2/stockx/costs/4417');
    expect(rec.lastJson()).toEqual({ is_active: false });
    await client.stockx.costs.clear();
    expect([rec.last.method, rec.last.url.pathname]).toEqual(['DELETE', '/v2/stockx/costs']);
  });

  it('costs iterList', async () => {
    const pages: Record<string, unknown> = {
      '1': { items: [{ id: 1 }, { id: 2 }], total: 3 },
      '2': { items: [{ id: 3 }], total: 3 },
    };
    rec.handler = (r) => json(200, pages[r.url.searchParams.get('page')!]);
    const ids: number[] = [];
    for await (const c of client.stockx.costs.iterList({ pageSize: 2, styleId: 'DZ' })) ids.push(c.id);
    expect(ids).toEqual([1, 2, 3]);
    expect(rec.params(rec.requests[0])).toEqual({ page: '1', page_size: '2', style_id: 'DZ' });
  });

  it('orders dates', async () => {
    await client.stockx.orders.list({
      fromDate: new Date(Date.UTC(2026, 0, 1)),
      toDate: '2026-07-27',
      orderStatus: 'COMPLETED',
    });
    expect(rec.params()).toEqual({ from_date: '2026-01-01', to_date: '2026-07-27', order_status: 'COMPLETED' });
    await client.stockx.orders.analytics({ granularity: 'weekly' });
    expect(rec.last.url.pathname).toBe('/v2/stockx/orders/analytics');
    expect(rec.params()).toEqual({ granularity: 'weekly' });
  });

  it('orders iterList and sync', async () => {
    const pages: Record<string, unknown> = {
      '1': { orders: [{ id: 1 }], total: 2 },
      '2': { orders: [{ id: 2 }], total: 2 },
    };
    rec.handler = (r) => json(200, pages[r.url.searchParams.get('page')!]);
    const ids: number[] = [];
    for await (const o of client.stockx.orders.iterList({ pageSize: 1 })) ids.push(o.id);
    expect(ids).toEqual([1, 2]);

    rec.handler = () => json(202, { task_id: 'x', status: 'queued' });
    await client.stockx.orders.sync();
    expect([rec.last.method, rec.last.url.pathname]).toEqual(['POST', '/v2/stockx/orders/sync']);
  });
});

// ----------------------------------------------------------------- errors & retries

describe('errors', () => {
  it.each([
    [400, 'limit exceeds your plan cap', BadRequestError],
    [401, 'Not authenticated', AuthenticationError],
    [403, 'StockX batch operations require the advanced plan', PermissionDeniedError],
    [404, 'No variant found', NotFoundError],
    [409, 'Listing skipped', ConflictError],
    [500, 'boom', InternalServerError],
    [418, 'teapot', APIStatusError],
  ] as const)('%i maps to %o', async (status, detail, cls) => {
    rec.handler = () => json(status, { detail });
    const err = await client.stockx.market.search('X').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(cls);
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err).toBeInstanceOf(SolometricsError);
    const e = err as APIStatusError;
    expect(e.status).toBe(status);
    expect(e.detail).toBe(detail);
    expect(e.message).toBe(`${status}: ${detail}`);
    expect(e.name).toBe(cls.name);
    expect(rec.requests).toHaveLength(1); // never retried
  });

  it('422 exposes field errors', async () => {
    const detail = [{ loc: ['query', 'hours'], msg: 'Input should be less than or equal to 8760' }];
    rec.handler = () => json(422, { detail });
    const err = (await client.inventory.history('DICKS', '1', { hours: 99999 }).catch((e: unknown) => e)) as
      UnprocessableEntityError | undefined;
    expect(err).toBeInstanceOf(UnprocessableEntityError);
    expect(err!.errors).toEqual(detail);
    expect(err!.message).toContain('query.hours');
  });

  it('non-JSON error bodies', async () => {
    rec.handler = () => new Response('<html>Bad Gateway</html>', { status: 502 });
    const err = (await client.stockx.listings.createBySku('S', '10', 250).catch((e: unknown) => e)) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.body).toBe('<html>Bad Gateway</html>');
    expect(err.detail).toBeNull();
  });

  it('204 and empty bodies become null; text stays text', async () => {
    rec.handler = () => new Response(null, { status: 204 });
    expect(await client.stockx.costs.clear()).toBeNull();
    rec.handler = () => new Response('plain', { status: 200 });
    expect(await client.get('/v2/x')).toBe('plain');
  });

  it('429 is retried for POST, then succeeds', async () => {
    const responses = [json(429, { detail: 'Too Many Requests' }, { 'Retry-After': '1' }), json(200, { ok: true })];
    const delays: number[] = [];
    timing.sleep = async (ms) => {
      delays.push(ms);
    };
    rec.handler = () => responses.shift()!;
    expect(await client.stockx.listings.createBySku('S', '10', 250)).toEqual({ ok: true });
    expect(rec.requests).toHaveLength(2);
    expect(delays).toEqual([1000]);
  });

  it('429 exhausted', async () => {
    rec.handler = () => json(429, { detail: 'Too Many Requests' }, { 'Retry-After': '3' });
    const err = (await client.stockx.market.hot().catch((e: unknown) => e)) as RateLimitError;
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(3);
    expect(rec.requests).toHaveLength(3); // 1 + maxRetries(2)
  });

  it('502 is retried for GET, not POST', async () => {
    rec.handler = () => json(502, { detail: 'StockX failed' });
    await expect(client.stockx.listings.list()).rejects.toBeInstanceOf(UpstreamError);
    expect(rec.requests).toHaveLength(3);
    rec.requests = [];
    await expect(client.stockx.listings.createBySku('S', '10', 250)).rejects.toBeInstanceOf(UpstreamError);
    expect(rec.requests).toHaveLength(1);
  });

  it('504 maps to UpstreamTimeoutError', async () => {
    rec.handler = () => json(504, { detail: 'StockX is not responding' });
    await expect(client.withOptions({ maxRetries: 0 }).stockx.listings.list()).rejects.toBeInstanceOf(
      UpstreamTimeoutError,
    );
    expect(rec.requests).toHaveLength(1);
  });

  it('per-call maxRetries', async () => {
    rec.handler = () => json(503, { detail: 'down' });
    await expect(client.stockx.market.hot({ maxRetries: 5 })).rejects.toBeInstanceOf(InternalServerError);
    expect(rec.requests).toHaveLength(6);
  });

  it('connection refused is retried for every method', async () => {
    rec.handler = () => {
      throw fetchFailed('ECONNREFUSED');
    };
    const err = (await client.stockx.listings.createBySku('S', '10', 250).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err).not.toBeInstanceOf(APITimeoutError);
    expect(err.message).toContain('ECONNREFUSED');
    expect(rec.requests).toHaveLength(3);
  });

  it('a dropped connection is retried for GET only', async () => {
    rec.handler = () => {
      throw fetchFailed('ECONNRESET');
    };
    await expect(client.stockx.market.hot()).rejects.toBeInstanceOf(APIConnectionError);
    expect(rec.requests).toHaveLength(3);
    rec.requests = [];
    await expect(client.stockx.listings.createBySku('S', '10', 250)).rejects.toBeInstanceOf(APIConnectionError);
    expect(rec.requests).toHaveLength(1);
  });

  it('a timeout is not retried for POST', async () => {
    rec.handler = hang;
    const c = makeClient(rec, { timeout: 5 });
    await expect(c.stockx.listings.createBySku('S', '10', 250)).rejects.toBeInstanceOf(APITimeoutError);
    expect(rec.requests).toHaveLength(1);
    rec.requests = [];
    await expect(c.stockx.listings.list({ timeout: 5 })).rejects.toBeInstanceOf(APITimeoutError);
    expect(rec.requests).toHaveLength(3);
  });

  it('a user abort is not retried', async () => {
    rec.handler = hang;
    const controller = new AbortController();
    const p = client.stockx.market.hot({ signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(p).rejects.toBeInstanceOf(APIUserAbortError);
    expect(rec.requests).toHaveLength(1);

    await expect(client.stockx.market.hot({ signal: AbortSignal.abort() })).rejects.toBeInstanceOf(APIUserAbortError);
    expect(rec.requests).toHaveLength(1);
  });
});

// ----------------------------------------------------------------- low-level

describe('low-level requests', () => {
  it('get / post / put / patch / delete', async () => {
    rec.handler = () => json(200, { hello: 'world' });
    expect(await client.get<{ hello: string }>('/v2/stockx/new', { query: { x: 1, flags: ['a', 'b'] } })).toEqual({
      hello: 'world',
    });
    expect(rec.last.rawUrl).toBe(`${BASE}/v2/stockx/new?x=1&flags=a&flags=b`);
    await client.post('/v2/p', { body: { a: 1 } });
    expect([rec.last.method, rec.lastJson()]).toEqual(['POST', { a: 1 }]);
    await client.put('/v2/p');
    await client.patch('/v2/p', { body: [] });
    await client.delete('/v2/p', { query: { ok: false, none: null } });
    expect(rec.requests.map((r) => r.method)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    expect(rec.last.rawUrl).toBe(`${BASE}/v2/p?ok=false`);
  });
});
