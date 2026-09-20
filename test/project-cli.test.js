"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { createServer } = require("node:http"),
  { spawn } = require("node:child_process"),
  { randomUUID } = require("node:crypto");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { createApp } = require("../server");
const token = "project-cli-test-token-".repeat(3);
async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qp-project-test-"));
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port,
    runtime = await createApp({
      token,
      dbPath: path.join(dir, "db.sqlite"),
      baseUrl: url,
      accountOriginTemplate: "https://{handle}.example.test",
    });
  server.on("request", runtime.app);
  t.after(
    () =>
      new Promise((r) => {
        server.close(() => {
          runtime.db.close();
          fs.rmSync(dir, { recursive: true, force: true });
          r();
        });
        server.closeIdleConnections();
      }),
  );
  const cli = path.join(dir, "cli.js"),
    source = path.join(dir, "index.html"),
    config = path.join(dir, "config.json");
  fs.writeFileSync(
    cli,
    await (await fetch(url + "/client/quickshare.js")).text(),
  );
  fs.writeFileSync(source, "<h1>First</h1>");
  fs.writeFileSync(config, JSON.stringify({ url, token }));
  const call = (p, body, method = body ? "POST" : "GET") =>
    fetch(url + p, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const run = (args, extra = {}) =>
    new Promise((r) => {
      const env = { ...process.env, QUICKSHARE_CONFIG: config, ...extra };
      delete env.QUICKSHARE_TOKEN;
      delete env.QUICKSHARE_URL;
      const child = spawn(process.execPath, [cli, ...args, "--json"], {
        cwd: dir,
        env,
      });
      let out = "",
        err = "";
      child.stdout.on("data", (x) => (out += x));
      child.stderr.on("data", (x) => (err += x));
      child.on("close", (code) =>
        r({
          code,
          out,
          err,
          data: out ? JSON.parse(out) : null,
          error: err ? JSON.parse(err).error : null,
        }),
      );
    });
  return { ...runtime, url, call, run, dir, source, config };
}
test("project publish updates a linked site, --new is explicit, and status carries no credentials", async (t) => {
  const f = await setup(t);
  const first = await f.run(["publish", f.source, "--path", "first"]);
  assert.equal(first.code, 0, first.err);
  const slug = first.data.work.slug;
  assert.equal(first.data.work.url, "https://owner.example.test/first/");
  assert.equal((await f.run(["publish", f.source])).data.unchanged, true);
  fs.writeFileSync(f.source, "<h1>Second</h1>");
  const second = await f.run(["publish", f.source]);
  assert.equal(second.code, 0, second.err);
  assert.equal(second.data.work.slug, slug);
  assert.equal(second.data.work.revision, 2);
  const status = await f.run(["status", f.source]);
  assert.equal(status.data.project.slug, slug);
  assert.ok(!status.out.includes(token));
  const other = await f.run(["publish", f.source, "--new"]);
  assert.equal(other.code, 0, other.err);
  assert.notEqual(other.data.work.slug, slug);
  assert.equal(f.db.prepare("SELECT count(*) n FROM works").get().n, 2);
  fs.writeFileSync(f.source, "<h1>Third</h1>");
  const third = await f.run(["update", f.source]);
  assert.equal(third.data.work.slug, other.data.work.slug);
});
test("directory publishing infers a clean display title without rewriting source", async (t) => {
  const f = await setup(t),
    site = path.join(f.dir, "random-staging-name"),
    index = path.join(site, "index.html");
  fs.mkdirSync(site);
  const original = '<!doctype html><html><head><script>const fake="<title>Wrong</title>"</script><title>Jev &amp; Friends</title></head><body><h1>Fallback title</h1></body></html>';
  fs.writeFileSync(index, original);
  const first = await f.run(["publish", site]);
  assert.equal(first.code, 0, first.err);
  assert.equal(first.data.work.title, "Jev & Friends");
  assert.equal(fs.readFileSync(index, "utf8"), original);
  fs.writeFileSync(index, original.replace("Jev &amp; Friends", "Changed source title"));
  const stable = await f.run(["publish", site]);
  assert.equal(stable.data.work.title, "Jev & Friends");
  const explicit = await f.run(["publish", site, "--title", "Chosen display title"]);
  assert.equal(explicit.data.work.title, "Chosen display title");
  assert.match(fs.readFileSync(index, "utf8"), /Changed source title/);

  const headingSite = path.join(f.dir, "another-random-folder"),
    headingIndex = path.join(headingSite, "index.html");
  fs.mkdirSync(headingSite);
  fs.writeFileSync(headingIndex, "<main><h1>Hello <span>World</span></h1></main>");
  const heading = await f.run(["publish", headingSite]);
  assert.equal(heading.data.work.title, "Hello World");
});
test("compatibility check reports isolated-origin needs and blocks hard sandbox violations", async (t) => {
  const f = await setup(t);
  fs.writeFileSync(f.source, "<script>localStorage.getItem('lang')</script><h1>Safe fallback</h1>");
  const warning = await f.run(["check", f.source]);
  assert.equal(warning.code, 0, warning.err);
  assert.equal(warning.data.ok, true);
  assert.equal(warning.data.findings[0].code, "browser-storage");
  fs.writeFileSync(f.source, "<script>navigator.serviceWorker.register('/sw.js')</script>");
  const blocked = await f.run(["check", f.source]);
  assert.equal(blocked.code, 2);
  assert.equal(blocked.data.ok, false);
  assert.equal(blocked.data.findings[0].code, "service-worker");
});
test("project identity and remote revision conflicts fail closed with actionable errors", async (t) => {
  const f = await setup(t);
  const first = await f.run(["publish", f.source]);
  const { slug, revision } = first.data.work;
  await f.call(
    "/api/v1/works/" + slug,
    { title: "Outside edit", html: "<h1>Outside</h1>", revision },
    "PUT",
  );
  fs.writeFileSync(f.source, "<h1>Local edit</h1>");
  const conflict = await f.run(["publish", f.source]);
  assert.equal(conflict.code, 30);
  assert.equal(conflict.error.code, "PROJECT_CONFLICT");
  assert.equal(conflict.error.retryable, false);
  assert.equal((await f.run(["link", slug, f.source])).code, 0);
  assert.equal((await f.run(["update", f.source])).code, 0);
  const grant = await (
    await f.call("/api/v1/invites", { label: "Other identity" })
  ).json();
  const guest = require("node:crypto").randomBytes(32).toString("hex");
  await fetch(f.url + "/auth/accept", {
    method: "POST",
    headers: { Origin: f.url, "Content-Type": "application/json" },
    body: JSON.stringify({ invite: grant.code, apiToken: guest }),
  });
  fs.writeFileSync(f.config, JSON.stringify({ url: f.url, token: guest }));
  const mismatch = await f.run(["publish", f.source]);
  assert.equal(mismatch.error.code, "PROJECT_IDENTITY_MISMATCH");
  assert.equal(f.db.prepare("SELECT count(*) n FROM works").get().n, 1);
});
test("update receipts are atomic, retryable across connections and reject changed payloads", async (t) => {
  const f = await setup(t);
  await f.call(
    "/api/v1/works/demo",
    { title: "Demo", html: "<h1>A</h1>" },
    "PUT",
  );
  const body = {
    title: "Demo",
    html: "<h1>B</h1>",
    revision: 1,
    requestId: randomUUID(),
  };
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => f.call("/api/v1/works/demo", body, "PUT")),
  );
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(
    f.db.prepare("SELECT revision FROM works WHERE slug='demo'").get().revision,
    2,
  );
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  assert.equal(
    (await f.call("/api/v1/works/demo", reordered, "PUT")).status,
    200,
  );
  const changed = await f.call(
    "/api/v1/works/demo",
    { ...body, html: "<h1>C</h1>" },
    "PUT",
  );
  assert.equal(changed.status, 409);
  const error = await changed.json();
  assert.equal(error.code, "REQUEST_CHANGED");
  assert.equal(error.retryable, false);
  assert.ok(error.requestId);
});
test("lost update response recovers the same revision and refuses changed pending input", async (t) => {
  const f = await setup(t);
  let drop = false;
  const proxy = createServer(async (req, res) => {
    const chunks = [];
    for await (const x of req) chunks.push(x);
    const body = Buffer.concat(chunks);
    const upstream = await fetch(f.url + req.url, {
      method: req.method,
      headers: {
        Authorization: req.headers.authorization,
        "Content-Type": "application/json",
      },
      body: body.length ? body : undefined,
    });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (req.method === "PUT" && drop) {
      drop = false;
      res.destroy();
      return;
    }
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    res.end(bytes);
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        proxy.close(r);
        proxy.closeIdleConnections();
      }),
  );
  fs.writeFileSync(
    f.config,
    JSON.stringify({ url: "http://127.0.0.1:" + proxy.address().port, token }),
  );
  const first = await f.run(["publish", f.source]);
  assert.equal(first.code, 0, first.err);
  fs.writeFileSync(f.source, "<h1>Lost update</h1>");
  drop = true;
  const lost = await f.run(["publish", f.source]);
  assert.equal(lost.code, 40);
  assert.equal(lost.error.retryable, true);
  fs.writeFileSync(f.source, "<h1>Do not publish</h1>");
  const changed = await f.run(["publish", f.source]);
  assert.equal(changed.error.code, "PENDING_SOURCE_CHANGED");
  fs.writeFileSync(f.source, "<h1>Lost update</h1>");
  const retry = await f.run(["publish", f.source]);
  assert.equal(retry.code, 0, retry.err);
  assert.equal(retry.data.replayed, true);
  assert.equal(retry.data.work.revision, 2);
});
test("parse failures emit JSON only on stderr with stable exit codes", async (t) => {
  const f = await setup(t);
  const result = await f.run(["publish", f.source, "--not-an-option"]);
  assert.equal(result.code, 2);
  assert.equal(result.out, "");
  assert.ok(result.error.code);
  assert.equal(result.error.retryable, false);
});
test("CLI access commands retain private receipts, retry safely and verify revocation", async (t) => {
  const f = await setup(t),
    published = await f.run(["publish", f.source]);
  const slug = published.data.work.slug;
  const access = await f.run(["access", slug, "--mode", "link"]);
  assert.equal(access.code, 0, access.err);
  assert.equal(access.data.mode, "link");
  const output = path.join(f.dir, "share.json"),
    args = [
      "share",
      slug,
      "--name",
      "Friend",
      "--expires",
      "7d",
      "--output",
      output,
    ];
  const link = await f.run(args);
  assert.equal(link.code, 0, link.err);
  const receipt = JSON.parse(fs.readFileSync(output));
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.ok(!link.out.includes(receipt.key));
  assert.ok(!link.err.includes(receipt.key));
  assert.equal(await (await fetch(receipt.url)).text(), "<h1>First</h1>");
  const retry = await f.run(args);
  assert.equal(retry.data.id, link.data.id);
  const listed = await f.run(["share-list", slug]);
  assert.ok(!listed.out.includes(receipt.key));
  assert.equal(listed.data.links.length, 1);
  assert.equal((await f.run(["share-revoke", slug, link.data.id])).code, 0);
  assert.equal((await fetch(receipt.url)).status, 403);
  assert.equal((await f.run(args)).error.code, "SHARE_LINK_INACTIVE");
});
