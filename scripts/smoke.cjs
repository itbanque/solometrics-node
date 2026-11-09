// Smoke-test the built CommonJS entry point through the package's "exports" map.
const { Client, NotFoundError, VERSION } = require('solometrics');

const client = new Client('k', {
  fetch: async () => new Response(JSON.stringify({ detail: 'No variant found' }), { status: 404 }),
});
client.stockx.market.search('X').then(
  () => {
    throw new Error('expected NotFoundError');
  },
  (err) => {
    if (!(err instanceof NotFoundError)) throw err;
    console.log(`cjs ok: solometrics ${VERSION}`);
  },
);
