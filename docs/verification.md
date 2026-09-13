# 验收记录

2026-09-10。生产迁移、独立云端安装、本地测试分别记录；代码提交和 CI 状态以对应 PR 为准。

## 生产数据迁移

既有生产服务完成存储重构迁移：14 个站点、11 条历史、2 名成员。迁移前后完整逻辑审计一致，14 个公开页面与 16 个资源逐字节读取一致。备份任务已包含数据库和对象文件，并把完整备份恢复到隔离目录核验。HTTPS、健康检查、账号身份、opaque sandbox、桌面及 390px 页面通过。共享主机的其他服务未改变。

生产运行的是已合并的存储版本 8cb1648；后续云适配先在独立安装测试，没有把生产数据复制到测试平台。

## 本地与原生运行时

- `npm run check`、56 项 Node 测试：认证、所有权、并发、版本、原文保真、安装密钥保留、上传分块、身份隔离、哈希、限额、过期、清理、大响应与迁移。
- `npm run verify:cloudflare`：真实本地 Workers 运行时，空数据安装、邀请、身份、幂等发布、冲突、恢复、OG、账号修改、8 MiB CLI 上传、5 MiB 资源读取、下架恢复，再终止并重启 Worker 核验持久数据。
- `npm run verify:ui`：真实 Chrome 桌面和 390px：首页、复制 Prompt、朋友邀请、文件夹上传、原文隔离、历史、密码和停用。已检查截图。
- Docker / libSQL / MinIO 原有验收保留，并由 CI 继续执行。

## 真实 Cloudflare

通过 Wrangler 4.130.0 创建私有 R2，首次部署 SQLite Durable Object + Worker。随后通过一条命令安装脚本重新部署，账号和链接保持。

云端通过：通用 API 验收、8 MiB CLI 文件包、5 MiB 原文资源、下架恢复、1200×630 中文 OG、更新密码、重部署读取。PITR 实测先保存 checkpoint、写入测试标记、恢复，再确认原账号和文件可读、后写入标记不存在。

PITR 不等同异地备份，也不能恢复已删除的 R2 bucket。Cloudflare SQL 数据库和 R2 对象均独立于原生产服务。

## 真实 Vercel

通过 Vercel CLI 59.15.1 创建项目，Marketplace 自动连接 Turso Starter，创建私有 Blob。平台服务条款经本人确认后继续。专用 CJS 构建解决函数运行时的 ESM / 模板加载差异。

云端通过：通用 API 验收、8 MiB CLI 文件包、5 MiB 流式资源、下架恢复、OG、账号修改及重新部署后的身份和原页面。Turso 与引用的 Blob 对象导出成完整备份，恢复到隔离 SQLite + 文件实例，核验身份、HTML、1 MiB 资源和版本历史。

两个平台均已执行桌面 / 390px 真实浏览器读回。网页大文件上传另用 `scripts/verify-browser-upload.cjs` 验证真实 Cookie 会话和分块传输。

## 范围边界

当前验收对象是两个独立测试安装，没有将生产域名或生产账号搬到 Cloudflare / Vercel。CLI 安装流程经过真实执行；公开浏览器部署按钮尚未测试。仓库以 QiaoPage 名称开源，页面与文档同步更名，CLI / API / 旧配置标识兼容保留。没有发布预构建容器镜像或正式发行版。

## 部署按钮

2026-09-13：中英文 README 已加入平台官方按钮。Vercel URL 声明必填管理员 secret、Turso 集成和 private Blob；Cloudflare 使用现有 Wrangler 资源声明，并增加只含空管理员 secret 的 `.dev.vars.example`。示例环境文件中的本地配置改为注释，避免云端向导误导入 localhost 或文件数据库设置。

本次 `npm run check`、66 项 `npm test`、`npm run build:vercel` 和 `npm run verify:cloudflare` 全部通过。按钮参数与两个示例文件仅含空 secret 的断言通过，GitHub Markdown API 确认两种按钮均正确渲染为链接；原有 CLI 与两个云端运行时的验收仍独立成立。**完整浏览器按钮安装尚未验收。** 本次浏览器自动化在进入目标页前无法加载请求头策略，返回 `Unable to load browser request-header policy`；没有把 CLI 部署或文档核对代替成点击按钮成功的证据。安装、首次管理员接入、资源隔离与升级方法见[按钮指南](deploy-buttons.md)。
