import { AppError } from './errors.js';
import { required } from './config.js';

const BASE = 'https://open.feishu.cn/open-apis';

export class FeishuClient {
  constructor(env, { fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxRequests = 35 } = {}) {
    this.appId = required(env, 'FEISHU_APP_ID');
    this.appSecret = required(env, 'FEISHU_APP_SECRET');
    this.folder = required(env, 'FEISHU_FOLDER_TOKEN');
    if (!/^[A-Za-z0-9_-]+$/.test(this.folder)) throw new AppError('CONFIG_ERROR', 'FEISHU_FOLDER_TOKEN 应为文件夹 token，不是完整 URL。');
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.maxRequests = maxRequests;
    this.requests = 0;
    this.token = null;
  }

  async request(path, init = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.requests >= this.maxRequests) throw new AppError('REQUEST_BUDGET', '本次飞书请求额度已用完，尚未完成的文档留待后续处理。');
      this.requests++;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let retry = false;
      try {
        // workerd's native fetch must not receive the FeishuClient as its `this` value.
        const fetchImpl = this.fetchImpl;
        const response = await fetchImpl(`${BASE}${path}`, { ...init, signal: controller.signal, redirect: 'manual' });
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel();
          if (attempt === 2) throw new AppError('FEISHU_HTTP', `飞书服务暂不可用（HTTP ${response.status}）。`);
          retry = true;
        } else {
          if (!response.ok) {
            await response.body?.cancel();
            throw new AppError('FEISHU_HTTP', `飞书请求失败（HTTP ${response.status}），请检查权限及配置。`);
          }
          let body;
          try { body = await response.json(); }
          catch { throw new AppError('FEISHU_RESPONSE', '飞书返回了无法解析的响应。'); }
          if (!body || typeof body.code !== 'number') throw new AppError('FEISHU_RESPONSE', '飞书响应结构异常。');
          if (body.code !== 0) throw new AppError('FEISHU_API', `飞书接口失败（错误码 ${body.code}），请检查应用权限及文档授权。`);
          return body;
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (attempt === 2) throw new AppError('FEISHU_NETWORK', '连接飞书失败或请求超时。');
        retry = true;
      } finally {
        clearTimeout(timeout);
      }
      if (retry) await this.sleep(1000 * (attempt + 1));
    }
  }

  async authenticate() {
    if (this.token) return;
    const body = await this.request('/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });
    if (typeof body.tenant_access_token !== 'string' || !body.tenant_access_token) throw new AppError('FEISHU_RESPONSE', '飞书认证响应缺少访问凭证。');
    this.token = body.tenant_access_token;
  }

  async paginate(path, params, field, nextField) {
    await this.authenticate();
    const items = [];
    const pages = new Set();
    let pageToken;
    do {
      const query = new URLSearchParams(params);
      if (pageToken) query.set('page_token', pageToken);
      const { data } = await this.request(`${path}?${query}`, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!data || !Array.isArray(data[field]) || typeof data.has_more !== 'boolean') throw new AppError('FEISHU_RESPONSE', '飞书分页响应结构异常。');
      items.push(...data[field]);
      if (!data.has_more) return items;
      pageToken = data[nextField];
      if (typeof pageToken !== 'string' || !pageToken || pages.has(pageToken)) throw new AppError('PAGINATION_ERROR', '飞书分页游标缺失或重复，拒绝使用不完整清单。');
      pages.add(pageToken);
    } while (true);
  }

  listFiles() {
    return this.paginate('/drive/v1/files', { folder_token: this.folder, page_size: '200', order_by: 'CreatedTime', direction: 'DESC' }, 'files', 'next_page_token');
  }

  getBlocks(documentId) {
    return this.paginate(`/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`, { page_size: '500', document_revision_id: '-1' }, 'items', 'page_token');
  }
}
