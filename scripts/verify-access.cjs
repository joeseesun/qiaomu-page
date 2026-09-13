"use strict";
const { createApp } = require("../server"),
  { createServer } = require("node:http"),
  { randomBytes } = require("node:crypto"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require("playwright");
(async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port,
    token = randomBytes(32).toString("hex");
  const runtime = await createApp({ token, dbPath: ":memory:", baseUrl: base });
  server.on("request", runtime.app);
  const call = (p, body, method = body ? "POST" : "GET") =>
    fetch(base + p, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const html =
    '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>访问权限验收</title><link rel="stylesheet" href="style.css"></head><body><h1>只有受邀的人，才能看到。</h1><p id="result">正在检查资源…</p><img src="picture.svg" alt="测试图片"><script type="module" src="app.js"></script></body></html>';
  const files = {
    "index.html": html,
    "style.css":
      "body{font:18px system-ui;margin:36px;background:#fafafa;color:#171717}h1{font-size:32px}img{width:80px}",
    "picture.svg":
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="20" fill="#171717"/></svg>',
    "value.json": '{"ok":true}',
    "app.js":
      'import {text} from "./nested.js";const data=await(await fetch("./value.json")).json();document.querySelector("#result").textContent=text;document.body.dataset.ready=String(data.ok);document.body.dataset.origin=origin;',
    "nested.js": 'export const text="脚本、样式、图片和数据均已加载。";',
  };
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    assert.equal(
      (
        await call(
          "/api/v1/works/check",
          {
            title: "权限验收",
            files: Object.entries(files).map(([path, value]) => ({
              path,
              data: Buffer.from(value).toString("base64"),
            })),
          },
          "PUT",
        )
      ).status,
      201,
    );
    await call(
      "/api/v1/works/check/access",
      { mode: "link", revision: 0 },
      "PATCH",
    );
    const key = randomBytes(32).toString("hex");
    const { id } = await (
      await call("/api/v1/works/check/access/links", {
        key,
        name: "Browser test",
      })
    ).json();
    const url = base + "/r/" + key + "/check/";
    fs.mkdirSync("artifacts", { recursive: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url);
      await page.locator('body[data-ready="true"]').waitFor();
      assert.equal(
        await page.locator("body").getAttribute("data-origin"),
        "null",
      );
      assert.equal(
        await page
          .locator("img")
          .evaluate((x) => x.complete && x.naturalWidth > 0),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: path.resolve("artifacts/access-" + width + ".png"),
      });
      await page.close();
    }
    await call("/api/v1/works/check/access/links/" + id, undefined, "DELETE");
    assert.equal((await fetch(url + "app.js")).status, 403);
    await call(
      "/api/v1/works/check/access",
      { mode: "private", revision: 1 },
      "PATCH",
    );
    const owner = await browser.newPage();
    const grant = await (await call("/api/v1/dashboard-link", {})).json();
    await owner.goto(grant.url);
    await owner.locator("#workspace").waitFor({ state: "visible" });
    await owner.goto(base + "/s/check/");
    await owner.locator('body[data-ready="true"]').waitFor();
    assert.equal(
      await owner.locator("body").getAttribute("data-origin"),
      "null",
    );
    await owner.close();
    console.log(
      "Restricted share and private owner browser checks passed: 1440/390px, nested modules, fetch, image, CSS, opaque origin and revoked resources.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => {
      server.close(r);
      server.closeIdleConnections();
    });
    runtime.db.close();
  }
})().catch((e) => {
  console.error(e.message.replace(/\/r\/[a-f0-9]{64}/g, "/r/[redacted]"));
  process.exitCode = 1;
});
