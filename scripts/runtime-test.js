import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { apiFixture, env } from '../test/helpers.js';
import { sampleBlocks } from '../test/fixtures.js';

// Exercise the built artifact, workerd's scheduled handler and actual local KV.
// All outbound requests are intercepted; no account or real document is used.
const { FEED_KV: _unused, ...bindings } = env();
const api = apiFixture();
const mf = new Miniflare({
  cf: false,
  host: '127.0.0.1',
  telemetry: { enabled: false },
  workers: [{
    config: {
      name: 'rss-test', type: 'worker', compatibilityDate: '2026-09-07',
      manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: await readFile('dist/worker.js', 'utf8') } } },
      env: { ...Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, { type: 'text', value }])), FEED_KV: { type: 'kv', id: 'rss-test' } },
    },
    dev: { outboundService: { type: 'fetcher', handler: async request => {
    api.outboundCount = (api.outboundCount ?? 0) + 1;
    if (new URL(request.url).pathname.endsWith('/blocks')) {
      api.blocksRead.push('one');
      return Response.json({ code: 0, data: { items: sampleBlocks, has_more: false } });
    }
    return api.fetch(request.url, { method: request.method, headers: Object.fromEntries([...request.headers].map(([key, value]) => [key === 'authorization' ? 'Authorization' : key, value])), body: request.method === 'POST' ? await request.text() : undefined });
    } } },
  }],
});
try {
  const health = await mf.dispatchFetch('https://rss.example/health');
  assert.equal(health.status, 200);
  const handle = await mf.getWorker();
  const result = await handle.scheduled({ cron: '30 2 * * MON-FRI', scheduledTime: Date.UTC(2026, 8, 7, 2, 30) });
  assert.equal(result.outcome, 'ok', `outbound calls: ${api.outboundCount ?? 0}`);
  const url = `https://rss.example/feed/${bindings.FEED_TOKEN}.xml`;
  const feed = await mf.dispatchFetch(url);
  assert.equal(feed.status, 200);
  assert.match(await feed.text(), /<h1>每日技术简报<\/h1>/);
  const cache = await mf.dispatchFetch(url, { headers: { 'If-None-Match': feed.headers.get('etag') } });
  assert.equal(cache.status, 304);
  assert.equal((await mf.dispatchFetch('https://rss.example/feed/wrong.xml')).status, 404);
  await handle.scheduled({ cron: '30 2 * * MON-FRI', scheduledTime: Date.UTC(2026, 8, 8, 2, 30) });
  assert.deepEqual(api.blocksRead, ['one']);
  console.log('workerd 验证通过：定时同步 → 本地 KV → HTML RSS → 304 → 重复执行去重。');
} finally {
  await mf.dispose();
}
