"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { createServer } = require("node:http"),
  { randomBytes } = require("node:crypto");
const { createApp } = require("../server");
const token = "access-admin-test-".repeat(3);
async function fixture(t) {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port;
  const runtime = await createApp({ token, dbPath: ":memory:", baseUrl: url });
  server.on("request", runtime.app);
  t.after(
    () =>
      new Promise((r) => {
        server.close(() => {
          runtime.db.close();
          r();
        });
        server.closeIdleConnections();
      }),
  );
  const call = (p, body, method = body ? "POST" : "GET", key = token) =>
    fetch(url + p, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: url,
        ...(key ? { Authorization: "Bearer " + key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const invite = await (await call("/api/v1/invites", { label: "A" })).json(),
    guest = randomBytes(32).toString("hex");
  await call(
    "/auth/accept",
    { invite: invite.code, apiToken: guest },
    "POST",
    null,
  );
  const html =
    '<!doctype html><html><head><title>Private title</title></head><body><h1>Exact source</h1><script type="module" src="app.js"></script></body></html>';
  await call(
    "/api/v1/works/protected",
    {
      title: "Private title",
      listed: true,
      files: [
        { path: "index.html", data: Buffer.from(html).toString("base64") },
        {
          path: "app.js",
          data: Buffer.from('document.body.dataset.loaded="yes"').toString(
            "base64",
          ),
        },
      ],
    },
    "PUT",
    guest,
  );
  const mode = async (value) => {
    const a = await (
      await call("/api/v1/works/protected/access", undefined, "GET", guest)
    ).json();
    return call(
      "/api/v1/works/protected/access",
      { revision: a.revision, mode: value },
      "PATCH",
      guest,
    );
  };
  return { ...runtime, server, url, call, mode, guest, html };
}
test("private and link modes protect every legacy public surface without changing source or gallery preference", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.call("/s/protected/", undefined, "GET", null)).status,
    200,
  );
  await f.mode("private");
  for (const p of [
    "/s/protected/",
    "/s/protected/app.js",
    "/w/protected",
    "/embed/protected",
    "/download/protected",
    "/cover/protected",
    "/social/protected",
  ]) {
    const r = await f.call(p, undefined, "GET", null);
    assert.ok([403, 404].includes(r.status), p);
    assert.ok(!(await r.text()).includes("Exact source"));
  }
  assert.equal(
    (await (await f.call("/api/v1/works", undefined, "GET", null)).json()).works
      .length,
    0,
  );
  assert.ok(
    !(await (await f.call("/explore", undefined, "GET", null)).text()).includes(
      "Private title",
    ),
  );
  assert.ok(
    !(
      await (await f.call("/sitemap.xml", undefined, "GET", null)).text()
    ).includes("/s/protected/"),
  );
  assert.equal(
    (
      await (
        await f.call("/api/v1/works/protected", undefined, "GET", f.guest)
      ).json()
    ).work.html,
    f.html,
  );
  assert.equal(
    f.db.prepare("SELECT listed FROM works WHERE slug='protected'").get()
      .listed,
    1,
  );
  await f.mode("public");
  assert.equal(
    await (await f.call("/s/protected/", undefined, "GET", null)).text(),
    f.html,
  );
});
test("scoped links preserve files, never grant management access, and revoke immediately", async (t) => {
  const f = await fixture(t);
  await f.mode("link");
  const key = randomBytes(32).toString("hex"),
    body = { key, name: "Friend", expires: Date.now() + 60000 };
  const endpoint = "/api/v1/works/protected/access/links";
  const created = await f.call(endpoint, body, "POST", f.guest);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  assert.ok(id);
  assert.equal(
    (await (await f.call(endpoint, body, "POST", f.guest)).json()).replayed,
    true,
  );
  const route = "/r/" + key + "/protected/";
  assert.equal(
    await (await f.call(route, undefined, "GET", null)).text(),
    f.html,
  );
  const js = await f.call(route + "app.js", undefined, "GET", null);
  assert.equal(js.status, 200);
  assert.equal(js.headers.get("cache-control"), "no-store");
  assert.equal(js.headers.get("referrer-policy"), "no-referrer");
  const cors = await fetch(f.url + route + "app.js", {
    headers: { Origin: "null" },
  });
  assert.equal(cors.headers.get("access-control-allow-origin"), "null");
  assert.equal(cors.headers.get("access-control-allow-credentials"), null);
  assert.equal((await f.call("/api/v1/me", undefined, "GET", key)).status, 401);
  assert.equal(
    (await f.call("/s/protected/app.js", undefined, "GET", key)).status,
    403,
  );
  assert.ok(
    !(
      await (
        await f.call(
          "/api/v1/works/protected/access",
          undefined,
          "GET",
          f.guest,
        )
      ).text()
    ).includes(key),
  );
  assert.ok(
    !f.db
      .prepare("SELECT * FROM share_links")
      .all()
      .some((r) => JSON.stringify(r).includes(key)),
  );
  assert.equal((await f.call(route, {}, "POST", null)).status, 405);
  await f.call(endpoint + "/" + id, undefined, "DELETE", f.guest);
  assert.equal((await f.call(route, undefined, "GET", null)).status, 403);
  assert.equal(
    (await f.call(route + "app.js", undefined, "GET", null)).status,
    403,
  );
  assert.equal((await f.call(endpoint, body, "POST", f.guest)).status, 409);
});
test("expired links, different sites, mode changes, ownership and CAS remain isolated", async (t) => {
  const f = await fixture(t);
  await f.mode("link");
  const key = randomBytes(32).toString("hex");
  const endpoint = "/api/v1/works/protected/access";
  await f.call(
    endpoint + "/links",
    { key, name: "Expiring", expires: Date.now() + 60000 },
    "POST",
    f.guest,
  );
  const route = "/r/" + key + "/protected/";
  f.db.prepare("UPDATE share_links SET expires=0").run();
  assert.equal((await f.call(route, undefined, "GET", null)).status, 403);
  assert.equal(
    (await f.call(endpoint, { mode: "public", revision: 0 }, "PATCH", f.guest))
      .status,
    409,
  );
  await f.mode("public");
  await f.mode("link");
  assert.equal((await f.call(route, undefined, "GET", null)).status, 403);
  const invite = await (await f.call("/api/v1/invites", { label: "B" })).json(),
    other = randomBytes(32).toString("hex");
  await f.call(
    "/auth/accept",
    { invite: invite.code, apiToken: other },
    "POST",
    null,
  );
  assert.equal((await f.call(endpoint, undefined, "GET", other)).status, 404);
  assert.equal(
    (await f.call(endpoint, { mode: "public", revision: 3 }, "PATCH", other))
      .status,
    404,
  );
  assert.equal(
    (await f.call("/r/" + key + "/other/", undefined, "GET", null)).status,
    404,
  );
});
test("private owner viewing sessions are short-lived and tied to current credentials", async (t) => {
  const f = await fixture(t);
  await f.mode("private");
  const opened = await (
    await f.call("/api/v1/works/protected/access/open", {}, "POST", f.guest)
  ).json();
  assert.ok(opened.url);
  assert.ok(opened.expires <= Date.now() + 5 * 60000);
  assert.equal(await (await fetch(opened.url)).text(), f.html);
  assert.equal((await fetch(opened.url + "app.js")).status, 200);
  f.db
    .prepare(
      "DELETE FROM api_keys WHERE member_id=(SELECT owner_id FROM works WHERE slug='protected')",
    )
    .run();
  assert.equal((await fetch(opened.url)).status, 403);
});
