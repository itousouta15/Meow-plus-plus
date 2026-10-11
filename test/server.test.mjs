import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { playgroundServer } from '../tools/serve.mjs';

test('playground serves only public modules and examples, with correct HTTP semantics', async t => {
  const server = playgroundServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await fetch(base);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /喵\+\+ — 語言實驗室/);
  const module = await fetch(`${base}/src/index.js`);
  assert.match(module.headers.get('content-type'), /javascript/);
  assert.match(await module.text(), /export function run/);
  const head = await fetch(`${base}/web/style.css`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.ok(Number(head.headers.get('content-length')) > 0);
  for (const path of ['/package.json', '/node_modules/playwright/package.json', '/src/%2e%2e%2fpackage.json', '/web/not-found.js'])
    assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(base, { method: 'POST', body: 'x' })).status, 405);
  assert.equal((await fetch(base + '/web/%zz')).status, 400);
});
