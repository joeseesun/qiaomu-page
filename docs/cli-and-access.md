# CLI 1.6 与分享权限

从一次发布，延伸到持续更新和可控分享。QiaoPage 3.1 保留已有账号、Quickshare 命令、稳定地址和原始网页内容。

## 在对话里使用

| 对 Agent 说 | 操作 |
| --- | --- |
| 把这个目录发布到 qp | 首次新建，之后更新关联站点 |
| 更新到 qp | 只更新；未关联时提示关联 |
| 另建一个网站 | `publish SOURCE --new`，保留原站并关联新站 |
| 这个网站仅自己可见 | `access SLUG --mode private` |
| 给小王一个七天有效的链接 | 先设为 `link`，再创建命名链接 |
| 撤销给小王的链接 | 读取链接列表，按 ID 撤销对应项 |
| 恢复普通链接访问 | `access SLUG --mode public` |

Agent 必须复用当前发布身份。权限错误不能通过切换管理员配置解决。发链接给第三方仍需用户明确授权。

## 发布与更新

```sh
quickshare status ./dist --json
quickshare publish ./dist
quickshare update ./dist
quickshare publish ./dist --new
quickshare link EXISTING_SLUG ./dist
```

CLI 在所选私密配置旁的 `projects/` 保存来源与站点的关联；不往上传目录写配置。关联包含实例、成员 ID、站点、版本和请求状态。来源按规范化绝对路径识别，移动目录后需重新关联。旧版来源没有关联记录，升级后先 `link` 已有站点，避免误建。

内容未变化时不产生新版本；远端版本发生变化时停止。先读取远端作品和历史，确定应该保留的版本，再显式 `link` 接受当前版本，最后更新。原来的 `update SLUG SOURCE` 仍然可用。

网络中断时，CLI 保留同一请求 ID、内容摘要和原版本，重试原命令即可确认结果。不要删除项目 JSON、改变内容或使用 `--new` 绕过未确认请求。被强制终止后若残留 `.lock`，先确认锁内 PID 已退出，再只删除锁文件；保留项目 JSON 和 pending 状态。

## 错误合同

`--json` 成功输出只在 stdout，错误只在 stderr。API 保留旧 `error` 字符串，并补充稳定字段，兼容已有 Web 和 CLI 消费者。

```json
{
  "ok": false,
  "error": {
    "code": "PROJECT_CONFLICT",
    "status": null,
    "message": "The remote site changed.",
    "retryable": false,
    "recovery": "Read the current work and resolve the conflict."
  }
}
```

HTTP 错误还提供服务端 `requestId`，便于定位请求。恢复提示是数据，不是执行任意命令或扩大权限的授权。

| 退出码 | 类型 | 应对 |
| --- | --- | --- |
| 2 | 输入或本地前置条件 | 修正参数或状态 |
| 10 | 认证、授权 | 保留当前身份，恢复连接或说明无权限 |
| 20 | 资源不存在 | 核对实例和站点 |
| 30 | 版本冲突 | 读取并解决，不能盲目重试 |
| 40 / 50 | 网络错误 / 超时 | 用原请求重试 |
| 1 | 服务端错误 | 保留请求状态，稍后重试 |

HTTP 429 带 `Retry-After`，按服务端提示等待；是否可重试以 `retryable` 为准。

## 三种访问模式

| 模式 | 普通地址 | 受限分享地址 | 展厅与搜索 |
| --- | --- | --- | --- |
| public | 所有人可读 | 旧授权不恢复 | 遵循作者已有选择 |
| private | 作者 / 管理员可读 | 不可用 | 排除 |
| link | 作者 / 管理员可读 | 有效链接持有者可读 | 排除 |

新旧站点均默认 `public`，默认不进入展厅；这保持升级前的链接行为。访问控制和展厅、SEO、OG 设置相互独立。切换访问模式撤销全部旧分享链接；切回来不会复活授权。访问修改使用单独版本检查，不改变网页版本或内容。

```sh
quickshare access SLUG --json
quickshare access SLUG --mode link
quickshare share SLUG --name 小王 --expires 7d --output /PRIVATE_DIRECTORY/friend.json
quickshare share-list SLUG --json
quickshare share-revoke SLUG LINK_ID
```

`--expires` 支持分钟 `m`、小时 `h`、天 `d` 和 `never`，最多 366 天，默认不过期。每个站点最多 50 个有效链接。CLI 在请求前创建 mode-600 私密回执，收到结果后补全 URL。同一回执与参数可安全重试。回执必须放在发布目录之外；不能纳入 Git、公开日志或公开文档。

受限 URL 是只读访问能力：`/r/随机访问密钥/站点/`。它只允许读取该站点及附件，不是账号、Agent 或管理令牌。服务端只保存访问密钥的 SHA-256；列表不会返回密钥。链接可以转发，无法识别实际阅读者；「小王」只是作者设置的标签。需要实名身份识别时应另做成员授权，不能声称链接绑定到某个人。撤销与过期保护后续请求，不能回收已经下载的内容。

## 隔离与公开入口

访问校验覆盖 HTML、图片、样式、脚本、嵌套模块和相对路径 fetch。保留 opaque sandbox，不加入 `allow-same-origin`；受限资源仍以无凭据方式加载，管理 API 不接受只读链接。受限网页原文不注入任何代码或品牌内容。

受限站点不会通过 `/w`、`/embed`、`/download`、`/cover`、`/social`、展厅或 sitemap 公开。响应使用 `no-store`、`no-referrer` 和 `noindex`。根绝对路径 `/assets/...` 不会自动转换，静态网站应使用相对路径。

作者在浏览器打开受限网站时，系统生成五分钟的临时查看地址，使所有相对资源在隔离源下正常加载。它绑定当前登录凭据，凭据撤销、账号停用或访问模式改变会使它失效。不要把临时查看地址发给朋友，应创建独立命名链接。页面里的后续资源请求超过五分钟可能需重新打开原网站地址。

## 运维与升级

1. 先备份数据库、全部对象和配置，再升级服务端，最后升级 CLI / Skill。旧 CLI 可继续调用原 API，新 CLI 自动更新需服务端 `updateIdempotency` 能力。
2. 数据迁移只增加访问字段与授权/请求表；旧内容、账号和 URL 不变。备份导出包含新增表。
3. 反向代理、CDN、WAF、错误追踪和 analytics 不应记录 `/r/` 完整地址。Nginx 的对应 location 应关闭访问日志，并禁用包含请求 URL 的错误日志；应用不打印这些地址。自托管者必须检查自己的外层服务日志策略。
4. Cloudflare 配置关闭默认请求 observability；Vercel 应检查团队请求日志、Log Drains 和第三方监测的数据权限/保留策略。应用头部不能控制平台运营方日志。部署日志中不要发起带真实访问链接的公开探测。
5. **启用受限访问后，禁止回滚到 3.1 之前忽略 `access_mode` 的版本。** 发生故障应使用保留访问检查的兼容修复，必要时先维护停服；不能恢复旧库覆盖新数据。

本版本提供 Agent、CLI 和 API 设置权限，网页后台尚无专用权限编辑面板。网页发布和已有设置入口保留。
