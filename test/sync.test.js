import test from 'node:test';
import assert from 'node:assert/strict';
import { syncFeed } from '../src/sync.js';
import { apiFixture, env, file } from './helpers.js';

test('publishes new documents once with stable dates and skips historical bodies', async () => {
  const binding = env();
  const api = apiFixture([file('one')]);
  const options = { fetchImpl: api.fetch };
  await syncFeed(binding, options);
  const first = await binding.FEED_KV.get('snapshot', 'json');
  await syncFeed(binding, options);
  assert.deepEqual(api.blocksRead, ['one']);
  assert.equal(binding.FEED_KV.writes, 1);
  assert.match(first.rss, /正文 one/);
  api.files.push(file('two', 8));
  await syncFeed(binding, options);
  const next = await binding.FEED_KV.get('snapshot', 'json');
  assert.deepEqual(next.articles.map(a => a.id), ['two', 'one']);
  assert.equal(next.articles[1].published, first.articles[0].published);
  assert.notEqual(next.etag, first.etag);
});

test('limits initial history and processes backlog in bounded batches without loss', async () => {
  const binding = env({ INITIAL_ITEMS: '2', MAX_NEW_ITEMS: '1' });
  const api = apiFixture([file('old', 1), file('middle', 2), file('new', 3)]);
  await syncFeed(binding, { fetchImpl: api.fetch });
  assert.deepEqual(api.blocksRead, ['new']);
  await syncFeed(binding, { fetchImpl: api.fetch });
  assert.deepEqual(api.blocksRead, ['new', 'middle']);
  api.files.push(file('late-added-old-document', 1));
  await syncFeed(binding, { fetchImpl: api.fetch });
  assert.deepEqual(api.blocksRead, ['new', 'middle', 'late-added-old-document']);
  assert.equal((await binding.FEED_KV.get('snapshot', 'json')).seen.includes('old'), true);
});

test('retries failed documents while publishing other successful documents', async () => {
  const binding = env();
  const api = apiFixture([file('bad'), file('good', 8)]);
  api.failIds.add('bad');
  const result = await syncFeed(binding, { fetchImpl: api.fetch });
  assert.equal(result.errors[0].code, 'FEISHU_API');
  assert.equal(result.pending, 1);
  let snapshot = await binding.FEED_KV.get('snapshot', 'json');
  assert.deepEqual(snapshot.articles.map(a => a.id), ['good']);
  assert.equal(snapshot.seen.includes('bad'), false);
  api.failIds.clear();
  await syncFeed(binding, { fetchImpl: api.fetch });
  snapshot = await binding.FEED_KV.get('snapshot', 'json');
  assert.deepEqual(snapshot.articles.map(a => a.id), ['good', 'bad']);
});

test('retains seen IDs after trimming feed so old documents are never reimported', async () => {
  const binding = env({ FEED_ITEMS: '1' });
  const api = apiFixture();
  await syncFeed(binding, { fetchImpl: api.fetch });
  api.files.push(file('two', 8));
  await syncFeed(binding, { fetchImpl: api.fetch });
  await syncFeed(binding, { fetchImpl: api.fetch });
  assert.deepEqual(api.blocksRead, ['one', 'two']);
  assert.deepEqual((await binding.FEED_KV.get('snapshot', 'json')).articles.map(a => a.id), ['two']);
});

test('a failed KV commit preserves the previous feed and leaves new IDs retryable', async () => {
  const binding = env();
  const api = apiFixture();
  await syncFeed(binding, { fetchImpl: api.fetch });
  const before = await binding.FEED_KV.get('snapshot');
  api.files.push(file('two', 8));
  binding.FEED_KV.failWrite = true;
  await assert.rejects(syncFeed(binding, { fetchImpl: api.fetch }));
  assert.equal(await binding.FEED_KV.get('snapshot'), before);
  binding.FEED_KV.failWrite = false;
  await syncFeed(binding, { fetchImpl: api.fetch });
  assert.match((await binding.FEED_KV.get('snapshot', 'json')).rss, /正文 two/);
});

test('folder failure leaves snapshot intact; non-docx files and duplicate IDs do not become articles', async () => {
  const binding = env();
  const api = apiFixture([file('one'), file('one'), { token: 'sheet', type: 'sheet' }]);
  const result = await syncFeed(binding, { fetchImpl: api.fetch });
  assert.equal(result.skippedTypes, 1);
  assert.deepEqual(api.blocksRead, ['one']);
  const before = await binding.FEED_KV.get('snapshot');
  await assert.rejects(syncFeed(binding, { fetchImpl: async () => Response.json({ code: 99991672 }) }));
  assert.equal(await binding.FEED_KV.get('snapshot'), before);
});

test('an empty document is left retryable instead of permanently publishing unfinished content', async () => {
  const binding = env();
  const api = apiFixture();
  const result = await syncFeed(binding, { fetchImpl: (url, init) => new URL(url).pathname.endsWith('/blocks')
    ? Response.json({ code: 0, data: { items: [{ block_id: 'root', block_type: 1, page: {}, children: [] }], has_more: false } }) : api.fetch(url, init) });
  assert.equal(result.pending, 1);
  assert.equal(result.errors[0].code, 'EMPTY_DOCUMENT');
  assert.equal((await binding.FEED_KV.get('snapshot', 'json')).seen.includes('one'), false);
  await syncFeed(binding, { fetchImpl: api.fetch });
  assert.match((await binding.FEED_KV.get('snapshot', 'json')).rss, /正文 one/);
});
