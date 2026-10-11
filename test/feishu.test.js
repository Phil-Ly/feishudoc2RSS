import test from 'node:test';
import assert from 'node:assert/strict';
import { FeishuClient } from '../src/feishu.js';
import { apiFixture, env, file } from './helpers.js';

test('uses application credentials and the configured folder; obtains formatted blocks', async () => {
  const api = apiFixture();
  const client = new FeishuClient(env(), { fetchImpl: api.fetch });
  assert.equal((await client.listFiles())[0].token, 'one');
  assert.equal((await client.getBlocks('one'))[1].text.elements[0].text_run.content, '正文 one');
  assert.equal(api.requestCount, 3);
});

test('uses distinct directory and document continuation fields across all pages', async () => {
  const api = apiFixture();
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/files')) return Response.json({ code: 0, data: u.searchParams.has('page_token')
      ? { files: [file('two')], has_more: false }
      : { files: [file('one')], has_more: true, next_page_token: 'files-next' } });
    if (u.pathname.endsWith('/blocks')) return Response.json({ code: 0, data: u.searchParams.has('page_token')
      ? { items: [{ block_id: 'p' }], has_more: false }
      : { items: [{ block_id: 'doc' }], has_more: true, page_token: 'blocks-next' } });
    return api.fetch(url, init);
  };
  const client = new FeishuClient(env(), { fetchImpl });
  assert.deepEqual((await client.listFiles()).map(f => f.token), ['one', 'two']);
  assert.deepEqual((await client.getBlocks('one')).map(b => b.block_id), ['doc', 'p']);
});

test('rejects missing or repeated continuation rather than returning a partial result', async () => {
  for (const next of [undefined, 'same']) {
    const api = apiFixture();
    const client = new FeishuClient(env(), { fetchImpl: (url, init) => new URL(url).pathname.endsWith('/files')
      ? Response.json({ code: 0, data: { files: [], has_more: true, next_page_token: next } }) : api.fetch(url, init) });
    await assert.rejects(client.listFiles(), error => error.code === 'PAGINATION_ERROR');
  }
});

test('retries temporary HTTP failure and never exposes upstream error text', async () => {
  const api = apiFixture();
  let attempts = 0;
  const client = new FeishuClient(env(), { sleep: async () => {}, fetchImpl: (url, init) => {
    if (new URL(url).pathname.endsWith('/files') && attempts++ === 0) return new Response('sensitive upstream text', { status: 503 });
    return api.fetch(url, init);
  } });
  assert.equal((await client.listFiles()).length, 1);
  api.failIds.add('one');
  await assert.rejects(client.getBlocks('one'), error => error.code === 'FEISHU_API' && !error.message.includes('private'));
});

test('bounds external requests and rejects malformed JSON responses', async () => {
  const api = apiFixture();
  const client = new FeishuClient(env(), { fetchImpl: api.fetch, maxRequests: 2 });
  await client.listFiles();
  await assert.rejects(client.getBlocks('one'), error => error.code === 'REQUEST_BUDGET');
  const malformed = new FeishuClient(env(), { fetchImpl: async () => new Response('<html>secret</html>') });
  await assert.rejects(malformed.listFiles(), error => error.code === 'FEISHU_RESPONSE' && !error.message.includes('secret'));
});

test('validates missing configuration before contacting Feishu', async () => {
  let contacted = false;
  await assert.rejects(async () => {
    const client = new FeishuClient(env({ FEISHU_APP_SECRET: '' }), { fetchImpl: async () => { contacted = true; } });
    await client.listFiles();
  }, error => error.code === 'CONFIG_ERROR');
  assert.equal(contacted, false);
});

test('uses the redirect mode supported by workerd and rejects redirects without following them', async () => {
  const client = new FeishuClient(env(), { sleep: async () => {}, fetchImpl: async (_url, init) => {
    if (init.redirect !== 'manual') throw new TypeError('workerd supports only manual or follow');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } });
  } });
  await assert.rejects(client.listFiles(), error => error.code === 'FEISHU_HTTP' && /302/.test(error.message));
});
