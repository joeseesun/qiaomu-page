"use strict";
require("dotenv").config({ quiet: true });
const express = require("express");
const { openDatabase } = require("./lib/storage/sqlite");
const { createHash, randomInt } = require("node:crypto");
const { installAccess, isPublic } = require("./lib/access");
const { accounts } = require("./lib/accounts");
const { installPrompt, agentSkill, capabilities } = require("./lib/agent");
const { prepareFiles, validPath, types } = require("./lib/files");
const contentOrigins = require("./lib/content-origins");
const {
  installSharing,
  enhance,
  indexable,
  metadata,
  escape,
  safeUrl,
} = require("./lib/sharing");
const fs = require("node:fs");
const path = require("node:path");

const { objectStorage } = require("./lib/storage/config");
const { ContentStore, snapshot } = require("./lib/storage/content");
const { WorkRepository } = require("./lib/storage/repository");
const asyncRoutes = require("./lib/async-routes");
const atomicRoutes = require("./lib/atomic-routes");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THEMES = ["sage", "sand", "ink", "rose"];
const summaryColumns =
  "slug,title,description,tags,theme,published,revision,created_at,updated_at,cover_mime,owner_id,listed,file_count,byte_size,access_mode,access_revision,content_label";
async function createApp(options = {}) {
  const token = options.token || process.env.QUICKSHARE_TOKEN;
  if (!token || token.length < 32)
    throw new Error(
      "Set QUICKSHARE_TOKEN (at least 32 characters); run npm run setup locally.",
    );
  const dbPath =
    options.dbPath ||
    process.env.DB_PATH ||
    path.join(__dirname, ".data/quickshare.sqlite");
  const db = await openDatabase(
    dbPath,
    options.database,
    options.dbPath ? {} : process.env,
  );
  let objects;
  try {
    objects =
      options.objects ||
      objectStorage(
        dbPath,
        options.dbPath ? { NODE_ENV: process.env.NODE_ENV } : process.env,
      );
    const content = new ContentStore(objects);
    const repository = new WorkRepository(db, content);
    await repository.initialize();
    const app = asyncRoutes(express());
    require("./lib/errors")(app);
    if (options.streamResponses) app.use(require("./lib/stream-responses"));
    const baseUrl = (
      options.baseUrl ||
      process.env.BASE_URL ||
      "http://127.0.0.1:3000"
    ).replace(/\/$/, "");
    const contentOriginTemplate = contentOrigins.template(
      options.contentOriginTemplate || process.env.CONTENT_ORIGIN_TEMPLATE,
    );
    if (
      contentOriginTemplate &&
      new URL(contentOriginTemplate.replace("{label}", "probe")).hostname ===
        new URL(baseUrl).hostname
    )
      throw new Error("Content origins must not use the management host.");
    app.use((req, res, next) => {
      const label = contentOrigins.labelFromHost(
        contentOriginTemplate,
        req.get("host"),
      );
      if (label) req.url = `/__qiaopage_content/${label}${req.url}`;
      next();
    });
    app.disable("x-powered-by");
    app.set("views", path.join(__dirname, "views/showcase"));
    app.set("view engine", "ejs");
    if (!options.render) app.engine("ejs", require("ejs").__express);
    app.locals.baseUrl = baseUrl;
    app.locals.agentPrompt = installPrompt(baseUrl);
    app.locals.portalVersion =
      options.portalVersion ||
      createHash("sha256")
        .update(
          [
            "portal.css",
            "portal.js",
            "sharing.js",
            "agent.js",
            "style.css",
            "site.js",
            "favicon.svg",
          ]
            .map((name) =>
              fs.readFileSync(path.join(__dirname, "public/showcase", name)),
            )
            .join("\n"),
        )
        .digest("hex")
        .slice(0, 12);
    if (options.render)
      app.render = (view, locals, callback) => {
        try {
          callback(
            null,
            options.render(view, {
              ...app.locals,
              ...locals._locals,
              ...locals,
            }),
          );
        } catch (error) {
          callback(error);
        }
      };
    app.locals.siteName = "QiaoPage";
    app.locals.formatDate = (value) =>
      new Date(value)
        .toLocaleDateString("zh-CN", {
          timeZone: "Asia/Shanghai",
          month: "2-digit",
          day: "2-digit",
        })
        .replace("/", " / ");
    const auth = await accounts(app, db, token, baseUrl);
    if (contentOriginTemplate) {
      await db.transaction(async () => {
        const pending = await db
          .prepare(
            "SELECT works.slug,works.title,members.username FROM works JOIN members ON members.id=works.owner_id WHERE works.content_label=''",
          )
          .all();
        for (const work of pending) {
          for (let attempt = 0; attempt < 10; attempt++) {
            const label = contentOrigins.candidate(work.username, work.title);
            try {
              await db
                .prepare("UPDATE works SET content_label=? WHERE slug=? AND content_label=''")
                .run(label, work.slug);
              break;
            } catch (error) {
              if (!/unique/i.test(String(error.message))) throw error;
            }
          }
        }
      });
    }
    const guard = auth.guard;
    const indexRoutes = atomicRoutes(app, db, auth.identity);
    const owns = (req, row) =>
      req.member?.admin || row?.owner_id === req.member?.id;
    const saveVersion = async (row) => await repository.saveVersion(row);
    const authenticated = async (req) =>
      (await auth.identity(req))?.id === req.member.id;
    app.use(async (req, res, next) => {
      res.set({
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
      });
      if (/^\/(api|auth|client)(\/|$)/.test(req.path))
        res.set("X-Robots-Tag", "noindex");
      next();
    });
    if (!options.render)
      app.use(
        "/assets",
        express.static(path.join(__dirname, "public/showcase"), {
          maxAge: "1h",
        }),
      );
    // Authenticate mutations before parsing an uploaded document.
    app.use("/api/v1", async (req, res, next) =>
      ["GET", "HEAD"].includes(req.method) ? next() : guard(req, res, next),
    );
    app.use(express.json({ limit: "16mb", strict: true }));
    auth.routes();
    const access = await installAccess({
      app,
      db,
      indexRoutes,
      auth,
      repository,
      baseUrl,
      owns,
    });
    const rowToWork = (row) => {
      if (!row) return row;
      const legacyUrl = `${baseUrl}/s/${row.slug}/`;
      const contentUrl = contentOrigins.urlFor(
        contentOriginTemplate,
        row.content_label,
      );
      return {
        ...Object.fromEntries(
          Object.entries(row).filter(
            ([key]) =>
              !["content_ref", "content_bytes", "share_image_ref"].includes(
                key,
              ),
          ),
        ),
        tags: JSON.parse(row.tags),
        published: Boolean(row.published),
        listed: Boolean(row.listed),
        url: contentUrl || legacyUrl,
        contentUrl,
        legacyUrl,
        embedUrl: legacyUrl,
      };
    };
    const find = (slug) => repository.get(slug);
    const publicWork = async (req, res, next) => {
      const row = await find(req.params.slug);
      const current = row && (await repository.raw(row.slug));
      if (!row || !current?.published)
        return res
          .status(404)
          .render("error", { message: "这件作品尚未发布，或已经下架。" });
      if (!isPublic(current))
        return res
          .status(404)
          .set("Cache-Control", "no-store")
          .render("error", { message: "此作品未开放公开访问。" });
      res.locals.work = rowToWork(row);
      next();
    };
    async function list(search = "", tag = "", all = false, member = null) {
      const clauses = all
        ? []
        : ["published=1", "listed=1", "access_mode='public'"];
      const params = [];
      if (all && member && !member.admin) {
        clauses.push("owner_id=?");
        params.push(member.id);
      }
      if (search) {
        clauses.push(
          "(instr(lower(title),lower(?))>0 OR instr(lower(description),lower(?))>0)",
        );
        params.push(search, search);
      }
      if (tag) {
        clauses.push(
          "EXISTS (SELECT 1 FROM json_each(works.tags) WHERE value=?)",
        );
        params.push(tag);
      }
      return (
        await db
          .prepare(
            `SELECT ${summaryColumns}${all ? `,(SELECT ${member?.admin ? "COALESCE(NULLIF(note,''),username)" : "username"} FROM members WHERE id=works.owner_id) AS owner_name` : ""} FROM works ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY updated_at DESC,slug`,
          )
          .all(...params)
      ).map(rowToWork);
    }
    installSharing({
      app,
      db,
      guard,
      owns,
      find,
      baseUrl,
      content,
      authenticated,
      renderSvg: options.renderSvg,
    });
    app.get("/healthz", async (req, res) => {
      await db.prepare("SELECT 1").get();
      res.json({ ok: true, service: "quickshare" });
    });
    app.get("/client/quickshare.js", async (req, res) =>
      res.download(path.join(__dirname, "bin/quickshare.js"), "quickshare.js"),
    );
    app.get("/skill.md", async (req, res) =>
      res.type("text/plain").send(agentSkill(baseUrl)),
    );
    app.get("/agent-prompt.txt", async (req, res) =>
      res.type("text/plain").send(installPrompt(baseUrl)),
    );
    app.get("/api/v1/me", guard, async (req, res) =>
      res.json({
        ok: true,
        member: req.member,
        ...(await auth.accountInfo(req)),
      }),
    );
    app.get("/api/v1/capabilities", guard, async (req, res) =>
      res.json(
        capabilities(baseUrl, await auth.accountInfo(req), {
          contentOriginTemplate,
        }),
      ),
    );
    app.get("/api/v1/content-origins/suggestions", guard, async (req, res) => {
      const title = String(req.query.title || "site").slice(0, 100);
      const labels = contentOrigins.recommendations(req.member.username, title);
      res.json({
        enabled: Boolean(contentOriginTemplate),
        username: req.member.username,
        suggestions: labels.map((label) => ({
          label,
          url: contentOrigins.urlFor(contentOriginTemplate, label),
        })),
      });
    });
    app.get("/api/v1/works", async (req, res) => {
      if (req.query.all === "true") {
        await guard(req, res, () => {});
        if (!req.member) return;
        return res.json({ works: await list("", "", true, req.member) });
      }
      res.json({
        works: await list(
          String(req.query.q || "").slice(0, 200),
          String(req.query.tag || "").slice(0, 30),
        ),
      });
    });
    app.get("/api/v1/works/:slug", guard, async (req, res) => {
      const row = await find(req.params.slug);
      if (!row || !owns(req, row))
        return res.status(404).json({ error: "作品不存在。" });
      const { cover, ...work } = rowToWork(row);
      res.set("Cache-Control", "no-store").json({ work });
    });
    async function writeWork(req, res) {
      const creating = req.method === "POST";
      let slug = req.params.slug,
        payloadHash;
      const prefix =
        (typeof req.body.title === "string" ? req.body.title : "")
          .normalize("NFKD")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 45)
          .replace(/-$/, "") || "site";
      const allocate = async () => {
        for (let attempt = 0; attempt < 10; attempt++) {
          const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
          const suffix = options.slugSuffix
            ? options.slugSuffix()
            : Array.from(
                { length: 10 },
                () => alphabet[randomInt(alphabet.length)],
              ).join("");
          const candidate = prefix + "-" + suffix;
          if (!(await repository.raw(candidate))) return candidate;
        }
      };
      const allocateContentLabel = async () => {
        if (!contentOriginTemplate) return "";
        if (req.body.contentLabel !== undefined) return req.body.contentLabel;
        for (let attempt = 0; attempt < 10; attempt++) {
          const label = contentOrigins.candidate(req.member.username, req.body.title);
          const used = await db
            .prepare("SELECT 1 FROM works WHERE content_label=?")
            .get(label);
          if (!used) return label;
        }
        return "";
      };
      const canonical = (v) =>
        Array.isArray(v)
          ? v.map(canonical)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.keys(v)
                  .sort()
                  .map((k) => [k, canonical(v[k])]),
              )
            : v;
      const { requestId } = req.body;
      let updateHash;
      if (!creating && requestId !== undefined) {
        if (
          typeof requestId !== "string" ||
          !/^[a-zA-Z0-9_-]{16,128}$/.test(requestId)
        )
          return res
            .status(400)
            .json({ error: "更新请求标识无效。", code: "INVALID_REQUEST_ID" });
        updateHash = createHash("sha256")
          .update(JSON.stringify(canonical({ slug, body: req.body })))
          .digest("hex");
        const previous = await db
          .prepare(
            "SELECT * FROM update_requests WHERE member_id=? AND request_id=?",
          )
          .get(req.member.id, requestId);
        if (previous) {
          if (previous.payload_hash !== updateHash || previous.slug !== slug)
            return res
              .status(409)
              .json({
                error: "同一请求的内容已改变。",
                code: "REQUEST_CHANGED",
              });
          const row = await find(slug);
          if (!row || !owns(req, row))
            return res.status(404).json({ error: "作品不存在。" });
          const { html, files, cover, ...work } = rowToWork(row);
          return res.json({ work, replayed: true });
        }
      }
      if (creating) {
        if (
          typeof requestId !== "string" ||
          !/^[a-zA-Z0-9_-]{16,128}$/.test(requestId)
        )
          return res
            .status(400)
            .json({ error: "发布请求标识无效，请重新发起发布。" });
        if (req.body.revision !== undefined)
          return res.status(400).json({ error: "更新网站请使用原地址。" });
        const { requestId: omittedId, ...payload } = req.body;
        payloadHash = createHash("sha256")
          .update(JSON.stringify(canonical(payload)))
          .digest("hex");
        const previous = await db
          .prepare(
            "SELECT * FROM publish_requests WHERE member_id=? AND request_id=?",
          )
          .get(req.member.id, requestId);
        if (previous) {
          if (previous.payload_hash !== payloadHash)
            return res.status(409).json({
              code: "REQUEST_CHANGED",
              error: "这次发布的内容已改变。请恢复原内容重试，或发起新的发布。",
            });
          const row = await find(previous.slug);
          if (!row || row.owner_id !== req.member.id)
            return res
              .status(409)
              .json({ error: "原发布记录不可用，请联系管理员。" });
          const { html, files, cover, ...work } = rowToWork(row);
          return res.json({ work, replayed: true });
        }
        slug = req.body.slug;
        if (slug === undefined) {
          slug = await allocate();
          if (!slug)
            return res
              .status(503)
              .json({ error: "暂时无法分配地址，请重试。" });
        }
      }
      if (typeof slug !== "string" || !SLUG.test(slug) || slug.length > 64)
        return res
          .status(400)
          .json({ error: "slug 需为 1–64 位小写英文字母、数字或单连字符。" });
      if (
        creating &&
        req.body.contentLabel !== undefined &&
        (!contentOriginTemplate ||
          !contentOrigins.validForUser(
            req.body.contentLabel,
            req.member.username,
          ))
      )
        return res.status(400).json({
          error:
            "独立子域仅在实例启用内容域后可用，并须采用当前用户名开头的推荐格式。",
        });
      const old = await find(slug);
      if (creating && old)
        return res.status(409).json({
          code: "SLUG_TAKEN",
          error: "这个地址已被使用，请换一个，或留空让系统生成。",
        });
      if (old && !owns(req, old))
        return res.status(404).json({ error: "内容不存在或无权编辑。" });
      let prepared;
      if (req.body.files !== undefined) {
        try {
          prepared = prepareFiles(req.body.files, { title: req.body.title });
          req.body.html = prepared.html;
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }
      const listed = req.body.listed ?? Boolean(old?.listed ?? false);
      if (typeof listed !== "boolean")
        return res.status(400).json({ error: "listed 必须为布尔值。" });
      if (
        !old &&
        (
          await db
            .prepare("SELECT count(*) AS n FROM works WHERE owner_id=?")
            .get(req.member.id)
        ).n >= 100
      )
        return res.status(409).json({ error: "每位成员最多 100 个站点。" });
      if (old && req.body.revision !== old.revision)
        return res.status(409).json({
          error: "作品已存在或版本已改变。请使用 update，刷新后重试。",
        });
      if (!old && req.body.revision !== undefined)
        return res.status(409).json({ error: "作品不存在，无法更新。" });
      const {
        title,
        description = "",
        tags = [],
        html,
        theme = "sage",
        published = true,
      } = req.body;
      let cover = old?.cover || null,
        coverMime = old?.cover_mime || null;
      if (req.body.cover !== undefined) {
        const value = req.body.cover;
        if (
          !value ||
          typeof value.data !== "string" ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)
        )
          return res.status(400).json({ error: "封面格式错误。" });
        const bytes = Buffer.from(value.data, "base64");
        const mime = bytes
          .subarray(0, 8)
          .equals(Buffer.from("89504e470d0a1a0a", "hex"))
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? "image/jpeg"
            : bytes.toString("ascii", 0, 4) === "RIFF" &&
                bytes.toString("ascii", 8, 12) === "WEBP"
              ? "image/webp"
              : null;
        if (!mime || bytes.length > 2 * 1024 * 1024)
          return res
            .status(400)
            .json({ error: "封面需为 2 MB 内的 PNG、JPEG 或 WebP。" });
        cover = bytes.toString("base64");
        coverMime = mime;
      }
      if (
        typeof title !== "string" ||
        !title.trim() ||
        title.length > 100 ||
        typeof description !== "string" ||
        description.length > 600 ||
        !Array.isArray(tags) ||
        tags.length > 8 ||
        tags.some((t) => typeof t !== "string" || !t.trim() || t.length > 30) ||
        typeof html !== "string" ||
        !html.trim() ||
        Buffer.byteLength(html) > 5 * 1024 * 1024 ||
        !THEMES.includes(theme) ||
        typeof published !== "boolean"
      ) {
        return res.status(400).json({
          error:
            "检查标题（100 字内）、简介（600 字内）、标签（最多 8 个）和 HTML（5 MB 内）。",
        });
      }
      const now = new Date().toISOString();
      const fileData = JSON.stringify(prepared?.files || []);
      const candidate = {
        html,
        files: fileData,
        cover,
        cover_mime: coverMime,
        title: title.trim(),
        description: description.trim(),
        tags: JSON.stringify([...new Set(tags.map((t) => t.trim()))]),
        theme,
        file_count: prepared?.files.length || 1,
        byte_size: prepared?.bytes || Buffer.byteLength(html),
      };
      if (
        (await repository.used(old?.owner_id || req.member.id)) +
          Buffer.byteLength(snapshot(candidate)) >
        150 * 1024 * 1024
      )
        return res
          .status(409)
          .json({ error: "版本存储达到 150 MB，请联系管理员扩容。" });
      const packed = await content.pack(candidate);
      const outcome = await repository.transaction(async () => {
        if (!(await authenticated(req)))
          return { status: 401, error: "当前连接已失效，请重新连接。" };
        if (updateHash) {
          const previous = await db
            .prepare(
              "SELECT * FROM update_requests WHERE member_id=? AND request_id=?",
            )
            .get(req.member.id, requestId);
          if (previous)
            return previous.payload_hash === updateHash &&
              previous.slug === slug
              ? { replay: slug }
              : {
                  status: 409,
                  error: "同一请求的内容已改变。",
                  code: "REQUEST_CHANGED",
                };
        }
        if (creating) {
          const previous = await db
            .prepare(
              "SELECT * FROM publish_requests WHERE member_id=? AND request_id=?",
            )
            .get(req.member.id, requestId);
          if (previous)
            return previous.payload_hash === payloadHash
              ? { replay: previous.slug }
              : {
                  status: 409,
                  error: "这次发布的内容已改变。",
                  code: "REQUEST_CHANGED",
                };
        }
        let fresh = await repository.raw(slug);
        if (creating && req.body.slug === undefined && fresh) {
          slug = await allocate();
          if (!slug)
            return { status: 503, error: "暂时无法分配地址，请重试。" };
          fresh = null;
        }
        if (
          (fresh && (!old || fresh.revision !== old.revision)) ||
          (old && !fresh)
        )
          return { status: 409, error: "版本或地址已改变，请重试。" };
        if (
          !old &&
          (
            await db
              .prepare("SELECT count(*) AS n FROM works WHERE owner_id=?")
              .get(req.member.id)
          ).n >= 100
        )
          return { status: 409, error: "每位成员最多 100 个站点。" };
        if (
          (await repository.used(old?.owner_id || req.member.id)) +
            packed.content_bytes >
          150 * 1024 * 1024
        )
          return {
            status: 409,
            error: "版本存储达到 150 MB，请联系管理员扩容。",
          };
        if (fresh) await saveVersion(fresh);
        const contentLabel =
          fresh?.content_label ||
          old?.content_label ||
          (await allocateContentLabel());
        if (
          !fresh &&
          contentLabel &&
          (await db
            .prepare("SELECT 1 FROM works WHERE content_label=?")
            .get(contentLabel))
        )
          return {
            status: 409,
            error: "这个独立子域已被使用，请刷新推荐。",
            code: "CONTENT_LABEL_TAKEN",
          };
        await db
          .prepare(
            `INSERT INTO works(slug,title,description,tags,theme,html,published,revision,created_at,updated_at,cover,cover_mime,owner_id,listed,files,file_count,byte_size,content_ref,content_bytes,content_label)
        VALUES(?,?,?,?,?,'',?,?,?,?,NULL,?,?,?,'[]',?,?,?,?,?)
        ON CONFLICT(slug) DO UPDATE SET title=excluded.title,description=excluded.description,tags=excluded.tags,theme=excluded.theme,
        html='',files='[]',cover=NULL,cover_mime=excluded.cover_mime,published=excluded.published,listed=excluded.listed,
        revision=excluded.revision,updated_at=excluded.updated_at,file_count=excluded.file_count,byte_size=excluded.byte_size,
        content_ref=excluded.content_ref,content_bytes=excluded.content_bytes`,
          )
          .run(
            slug,
            packed.title,
            packed.description,
            packed.tags,
            theme,
            Number(published),
            old ? old.revision + 1 : 1,
            old?.created_at || now,
            now,
            coverMime,
            old?.owner_id || req.member.id,
            Number(listed),
            packed.file_count,
            packed.byte_size,
            packed.content_ref,
            packed.content_bytes,
            contentLabel,
          );
        await saveVersion(await repository.raw(slug));
        if (updateHash)
          await db
            .prepare("INSERT INTO update_requests VALUES(?,?,?,?)")
            .run(req.member.id, requestId, updateHash, slug);
        if (creating)
          await db
            .prepare("INSERT INTO publish_requests VALUES(?,?,?,?)")
            .run(req.member.id, requestId, payloadHash, slug);
        return {};
      });
      if (outcome.error)
        return res.status(outcome.status).json({
          error: outcome.error,
          ...(outcome.code ? { code: outcome.code } : {}),
        });
      if (outcome.replay) {
        const { html, files, cover, ...work } = rowToWork(
          await find(outcome.replay),
        );
        return res.json({ work, replayed: true });
      }
      const {
        html: omitted,
        files: omittedFiles,
        cover: omittedCover,
        ...work
      } = rowToWork(await find(slug));
      res.status(old ? 200 : 201).json({ work });
    }
    const publishWork = writeWork;
    await require("./lib/uploads").uploads(app, indexRoutes, db, publishWork);
    app.post("/api/v1/works", publishWork);
    app.put("/api/v1/works/:slug", publishWork);
    indexRoutes.patch("/api/v1/works/:slug", async (req, res) => {
      const old = await repository.raw(req.params.slug);
      if (!old || !owns(req, old))
        return res.status(404).json({ error: "作品不存在。" });
      if (req.body.revision !== old.revision)
        return res.status(409).json({ error: "版本已改变，请刷新后重试。" });
      if (
        typeof (req.body.published ?? Boolean(old.published)) !== "boolean" ||
        typeof (req.body.listed ?? Boolean(old.listed)) !== "boolean"
      )
        return res.status(400).json({ error: "状态必须为布尔值。" });
      await db
        .prepare(
          "UPDATE works SET published=?,listed=?,revision=revision+1,updated_at=? WHERE slug=?",
        )
        .run(
          Number(req.body.published ?? old.published),
          Number(req.body.listed ?? old.listed),
          new Date().toISOString(),
          old.slug,
        );
      const {
        html: omitted,
        files: omittedFiles,
        cover: omittedCover,
        ...work
      } = rowToWork(await repository.raw(old.slug));
      res.json({ work });
    });
    app.get(["/", "/login", "/join", "/dashboard"], async (req, res) =>
      res
        .set({
          "Cache-Control": "no-store",
          ...(req.path === "/" ? {} : { "X-Robots-Tag": "noindex" }),
        })
        .render("portal", { isHome: req.path === "/" }),
    );
    app.get("/api/v1/works/:slug/versions", guard, async (req, res) => {
      const row = await find(req.params.slug);
      if (!row || !owns(req, row))
        return res.status(404).json({ error: "内容不存在。" });
      res.json({
        versions: await db
          .prepare(
            "SELECT revision,created_at FROM versions WHERE slug=? ORDER BY revision DESC",
          )
          .all(row.slug),
      });
    });
    app.post("/api/v1/works/:slug/rollback", async (req, res) => {
      const old = await find(req.params.slug);
      if (!old || !owns(req, old))
        return res.status(404).json({ error: "内容不存在。" });
      if (old.revision !== req.body.revision)
        return res.status(409).json({ error: "内容已更新，请刷新后重试。" });
      const entry = await db
        .prepare("SELECT snapshot FROM versions WHERE slug=? AND revision=?")
        .get(old.slug, Number(req.body.version) || 0);
      if (!entry) return res.status(404).json({ error: "历史版本不存在。" });
      const data = JSON.parse(entry.snapshot);
      const packed = data.content_ref ? data : await content.pack(data);
      // Check every object before changing the active revision.
      await content.unpack(packed);
      const outcome = await repository.transaction(async () => {
        if (!(await authenticated(req)))
          return { status: 401, error: "当前连接已失效。" };
        const fresh = await repository.raw(old.slug);
        if (!fresh || fresh.revision !== old.revision)
          return { status: 409, error: "内容已更新，请刷新后重试。" };
        if (
          (await repository.used(old.owner_id)) + packed.content_bytes >
          150 * 1024 * 1024
        )
          return { status: 409, error: "历史版本空间已满，请联系管理员。" };
        await saveVersion(fresh);
        await db
          .prepare(
            "UPDATE works SET html='',files='[]',cover=NULL,title=?,description=?,tags=?,theme=?,cover_mime=?,file_count=?,byte_size=?,content_ref=?,content_bytes=?,revision=revision+1,updated_at=? WHERE slug=?",
          )
          .run(
            packed.title,
            packed.description,
            packed.tags,
            packed.theme,
            packed.cover_mime,
            packed.file_count,
            packed.byte_size,
            packed.content_ref,
            packed.content_bytes,
            new Date().toISOString(),
            old.slug,
          );
        await saveVersion(await repository.raw(old.slug));
        return null;
      });
      if (outcome)
        return res.status(outcome.status).json({ error: outcome.error });
      res.json({ ok: true });
    });
    const serveSite = async (req, res) => {
      res.set({
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
      });
      let row = await repository.raw(req.params.slug);
      if (!row || !row.published)
        return res.status(404).type("text").send("内容尚未发布或已下架。");
      if (!["GET", "HEAD"].includes(req.method)) return res.status(405).end();
      if (
        !res.locals.contentOrigin &&
        contentOriginTemplate &&
        isPublic(row) &&
        row.content_label &&
        !req.params.shareKey &&
        req.method === "GET" &&
        req.get("sec-fetch-dest") === "document" &&
        (req.path === "/" || req.path === "")
      )
        return res.redirect(
          302,
          contentOrigins.urlFor(contentOriginTemplate, row.content_label),
        );
      if (
        !isPublic(row) &&
        !req.params.shareKey &&
        req.method === "GET" &&
        req.get("sec-fetch-dest") === "document"
      ) {
        const url = await access.ownerView(req, row);
        if (url)
          return res
            .set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" })
            .redirect(302, url);
      }
      const permitted = () =>
        req.params.shareKey ? access.shared(req, row) : access.allows(req, row);
      if (!(await permitted()))
        return res
          .status(403)
          .set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" })
          .type("text")
          .send("此网站需要有效的访问链接，或作者身份。");
      if (req.path === "/" && !req.originalUrl.split("?")[0].endsWith("/"))
        return res.redirect(
          308,
          req.params.shareKey
            ? `/r/${req.params.shareKey}/${row.slug}/`
            : `/s/${row.slug}/`,
        );
      let name;
      try {
        name = decodeURIComponent(req.path).replace(/^\//, "");
      } catch {
        return res.status(400).end();
      }
      if (!name || name.endsWith("/")) name += "index.html";
      if (!validPath(name)) return res.status(404).end();
      let bytes = await content.file(row, name);
      row = await content.unpack(row, { files: false, images: false });
      if (!(await repository.raw(row.slug))?.published)
        return res.status(404).end();
      const currentAccess = await repository.raw(row.slug);
      row.access_mode = currentAccess.access_mode;
      row.access_revision = currentAccess.access_revision;
      row.owner_id = currentAccess.owner_id;
      if (!(await permitted()))
        return res.status(403).set("Cache-Control", "no-store").end();
      if (!bytes) return res.status(404).type("text").send("文件不存在。");
      res.set({
        "Content-Security-Policy":
          `sandbox allow-scripts allow-forms allow-modals allow-downloads${res.locals.contentOrigin ? " allow-same-origin" : ""}; worker-src 'none'; frame-ancestors ${res.locals.contentOrigin ? "'none'" : "'self'"}; base-uri 'none'`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      });
      if (isPublic(row) && indexable(row) && !req.params.shareKey)
        res.removeHeader("X-Robots-Tag");
      if (name === "index.html" && isPublic(row) && !req.params.shareKey) {
        if (!metadata(row.html).tags.canonical)
          res.set(
            "Link",
            `<${contentOrigins.urlFor(contentOriginTemplate, row.content_label) || `${baseUrl}/s/${row.slug}/`}>; rel="canonical"`,
          );
        if (row.share_enabled) bytes = Buffer.from(enhance(row, baseUrl));
      }
      // Only public site files support anonymous module/font fetch; never use credentials or CORS on management APIs.
      if (
        req.get("origin") === "null" &&
        (isPublic(row) || req.params.shareKey)
      )
        res.set({ "Access-Control-Allow-Origin": "null", Vary: "Origin" });
      res
        .type(
          types[path.extname(name).toLowerCase()] || "application/octet-stream",
        )
        .send(bytes);
    };
    // Read-only capability routes preserve relative paths and exact bytes inside the opaque sandbox.
    app.use("/__qiaopage_content/:contentLabel", async (req, res) => {
      const row = await db
        .prepare("SELECT slug,access_mode,published FROM works WHERE content_label=?")
        .get(req.params.contentLabel);
      if (!row || !row.published || row.access_mode !== "public")
        return res.status(404).type("text").send("内容尚未发布或已下架。");
      req.params.slug = row.slug;
      res.locals.contentOrigin = true;
      return serveSite(req, res);
    });
    app.use("/r/:shareKey/:slug", serveSite);
    app.use("/s/:slug", serveSite);
    app.get("/explore", async (req, res) => {
      const q = String(req.query.q || "").slice(0, 200),
        tag = String(req.query.tag || "").slice(0, 30);
      const tags = (
        await db
          .prepare(
            "SELECT DISTINCT value AS tag FROM works,json_each(works.tags) WHERE published=1 AND listed=1 AND access_mode='public' ORDER BY value",
          )
          .all()
      ).map((r) => r.tag);
      const filtered = await list(q, tag);
      const pages = Math.max(1, Math.ceil(filtered.length / 12));
      const page = Math.min(
        pages,
        Math.max(1, parseInt(req.query.page, 10) || 1),
      );
      res.render("index", {
        works: filtered.slice((page - 1) * 12, page * 12),
        page,
        pages,
        filteredCount: filtered.length,
        q,
        tag,
        tags,
        total: (
          await db
            .prepare(
              "SELECT count(*) AS n FROM works WHERE published=1 AND listed=1 AND access_mode='public'",
            )
            .get()
        ).n,
      });
    });
    app.get("/publish", async (req, res) => res.render("publish"));
    app.get("/w/:slug", publicWork, async (req, res) =>
      res
        .set("X-Robots-Tag", "noindex")
        .render("work", { work: res.locals.work }),
    );
    app.get("/view/:slug", async (req, res) =>
      res.redirect(302, `/w/${encodeURIComponent(req.params.slug)}`),
    );
    app.get("/embed/:slug", publicWork, async (req, res) => {
      // The opaque origin prevents uploaded JavaScript from reading host cookies/storage or authenticated API responses.
      res.set({
        "Content-Security-Policy":
          "sandbox allow-scripts allow-forms allow-modals allow-downloads; frame-ancestors 'self'; base-uri 'none'",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      });
      res.type("html").send(res.locals.work.html);
    });
    app.get("/cover/:slug", publicWork, async (req, res) => {
      if (!res.locals.work.cover) return res.status(404).end();
      if (!indexable(res.locals.work)) res.set("X-Robots-Tag", "noindex");
      res
        .set("Cache-Control", "public, max-age=0, must-revalidate")
        .type(res.locals.work.cover_mime)
        .send(Buffer.from(res.locals.work.cover, "base64"));
    });
    app.get("/download/:slug", publicWork, async (req, res) => {
      res.set({
        "X-Robots-Tag": "noindex",
        "Content-Disposition": `attachment; filename="${res.locals.work.slug}.html"`,
        "Cache-Control": "no-store",
      });
      res.type("application/octet-stream").send(res.locals.work.html);
    });
    app.get("/robots.txt", async (req, res) =>
      res
        .type("text")
        .send(
          `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${baseUrl}/sitemap.xml\n`,
        ),
    );
    app.get("/sitemap.xml", async (req, res) => {
      const urls = ["/", "/publish", "/explore"].map(
        (p) => `<url><loc>${escape(baseUrl + p)}</loc></url>`,
      );
      for (const raw of await db
        .prepare("SELECT * FROM works WHERE published=1 AND search_indexable=1")
        .all()) {
        const row = await content.unpack(raw, { files: false });
        const canonical = metadata(row.html).tags.canonical;
        if (
          indexable(row) &&
          (!canonical ||
            safeUrl(canonical, `${baseUrl}/s/${row.slug}/`) ===
              `${baseUrl}/s/${row.slug}/`)
        )
          urls.push(`<url><loc>${escape(baseUrl)}/s/${row.slug}/</loc></url>`);
      }
      res
        .type("xml")
        .send(
          `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`,
        );
    });
    app.use(async (req, res) =>
      req.path.startsWith("/api/")
        ? res.status(404).json({ error: "接口不存在。" })
        : res.status(404).render("error", { message: "没有找到这个页面。" }),
    );
    app.use((err, req, res, next) => {
      const status =
        err.type === "entity.too.large"
          ? 413
          : err.type === "entity.parse.failed"
            ? 400
            : 500;
      if (status === 500)
        console.error("QiaoPage request failed:", err.message);
      res.status(status).json({
        error:
          status === 413
            ? "上传过大：单文件最多 5 MB、文件合计最多 8 MB。"
            : status === 400
              ? "JSON 格式不正确。"
              : "服务暂时不可用，请稍后重试。",
      });
    });
    return {
      app,
      db: db.raw || db,
      database: db,
      content,
      objects,
      repository,
    };
  } catch (error) {
    db.close();
    objects?.close?.();
    throw error;
  }
}
async function start() {
  const { app, db, objects } = await createApp();
  const server = app.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () =>
      console.log(
        `QiaoPage listening on ${server.address().address}:${server.address().port}`,
      ),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () =>
      server.close(() => {
        db.close();
        objects.close?.();
        process.exit(0);
      }),
    );
}
if (require.main === module)
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { createApp, start };
