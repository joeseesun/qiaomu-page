"use strict";
const { createHash, randomUUID, randomBytes } = require("node:crypto");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const isPublic = (row) => !row?.access_mode || row.access_mode === "public";
async function installAccess({
  app,
  db,
  indexRoutes,
  auth,
  repository,
  baseUrl,
  owns,
}) {
  const state = async (row) => ({
    mode: row.access_mode,
    revision: row.access_revision,
    slug: row.slug,
    links: await db
      .prepare(
        "SELECT id,name,expires,revoked,created_at FROM share_links WHERE slug=? ORDER BY created_at DESC",
      )
      .all(row.slug),
  });
  const owned = async (req, res) => {
    const row = await repository.raw(req.params.slug);
    if (!row || !owns(req, row)) {
      res.status(404).json({ error: "作品不存在。" });
      return null;
    }
    return row;
  };
  app.get("/api/v1/works/:slug/access", auth.guard, async (req, res) => {
    const row = await owned(req, res);
    if (row) res.json(await state(row));
  });
  indexRoutes.patch("/api/v1/works/:slug/access", async (req, res) => {
    const row = await owned(req, res);
    if (!row) return;
    if (!["public", "private", "link"].includes(req.body.mode))
      return res
        .status(400)
        .json({
          error: "访问模式需为 public、private 或 link。",
          code: "INVALID_ACCESS_MODE",
        });
    if (req.body.revision !== row.access_revision)
      return res
        .status(409)
        .json({
          error: "访问权限已改变，请重新读取。",
          code: "ACCESS_CONFLICT",
        });
    if (row.access_mode !== req.body.mode) {
      await db
        .prepare(
          "UPDATE works SET access_mode=?,access_revision=access_revision+1 WHERE slug=?",
        )
        .run(req.body.mode, row.slug);
      // Old credentials must not come back to life after toggling modes.
      await db
        .prepare("UPDATE share_links SET revoked=1 WHERE slug=?")
        .run(row.slug);
    }
    res.json(await state(await repository.raw(row.slug)));
  });
  indexRoutes.post("/api/v1/works/:slug/access/links", async (req, res) => {
    const row = await owned(req, res);
    if (!row) return;
    if (row.access_mode !== "link")
      return res
        .status(409)
        .json({
          error: "请先将访问模式设为受限链接。",
          code: "ACCESS_MODE_REQUIRED",
        });
    const { key, name = "分享链接", expires = null } = req.body;
    if (
      typeof key !== "string" ||
      !/^[a-f0-9]{64}$/.test(key) ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 80 ||
      (expires !== null &&
        (!Number.isSafeInteger(expires) ||
          expires <= Date.now() ||
          expires > Date.now() + 366 * 86400000))
    )
      return res
        .status(400)
        .json({
          error: "链接参数无效，过期时间最多一年。",
          code: "INVALID_SHARE_LINK",
        });
    const hash = digest(key),
      previous = await db
        .prepare("SELECT * FROM share_links WHERE hash=?")
        .get(hash);
    if (previous) {
      if (
        previous.slug !== row.slug ||
        previous.name !== name.trim() ||
        previous.expires !== expires ||
        previous.revoked
      )
        return res
          .status(409)
          .json({
            error: "分享请求已改变或已撤销。",
            code: "SHARE_LINK_CONFLICT",
          });
      return res.json({
        id: previous.id,
        expires: previous.expires,
        replayed: true,
      });
    }
    if (
      (
        await db
          .prepare(
            "SELECT count(*) n FROM share_links WHERE slug=? AND revoked=0 AND (expires IS NULL OR expires>?)",
          )
          .get(row.slug, Date.now())
      ).n >= 50
    )
      return res
        .status(409)
        .json({
          error: "每站最多 50 个有效分享链接。",
          code: "SHARE_LINK_LIMIT",
        });
    const id = randomUUID();
    await db
      .prepare(
        "INSERT INTO share_links(id,slug,hash,name,expires,revoked,created_at) VALUES(?,?,?,?,?,0,?)",
      )
      .run(id, row.slug, hash, name.trim(), expires, Date.now());
    res.status(201).json({ id, expires });
  });
  indexRoutes.delete(
    "/api/v1/works/:slug/access/links/:id",
    async (req, res) => {
      const row = await owned(req, res);
      if (!row) return;
      const link = await db
        .prepare("SELECT id FROM share_links WHERE id=? AND slug=?")
        .get(req.params.id, row.slug);
      if (!link) return res.status(404).json({ error: "链接不存在。" });
      await db
        .prepare("UPDATE share_links SET revoked=1 WHERE id=? AND slug=?")
        .run(link.id, row.slug);
      res.json({ ok: true, id: link.id, revoked: true });
    },
  );
  async function allows(req, row) {
    if (isPublic(row)) return true;
    const member = await auth.identity(req);
    return !!member && (member.admin || member.id === row.owner_id);
  }
  async function shared(req, row) {
    if (
      row.access_mode !== "link" ||
      !/^[a-f0-9]{64}$/.test(req.params.shareKey || "")
    )
      return false;
    return !!(await db
      .prepare(
        "SELECT id FROM share_links WHERE hash=? AND slug=? AND revoked=0 AND (expires IS NULL OR expires>?)",
      )
      .get(digest(req.params.shareKey), row.slug, Date.now()));
  }
  async function ownerView(req, row) {
    const member = await auth.identity(req);
    if (!member || !(member.admin || member.id === row.owner_id)) return null;
    return db.transaction(async () => {
      const fresh = await repository.raw(row.slug);
      if (!fresh?.published || isPublic(fresh)) return null;
      await db
        .prepare("DELETE FROM viewer_sessions WHERE expires<=?")
        .run(Date.now());
      const proof = JSON.stringify(auth.viewingProof(req));
      // Bound short-lived viewing sessions for each owner credential.
      if (
        (
          await db
            .prepare("SELECT count(*) n FROM viewer_sessions WHERE proof=?")
            .get(proof)
        ).n >= 50
      )
        await db
          .prepare(
            "DELETE FROM viewer_sessions WHERE hash IN (SELECT hash FROM viewer_sessions WHERE proof=? ORDER BY expires LIMIT 1)",
          )
          .run(proof);
      const key = randomBytes(32).toString("hex");
      await db
        .prepare("INSERT INTO viewer_sessions VALUES(?,?,?,?,?)")
        .run(
          digest(key),
          row.slug,
          proof,
          fresh.access_revision,
          Date.now() + 5 * 60000,
        );
      return baseUrl + "/r/" + key + "/" + row.slug + "/";
    });
  }
  async function viewer(req, row) {
    if (!/^[a-f0-9]{64}$/.test(req.params.shareKey || "")) return false;
    if (await shared(req, row)) return true;
    if (isPublic(row)) return false;
    const session = await db
      .prepare(
        "SELECT * FROM viewer_sessions WHERE hash=? AND slug=? AND access_revision=? AND expires>?",
      )
      .get(
        digest(req.params.shareKey),
        row.slug,
        row.access_revision,
        Date.now(),
      );
    if (!session) return false;
    const member = await auth.viewingIdentity(JSON.parse(session.proof));
    return !!member && (member.admin || member.id === row.owner_id);
  }
  app.post("/api/v1/works/:slug/access/open", async (req, res) => {
    const row = await owned(req, res);
    if (!row) return;
    const url = isPublic(row)
      ? baseUrl + "/s/" + row.slug + "/"
      : await ownerView(req, row);
    if (!url) return res.status(403).json({ error: "无法打开此作品。" });
    res.json({
      url,
      expires: Date.now() + 5 * 60000,
      sensitive: !isPublic(row),
    });
  });
  return { allows, shared: viewer, ownerView };
}
module.exports = { installAccess, isPublic };
