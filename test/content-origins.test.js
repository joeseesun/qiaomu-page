"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const origins = require("../lib/content-origins");

test("account handles and project paths stay short, readable and DNS-safe", () => {
  assert.equal(origins.handleCandidate("joe"), "joe");
  assert.equal(origins.handleCandidate("Alice_Team"), "alice-team");
  assert.equal(origins.handleCandidate("www"), "u-www");
  assert.equal(origins.handleCandidate("rss"), "u-rss");
  assert.equal(origins.pathCandidate("Jev Showcase · Built with Jev"), "jev");
  assert.equal(origins.pathCandidate("Focus Clock"), "focus-clock");
  assert.deepEqual(origins.pathRecommendations("My Tool"), [
    "my-tool",
    "my-tool-2",
    "my-tool-3",
  ]);
});

test("account origin templates keep the handle in the host and project in the path", () => {
  const template = origins.accountTemplate("https://{handle}.t5t6.com/");
  assert.equal(template, "https://{handle}.t5t6.com");
  assert.equal(origins.handleFromHost(template, "joe.t5t6.com"), "joe");
  assert.equal(origins.handleFromHost(template, "www.t5t6.com"), null);
  assert.equal(origins.handleFromHost(template, "rss.t5t6.com"), null);
  assert.equal(origins.handleFromHost(template, "www.example.com"), null);
  assert.equal(
    origins.accountUrlFor(template, "joe", "jev", "/assets/app.js"),
    "https://joe.t5t6.com/jev/assets/app.js",
  );
  assert.throws(
    () => origins.accountTemplate("https://pages.example.com/{handle}"),
    /hostname/,
  );
});
