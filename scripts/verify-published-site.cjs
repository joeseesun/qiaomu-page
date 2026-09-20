"use strict";
const { chromium } = require("playwright");

const raw = process.argv[2];
if (!raw) throw new Error("Usage: npm run verify:published -- https://site.example/");
const target = new URL(raw);
if (!["https:", "http:"].includes(target.protocol)) throw new Error("Use an HTTP(S) URL.");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      const failed = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("requestfailed", (request) => {
        if (new URL(request.url()).origin === target.origin)
          failed.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || "failed"}`);
      });
      const response = await page.goto(target.href, { waitUntil: "networkidle" });
      const state = await page.evaluate(() => ({
        title: document.title.trim(),
        heading: document.querySelector("h1")?.innerText.trim() || "",
        text: document.body.innerText.replace(/\s+/g, " ").trim(),
        width: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      const problems = [
        ...errors.map((message) => `page error: ${message}`),
        ...failed.map((message) => `request failed: ${message}`),
      ];
      if (!response || !response.ok()) problems.push(`document status: ${response?.status() || "none"}`);
      if (!state.title) problems.push("document title is empty");
      if (!state.heading) problems.push("visible h1 is empty");
      if (state.text.length < 80) problems.push(`visible text is unexpectedly short (${state.text.length})`);
      if (state.width > state.viewport + 1) problems.push(`horizontal overflow: ${state.width}px > ${state.viewport}px`);
      results.push({ viewport: viewport.name, ...state, problems });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  const ok = results.every((result) => result.problems.length === 0);
  console.log(JSON.stringify({ ok, url: target.href, results }, null, 2));
  if (!ok) process.exitCode = 1;
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
