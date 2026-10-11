# FeishuDoc2RSS

将飞书云空间文件夹中的新版文档发布为可在 NetNewsWire 阅读的 HTML 全文 RSS。使用 Cloudflare Workers + KV；运行代码无第三方依赖。产品范围、调度与排版支持以 [SPEC.md](SPEC.md) 为准，验证方式与未覆盖项见 [TESTING.md](TESTING.md)。

## 本地使用

需要 Node.js 22 或以上。

```sh
npm ci
npm test
npm run build
npm run test:runtime
npm run demo
```

- `build` 仅执行 dry-run，生成 `dist/worker.js`，不会上传或部署。
- `test:runtime` 使用本机 workerd 与 KV，飞书请求全部替换为合成响应，不需要任何账户。须先运行 build；修改代码后重新 build 再测试。
- `demo` 生成 `dist/demo.html` 和 `dist/demo.xml`，用于检查合成样例的排版。
- `npm ci` 安装固定版本的开发工具；不会安装运行时业务依赖。

需要连接自己的飞书文档时：

```sh
cp .dev.vars.example .dev.vars
```

在编辑器中填写 `.dev.vars`，不要把凭证发到聊天或提交 Git。然后运行：

```sh
npm run dev
```

Wrangler 会使用本地 KV，默认配置里的全零 namespace ID 仅用于本地，不能当作真实云端 ID。开发服务器不自动执行 cron；另一个终端可手动触发一次本地同步：

```sh
curl 'http://localhost:8787/__scheduled?cron=30+2+*+*+MON-FRI'
```

该路径由 Wrangler 的 `--test-scheduled` 提供，生产 Worker 不开放此接口。同步成功后在 NetNewsWire 添加本地订阅地址：

```text
http://localhost:8787/feed/<你的 FEED_TOKEN>.xml
```

本地地址只适用于在同一台电脑直接抓取的阅读器，云端同步服务或手机不能访问电脑的 localhost。

## 飞书应用准备

本项目使用企业自建应用身份，自动获取短期 tenant_access_token；不依赖手动复制访问 token，也不使用个人浏览器 Cookie。

1. 在[飞书开发者后台](https://open.feishu.cn/app)创建或选择自建应用，取得 App ID 与 App Secret。
2. 为应用开通并发布生效所需的只读接口权限：以[文件夹清单接口](https://open.feishu.cn/document/server-docs/docs/drive-v1/folder/list)和[获取文档所有块接口](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/list)页面列出的权限为准。正文通常使用 `docx:document:readonly`。无需图片下载或写入权限。
3. 把目标文件夹及其中的文档授权给该应用，并确保以后新增文档也可由应用访问。只有 API scope 不等于拥有文档访问权限；可按[云空间 FAQ](https://open.feishu.cn/document/server-docs/docs/drive-v1/faq)配置应用访问。不要为此把文档设为互联网公开。
4. 从文件夹 URL 的 `/folder/` 后取得 token，仅填 token，不填完整链接。确认是普通云空间文件夹，且文档链接为 `/docx/`。

配置项：

| 名称 | 填写内容 |
| --- | --- |
| `FEISHU_APP_ID` | 飞书自建应用 App ID |
| `FEISHU_APP_SECRET` | 应用密钥 |
| `FEISHU_FOLDER_TOKEN` | 目标文件夹 token |
| `FEED_TOKEN` | 至少 32 字符的随机订阅密钥，只使用字母、数字、`_`、`-` |

可用密码管理器生成随机密钥。订阅地址就是读取凭证，持有地址者能读取全文；不要放入公开仓库、截图或公开日志。Cloudflare Secrets 与本地 `.dev.vars` 分别配置，二者不会自动同步。

## Cloudflare 部署

不需要另购服务器。下面采用控制台部署，避免要求你先配置 CLI 登录。

1. 在 Cloudflare 的 Workers & Pages 中创建一个 Worker，选择 Free 计划。
2. 打开 Worker 代码编辑器，将本地 `dist/worker.js` 的完整内容作为 Worker 模块代码保存。不要上传源码目录，也不要把代码当作 Pages 静态网页。
3. 创建一个 KV namespace，在该 Worker 的 Bindings 中绑定它，变量名必须为 **`FEED_KV`**。KV 名称自定；不要使用配置文件中的全零占位 ID。
4. 在 Worker 的 Variables and Secrets 中添加上述四项配置，建议均使用 Secret 类型；不要把值粘进 JavaScript。
5. 可选普通变量 `FEED_TITLE`、`FEED_DESCRIPTION` 用于标题与描述；`FEED_ITEMS`、`INITIAL_ITEMS`、`MAX_NEW_ITEMS` 的默认值及含义见 SPEC.md。首次回填分批执行，不会额外安排每小时任务。
6. 设置 compatibility date 为 `2026-09-07`，配置文件里的唯一 cron 为 **`30 2 * * MON-FRI`**。Cloudflare cron 按 UTC，含义是周一至周五北京时间 10:30。不要同时新增其他周期。
7. 发布并启用 Worker 的 `workers.dev` 地址。首次正式定时同步成功后，将以下地址添加到 NetNewsWire：

```text
https://<Worker 名称>.<账户子域名>.workers.dev/feed/<FEED_TOKEN>.xml
```

8. 按 TESTING.md 完成云端验收。部署后、首次同步前，RSS 返回 503 是正常状态。10:30 之后才新增的文档将在下一个工作日被发现；NetNewsWire 的实际显示时间还取决于阅读器的刷新周期。

如果以后改用 Wrangler 部署：先将 `wrangler.jsonc` 的 KV ID 换成真实 ID，确保云端 Secret 已设置。不要同时在控制台和文件中维护两套不同的定时配置。当前项目没有自动部署脚本。

## 运行与排错

- `/health` 返回 200 只说明 HTTP 服务可用；它不检查飞书权限，也不能证明已经同步。
- 404：检查订阅路径、密钥是否正确。
- 503：检查是否尚未执行首次同步，以及 Worker 配置/KV 绑定。
- 定时日志 `sync` 只记录新增数量、待处理数量、非 docx 类型数量和受控错误信息。`sync_failed` 表示需要检查配置或上游状态。默认不持久记录请求日志，以免记录含订阅密钥的 URL；需要诊断时可在控制台查看实时日志，并妥善处理带地址的日志。
- `FEISHU_API` / `FEISHU_HTTP`：对照错误码检查 API 权限、应用发布和文件夹/文档授权。
- `UNSUPPORTED_BLOCK` / `UNSUPPORTED_ELEMENT`：文档含当前规格外的内容，失败篇会继续待重试。可提供不含敏感内容的同类样例扩展转换器。
- `EMPTY_DOCUMENT`：可能检查时正文尚未写完；本次不收录，之后重试。有部分正文时无法自动判断作者是否写完，文档应在检查前发布完成。
- 免费版的 CPU 时间是否足够必须云端实测。超限时先降低 `MAX_NEW_ITEMS` 并观察；单篇仍超限则免费版尚未满足该文档负载，不能以本地测试代替判断。

参考：[Cron 配置](https://developers.cloudflare.com/workers/configuration/cron-triggers/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[KV 定价](https://developers.cloudflare.com/kv/platform/pricing/)。
