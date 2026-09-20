# Qiaomu Page 命名与兼容性

**Qiaomu** 是母品牌，正式产品名是 **Qiaomu Page**，对话简称是 **QP**。网站、README、安装 Prompt、Skill 和新 CLI 只使用这套名称。

| 对象 | 当前正式名称 |
| --- | --- |
| 产品与网站 | Qiaomu Page |
| GitHub 仓库 | `joeseesun/qiaomu-page` |
| Agent Skill | `qiaomu-page` |
| CLI 命令 / 文件 | `qiaomu-page` / `qiaomu-page.js` |
| 对话简称 | `QP` / `qp` |

Quickshare、`quickshare`、`qiaomu-quickshare` 和 `qs` 不再作为公开品牌或推荐简称。它们只属于兼容层。

## 已有安装兼容

已有连接升级时不迁移数据、不重建账号、不更换作品链接：

- `quickshare` CLI 命令仍映射到同一实现；旧下载路径 `/client/quickshare.js` 继续可用。
- `QUICKSHARE_*` 环境变量和 `~/.config/quickshare/` 继续读取。新安装改用 `QIAOMU_PAGE_*` 与 `~/.config/qiaomu-page/`；若检测到旧配置，直接复用，不复制出第二份身份。
- API 路径、数据库表、Cookie、Compose 服务与存储标识保持不变，避免破坏部署和会话。
- 旧 Agent 仍可用 `qiaomu-quickshare` Skill；重新安装或更新时，应将它迁移为 `qiaomu-page`，不能让两个 Skill 同时存在。
- 旧的 QiaoPage、Quickshare 和 QS 对话说法可以静默识别，但产品界面和文档不再主动宣传。

仓库或云项目改名会产生平台级影响。GitHub 的旧仓库 URL 可依赖仓库改名跳转；已有 Cloudflare、Vercel、Docker 项目升级时继续沿用原资源名，新安装才使用 `qiaomu-page`。

## 对话用法

推荐说法只有：

- “发布到 QP”
- “更新 QP 上的这个网站”
- “列出我在 Qiaomu Page 的作品”

`QP` 是自然语言触发词，不额外创建 `qp` shell 命令。单独询问名称或提到 quadratic programming 不构成发布授权。
