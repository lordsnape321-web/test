/**
 * Live suite: the batched-read endpoint.
 *
 *   cd laravel && php artisan serve
 *   cd laravel/tests/api && npm install
 *   BASE_URL=http://127.0.0.1:8000 node batch.mjs
 *
 * The Expo client sends the reads a screen makes in one tick to
 * `POST /api/batch` so a single-threaded dev server answers one request instead
 * of nine (`php artisan serve` handles one at a time, which is the whole reason
 * the route exists). The client has its own tests in the app; this one checks
 * the server half, which is the half that cannot be exercised without PHP:
 *
 *   • a batch of real paths returns the same bodies, in order, that the paths
 *     return on their own;
 *   • a per-path failure is reported per path and does not spoil its neighbours;
 *   • the guard rails hold: only GET /api reads, never recursively, never more
 *     than the documented maximum, never a non-API path;
 *   • the outer request survives the sub-requests (the envelope comes back
 *     intact, and the API still answers normally straight afterwards).
 *
 * HTTP contract only — no database connection needed.
 */

const B = process.env.BASE_URL || 'http://127.0.0.1:8000';

let pass = 0;
let fail = 0;
const ok = (n, c, e = '') => {
  c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (e ? '  → ' + e : '')));
};

const get = async (p) => {
  const r = await fetch(B + p);
  let b = null;
  try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};

const batch = async (paths) => {
  const r = await fetch(B + '/api/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: paths.map((path) => ({ path })) }),
  });
  let b = null;
  try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};

const stable = JSON.stringify;

console.log('\n— the routes a screen batches are available —');
const solo = {};
for (const path of ['/api/venues', '/api/stats', '/api/health']) {
  const one = await get(path);
  solo[path] = one;
  ok(`${path} answers on its own`, one.status === 200, `${one.status} ${stable(one.body).slice(0, 100)}`);
}

console.log('\n— the same reads in one request —');
const paths = Object.keys(solo);
const together = await batch(paths);
ok('the batch is accepted', together.status === 200, `${together.status} ${stable(together.body).slice(0, 140)}`);
const rows = Array.isArray(together.body?.responses) ? together.body.responses : [];
ok('one response per path, in order', rows.length === paths.length, `got ${rows.length} for ${paths.length}`);

paths.forEach((path, i) => {
  ok(
    `${path} comes back identical to its solo call`,
    rows[i]?.status === 200 && stable(rows[i]?.body) === stable(solo[path].body),
    `${rows[i]?.status} ${stable(rows[i]?.body).slice(0, 120)}`,
  );
});

console.log('\n— one bad path does not spoil the batch —');
const mixed = await batch(['/api/stats', '/api/venues/99999999', '/api/health']);
const mixedRows = Array.isArray(mixed.body?.responses) ? mixed.body.responses : [];
ok('every path still gets an answer', mixedRows.length === 3, `got ${mixedRows.length}`);
ok('the good neighbours are 2xx', mixedRows[0]?.status === 200 && mixedRows[2]?.status === 200,
  stable(mixedRows).slice(0, 160));
ok('the unknown venue is a 404 with the app’s error envelope', mixedRows[1]?.status === 404 && typeof mixedRows[1]?.body?.error === 'string',
  `${mixedRows[1]?.status} ${stable(mixedRows[1]?.body).slice(0, 120)}`);

console.log('\n— guard rails —');
const empty = await batch([]);
ok('an empty batch is refused', empty.status === 400, `${empty.status} ${stable(empty.body).slice(0, 100)}`);

const tooMany = await batch(Array.from({ length: 13 }, () => '/api/health'));
ok('more than twelve paths is refused', tooMany.status === 400, `${tooMany.status} ${stable(tooMany.body).slice(0, 100)}`);

const recursive = await batch(['/api/batch']);
const recursiveRows = Array.isArray(recursive.body?.responses) ? recursive.body.responses : [];
ok('the batch route cannot call itself', recursive.status === 200 && recursiveRows[0]?.status === 400,
  `${recursive.status} ${stable(recursiveRows[0]).slice(0, 120)}`);

const outside = await batch(['/up', 'https://example.com/api/venues']);
const outsideRows = Array.isArray(outside.body?.responses) ? outside.body.responses : [];
ok('only /api paths are replayed', outsideRows.every((r) => r?.status === 400),
  stable(outsideRows).slice(0, 140));

const weird = await batch(['/api/venues/../../up', '/api/venues?x=1\nHost: evil']);
const weirdRows = Array.isArray(weird.body?.responses) ? weird.body.responses : [];
ok('traversal and header injection are refused', weirdRows.every((r) => r?.status === 400),
  stable(weirdRows).slice(0, 140));

console.log('\n— the server is unharmed by its own sub-requests —');
const after = await get('/api/stats');
ok('an ordinary request still works afterwards', after.status === 200 && stable(after.body) === stable(solo['/api/stats'].body),
  `${after.status} ${stable(after.body).slice(0, 100)}`);

const healthAfter = await get('/api/health');
ok('and the health payload still describes this build', healthAfter.status === 200 && typeof healthAfter.body?.build === 'string',
  stable(healthAfter.body).slice(0, 120));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
