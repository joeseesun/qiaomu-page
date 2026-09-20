# 一键部署到自己的账号

README 的两个按钮分别打开平台官方安装向导，在你自己的账号下复制仓库、配置资源并部署。无需向作者申请服务器权限；平台登录、GitHub 授权、套餐和服务条款仍需本人确认。

## 先保存一份管理员密钥

两个平台都需要 `QIAOMU_PAGE_TOKEN`。用密码管理器生成至少 32 字符的随机密钥，保存后填入向导对应字段。不要使用示例密码，也不要放入仓库、按钮 URL 或公开聊天。这不是平台 API Token，也不是以后朋友使用的登录密码。

如果由 Agent 帮你安装，可以让它生成 32 随机字节，并先写入本机私密文件，再通过平台 CLI 配置。已有安装必须保留原密钥；**不要用部署按钮更新现有实例**，应在原项目中重部署或使用 CLI 升级。

## Vercel

1. 点击 **Deploy with Vercel**，选择自己的团队和 GitHub 仓库名称。推荐为新实例使用独立名称。
2. 在 Storage 步骤确认 **Turso** 数据库和 **Private Blob**。按钮已声明两项依赖，并固定 Blob 为私有。创建独立数据库，不连接已有实例的数据库。Turso 区域尽量与函数的 `hnd1`（东京）一致。
3. 输入并私密保存 `QIAOMU_PAGE_TOKEN`，按平台显示的计划和条款确认部署。
4. 部署成功后打开平台给出的生产地址，访问 `/healthz` 应返回 `{"ok":true,"service":"qiaomu-page"}`，再完成下方的管理员接入。

数据库连接由 Turso 集成注入 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`，Blob 凭据由平台注入。应用默认使用私有 Blob 和项目生产域名，不需要填写 `OBJECT_STORE` 或预先猜一个 `BASE_URL`。绑定自己的域名时，再设置明确的 HTTPS `BASE_URL`。

如果向导没有列出两项存储，先取消部署并检查按钮参数/平台支持，或改用[CLI 安装](cloud-install.md)；只有首页构建成功不代表数据库和上传已经可用。

## Cloudflare

1. 点击 **Deploy to Cloudflare**，登录自己的账号，选择复制仓库的位置和 Worker 名称。
2. 保留仓库的构建/部署配置：默认部署命令为 `npx wrangler deploy`，Wrangler 会执行 `build.command` 预编译模板并打包 Worker。不要改成 Pages 或静态站点部署。
3. 确认 **APP / SQLite Durable Object** 和 **OBJECTS / R2** 资源，为新实例创建独立 bucket。若账号尚未开通 R2，按平台指引完成确认。
4. 输入 `QIAOMU_PAGE_TOKEN`。仓库的 `.dev.vars.example` 仅声明这个必填 secret，不含默认密钥。部署后打开 `workers.dev` 地址，检查 `/healthz`，然后连接管理员。

不要复制本地开发的 `localhost`、`DB_PATH` 或 `OBJECT_STORE=filesystem` 配置到云端。数据库位于 Durable Object，文件位于私有 R2。重部署时沿用同一个 Worker 和资源；修改 Worker 名称会得到另一套数据库。

## 部署后，交给 Agent 接入

把下面这段话交给你正在使用的 Agent，替换实例地址和平台名即可；**不要把密钥填进 Prompt**：

```text
我刚用部署按钮在【Vercel 或 Cloudflare】安装了自己的 Qiaomu Page，
实例地址是【平台返回的 HTTPS 生产地址】。
请读取这个实例的 /skill.md，安装或复用 qiaomu-page 与独立 CLI。
先检查已有连接。若这是新的实例，请使用独立的私密配置，不覆盖已有账号。
管理员密钥保存在我的密码管理器或该平台的 QIAOMU_PAGE_TOKEN secret 中。
如能通过已授权的平台 CLI 安全读取，就只通过 stdin 使用；
不能读取时指导我在本机安全输入，不要让我把密钥发到聊天里。
连接成功后生成一次性管理员后台链接，让我设置自己的账号密码。
不要自动发布内容。
```

也可手动连接：克隆仓库，在本机终端执行下列命令。`read -s` 的输入不回显、不进入命令历史；输入时粘贴刚保存的管理员密钥。

```sh
export QIAOMU_PAGE_CONFIG="$HOME/.config/qiaomu-page/my-qiaomu-page.json"
read -r -s qp_admin_secret
printf '%s' "$qp_admin_secret" | env -u QIAOMU_PAGE_TOKEN -u QIAOMU_PAGE_URL \
  node bin/qiaomu-page.js login --url https://YOUR-INSTANCE --token-stdin
unset qp_admin_secret
env -u QIAOMU_PAGE_TOKEN -u QIAOMU_PAGE_URL node bin/qiaomu-page.js dashboard
```

配置路径应使用新的实例专属名称，不覆盖已有文件。一次性后台链接只供本人打开；登录后设置账号，在“朋友”中生成各自的邀请 Prompt。朋友不会拿到你的管理员密钥。

## 设计依据与验证范围

- 使用平台官方按钮素材和官方安装入口，避免自制中转页收集凭据。
- Vercel 使用 [`stores` 参数](https://vercel.com/docs/deploy-button/source)声明 Turso 与私有 Blob；密钥只声明[环境变量名称](https://vercel.com/docs/deploy-button/environment-variables)，不使用秘密默认值。按钮附带真实演示链接和预览图。
- Cloudflare 从 [Wrangler 和 secret 示例文件](https://developers.cloudflare.com/workers/platform/deploy-buttons/)识别资源与输入项。所有资源属于安装者，更新沿用原项目。
- “一键”表示一个入口启动安装向导；不等于跳过平台授权、资源确认或管理员接入。

当前配置依据官方文档核对，现有 CLI 安装与云端发布/上传/恢复已通过测试。全新账号从点击按钮到首次管理员登录的完整浏览器流程尚未验收；具体证据见[验收记录](verification.md#部署按钮)。
