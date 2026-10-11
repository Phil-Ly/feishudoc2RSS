import { documentBlocks, textBlock } from './fixtures.js';

export class MemoryKV {
  values = new Map();
  writes = 0;
  failWrite = false;
  async get(key, type) {
    const value = this.values.get(key);
    return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) {
    if (this.failWrite) throw new Error('storage unavailable');
    this.values.set(key, value);
    this.writes++;
  }
}

export function env(overrides = {}) {
  return { FEED_KV: new MemoryKV(), FEISHU_APP_ID: 'test-app', FEISHU_APP_SECRET: 'fixture-secret', FEISHU_FOLDER_TOKEN: 'folder', FEED_TOKEN: 'fixture-only-abcdefghijklmnopqrstuvwxyz', ...overrides };
}

export function file(id, day = 7) {
  return { token: id, type: 'docx', name: `文档 ${id}`, url: `https://example.feishu.cn/docx/${id}`, created_time: String(Date.UTC(2026, 8, day, 2) / 1000) };
}

export function apiFixture(files = [file('one')]) {
  const state = { files, blocksRead: [], failIds: new Set(), requestCount: 0 };
  state.fetch = async (input, init) => {
    state.requestCount++;
    const url = new URL(input);
    if (url.origin !== 'https://open.feishu.cn') throw new Error('unexpected origin');
    if (url.pathname.endsWith('/auth/v3/tenant_access_token/internal')) {
      if (init.method !== 'POST' || !JSON.parse(init.body).app_secret) throw new Error('invalid auth request');
      return Response.json({ code: 0, tenant_access_token: 'fixture-access', expire: 7200 });
    }
    if (init.headers.Authorization !== 'Bearer fixture-access') throw new Error('missing authorization');
    if (url.pathname === '/open-apis/drive/v1/files') {
      if (url.searchParams.get('folder_token') !== 'folder') throw new Error('wrong folder');
      return Response.json({ code: 0, data: { files: state.files, has_more: false } });
    }
    const id = url.pathname.match(/\/docx\/v1\/documents\/([^/]+)\/blocks$/)?.[1];
    if (id) {
      state.blocksRead.push(id);
      if (state.failIds.has(id)) return Response.json({ code: 1770002, msg: 'private upstream content MUST NOT ESCAPE' });
      return Response.json({ code: 0, data: { items: documentBlocks([textBlock('p', 'text', `正文 ${id}`)]), has_more: false } });
    }
    throw new Error('unexpected path');
  };
  return state;
}
