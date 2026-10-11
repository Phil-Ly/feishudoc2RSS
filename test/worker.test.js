import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { env, apiFixture } from './helpers.js';
import { syncFeed } from '../src/sync.js';

test('requires the feed secret and returns HTML RSS without contacting Feishu', async () => {
  const binding = env();
  await syncFeed(binding, { fetchImpl: apiFixture().fetch });
  const request = new Request(`https://rss.example/feed/${binding.FEED_TOKEN}.xml`);
  const response = await worker.fetch(request, binding);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/rss\+xml/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(await response.text(), /<content:encoded><!\[CDATA\[<p>正文 one<\/p>/);
  for (const path of ['/feed.xml', '/feed/wrong.xml', '/sync', '/__scheduled']) {
    assert.equal((await worker.fetch(new Request(`https://rss.example${path}`), binding)).status, 404);
  }
});

test('serves conditional GET and HEAD consistently', async () => {
  const binding = env();
  await syncFeed(binding, { fetchImpl: apiFixture().fetch });
  const url = `https://rss.example/feed/${binding.FEED_TOKEN}.xml`;
  const first = await worker.fetch(new Request(url), binding);
  const etag = first.headers.get('etag');
  const cached = await worker.fetch(new Request(url, { headers: { 'If-None-Match': `"other", W/${etag}` } }), binding);
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');
  const head = await worker.fetch(new Request(url, { method: 'HEAD' }), binding);
  assert.equal(head.headers.get('etag'), etag);
  assert.equal(await head.text(), '');
  assert.equal((await worker.fetch(new Request(url, { method: 'POST' }), binding)).status, 405);
});

test('reports missing configuration, not-ready feeds and KV failures without leaking details', async () => {
  const binding = env();
  const request = new Request(`https://rss.example/feed/${binding.FEED_TOKEN}.xml`);
  assert.equal((await worker.fetch(request, binding)).status, 503);
  binding.FEED_KV.get = async () => { throw new Error('credential=private-data'); };
  const failed = await worker.fetch(request, binding);
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /private-data|Error:| at /);
  assert.equal((await worker.fetch(request, env({ FEED_TOKEN: '' }))).status, 503);
  const health = await worker.fetch(new Request('https://rss.example/health'), {});
  assert.deepEqual(await health.json(), { ok: true });
});

test('scheduled execution publishes through the real sync pipeline and surfaces sanitized failure', async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const messages = [];
  try {
    globalThis.fetch = apiFixture().fetch;
    console.log = message => messages.push(message);
    console.error = message => messages.push(message);
    const binding = env();
    await worker.scheduled({}, binding);
    assert.match((await binding.FEED_KV.get('snapshot', 'json')).rss, /正文 one/);
    await assert.rejects(worker.scheduled({}, env({ FEISHU_APP_SECRET: '' })), /配置/);
    assert.doesNotMatch(messages.join('\n'), /fixture-secret|fixture-access/);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
});
