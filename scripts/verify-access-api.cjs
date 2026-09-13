"use strict";
// Use only a dedicated deployment-verification site, never an arbitrary user site.
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const base = process.env.QUICKSHARE_URL;
const statePath = process.env.QUICKSHARE_TEST_STATE;
if (!base || !statePath)
  throw new Error("Dedicated deployment test state is required");
const state = JSON.parse(fs.readFileSync(statePath));
const call = (
  route,
  body,
  method = body ? "POST" : "GET",
  token = state.guest,
) =>
  fetch(base + route, {
    method,
    signal: AbortSignal.timeout(60000),
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const endpoint = "/api/v1/works/" + state.slug;
(async () => {
  const read = await call(endpoint);
  assert.equal(read.status, 200);
  const { work } = await read.json();
  if (state.access) {
    assert.equal(
      (await call("/s/" + state.slug + "/", undefined, "GET", null)).status,
      403,
    );
    assert.equal(
      await (await call(state.access.path, undefined, "GET", null)).text(),
      state.html,
    );
    assert.equal(
      (await call(state.access.revokedPath, undefined, "GET", null)).status,
      403,
    );
    const access = await (await call(endpoint + "/access")).json();
    assert.equal(access.mode, "link");
    const replay = await call(endpoint, state.access.update, "PUT");
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).work.revision, work.revision);
    console.log(
      "Access restart readback passed: active/revoked grants, denied ordinary URL and update receipt persisted.",
    );
    return;
  }
  const update = {
    title: work.title,
    html: state.html,
    files: JSON.parse(work.files),
    revision: work.revision,
    requestId: randomUUID(),
  };
  const responses = await Promise.all([
    call(endpoint, update, "PUT"),
    call(endpoint, Object.fromEntries(Object.entries(update).reverse()), "PUT"),
  ]);
  assert.ok(responses.every((r) => r.status === 200));
  const first = await responses[0].json(),
    second = await responses[1].json();
  assert.equal(first.work.revision, work.revision + 1);
  assert.equal(second.work.revision, first.work.revision);
  const access = await (await call(endpoint + "/access")).json();
  assert.equal(
    (
      await call(
        endpoint + "/access",
        { mode: "private", revision: access.revision },
        "PATCH",
      )
    ).status,
    200,
  );
  for (const route of [
    "/s/" + state.slug + "/",
    "/download/" + state.slug,
    "/social/" + state.slug,
  ])
    assert.ok(
      [403, 404].includes((await call(route, undefined, "GET", null)).status),
    );
  const privateState = await (await call(endpoint + "/access")).json();
  assert.equal(
    (
      await call(
        endpoint + "/access",
        { mode: "link", revision: privateState.revision },
        "PATCH",
      )
    ).status,
    200,
  );
  const keys = [
      randomBytes(32).toString("hex"),
      randomBytes(32).toString("hex"),
    ],
    ids = [];
  for (const key of keys) {
    const r = await call(endpoint + "/access/links", {
      key,
      name: "Runtime verification",
    });
    assert.equal(r.status, 201);
    ids.push((await r.json()).id);
  }
  const paths = keys.map((key) => "/r/" + key + "/" + state.slug + "/");
  const page = await call(paths[0], undefined, "GET", null);
  assert.equal(await page.text(), state.html);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  assert.doesNotMatch(
    page.headers.get("content-security-policy"),
    /allow-same-origin/,
  );
  assert.equal(
    (await call(endpoint + "/access/links/" + ids[1], undefined, "DELETE"))
      .status,
    200,
  );
  assert.equal((await call(paths[1], undefined, "GET", null)).status, 403);
  state.access = { path: paths[0], revokedPath: paths[1], update };
  fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log(
    "Native access API passed: update idempotency, owner-only, whole-site links, revocation and private headers.",
  );
})().catch((error) => {
  console.error(
    String(error.message).replace(/\/r\/[a-f0-9]{64}/g, "/r/[redacted]"),
  );
  process.exitCode = 1;
});
