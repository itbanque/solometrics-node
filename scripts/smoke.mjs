// Smoke-test the built ESM entry point through the package's "exports" map.
import { Client, NotFoundError, VERSION } from 'solometrics';

const client = new Client('k', {
  fetch: async () => new Response(JSON.stringify({ detail: 'No variant found' }), { status: 404 }),
});
try {
  await client.stockx.market.search('X');
  throw new Error('expected NotFoundError');
} catch (err) {
  if (!(err instanceof NotFoundError)) throw err;
}
console.log(`esm ok: solometrics ${VERSION}`);
