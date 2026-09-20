"use strict";
const { randomInt } = require("node:crypto");

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PATH = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
const reservedHandles = new Set([
  "admin",
  "api",
  "assets",
  "cdn",
  "daohang",
  "img",
  "lib",
  "link",
  "mail",
  "md",
  "newimg",
  "page",
  "pages",
  "rss",
  "share",
  "static",
  "status",
  "tuijian",
  "werss",
  "www",
]);
const genericPathWords = new Set([
  "app",
  "built",
  "demo",
  "made",
  "project",
  "showcase",
  "site",
  "using",
  "web",
  "website",
  "with",
]);

function segment(value, fallback = "site", max = 24) {
  const clean = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return clean || fallback;
}

function suffix(length = 6, choose = randomInt) {
  return Array.from({ length }, () => alphabet[choose(alphabet.length)]).join("");
}

function candidate(username, title, code = suffix()) {
  const user = userPrefix(username);
  const work = segment(title, "site", Math.max(8, 55 - user.length));
  return `${user}-${work}-${code}`.slice(0, 63).replace(/-+$/g, "");
}
function userPrefix(username) {
  return segment(username, "member", 20);
}

function handleCandidate(username) {
  const value = segment(username, "member", 30);
  return reservedHandles.has(value) ? `u-${value}` : value;
}

function pathCandidate(title) {
  const raw = segment(title, "site", 48).split("-");
  const seen = new Set();
  const meaningful = raw.filter((word) => {
    if (seen.has(word) || genericPathWords.has(word)) return false;
    seen.add(word);
    return true;
  });
  return (meaningful.length ? meaningful : raw).join("-").slice(0, 48) || "site";
}

function pathRecommendations(title) {
  const base = pathCandidate(title);
  return [base, `${base}-2`, `${base}-3`].map((value) => value.slice(0, 48).replace(/-+$/g, ""));
}

function validForUser(label, username) {
  return LABEL.test(label || "") && label.startsWith(userPrefix(username) + "-");
}

function template(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(/\/$/, "");
  if (!raw.includes("{label}")) throw new Error("CONTENT_ORIGIN_TEMPLATE must contain {label}.");
  const probe = new URL(raw.replace("{label}", "qiaopage-probe"));
  if (!probe.hostname.includes("qiaopage-probe") || probe.pathname !== "/" || probe.search || probe.hash)
    throw new Error("CONTENT_ORIGIN_TEMPLATE must place {label} in the hostname and contain no path, query or fragment.");
  if (
    probe.protocol !== "https:" &&
    probe.hostname !== "127.0.0.1" &&
    probe.hostname !== "localhost" &&
    !probe.hostname.endsWith(".localhost")
  )
    throw new Error("CONTENT_ORIGIN_TEMPLATE must use HTTPS outside local development.");
  return raw;
}

function accountTemplate(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(/\/$/, "");
  if (!raw.includes("{handle}")) throw new Error("ACCOUNT_ORIGIN_TEMPLATE must contain {handle}.");
  const probe = new URL(raw.replace("{handle}", "qiaopage-probe"));
  if (!probe.hostname.includes("qiaopage-probe") || probe.pathname !== "/" || probe.search || probe.hash)
    throw new Error("ACCOUNT_ORIGIN_TEMPLATE must place {handle} in the hostname and contain no path, query or fragment.");
  if (
    probe.protocol !== "https:" &&
    probe.hostname !== "127.0.0.1" &&
    probe.hostname !== "localhost" &&
    !probe.hostname.endsWith(".localhost")
  )
    throw new Error("ACCOUNT_ORIGIN_TEMPLATE must use HTTPS outside local development.");
  return raw;
}

function urlFor(configured, label, pathname = "/") {
  if (!configured || !LABEL.test(label || "")) return null;
  const base = configured.replace("{label}", label);
  return base + (pathname.startsWith("/") ? pathname : "/" + pathname);
}

function labelFromHost(configured, host) {
  if (!configured || !host) return null;
  const probe = new URL(configured.replace("{label}", "qiaopage-probe"));
  const hostname = String(host).split(":")[0].toLowerCase();
  const marker = "qiaopage-probe";
  const index = probe.hostname.indexOf(marker);
  if (index < 0) return null;
  const prefix = probe.hostname.slice(0, index);
  const suffixText = probe.hostname.slice(index + marker.length);
  if (!hostname.startsWith(prefix) || !hostname.endsWith(suffixText)) return null;
  const label = hostname.slice(prefix.length, hostname.length - suffixText.length);
  return LABEL.test(label) ? label : null;
}

function handleFromHost(configured, host) {
  if (!configured || !host) return null;
  const probe = new URL(configured.replace("{handle}", "qiaopage-probe"));
  const hostname = String(host).split(":")[0].toLowerCase();
  const marker = "qiaopage-probe";
  const index = probe.hostname.indexOf(marker);
  const prefix = probe.hostname.slice(0, index);
  const suffixText = probe.hostname.slice(index + marker.length);
  if (!hostname.startsWith(prefix) || !hostname.endsWith(suffixText)) return null;
  const handle = hostname.slice(prefix.length, hostname.length - suffixText.length);
  return LABEL.test(handle) && !reservedHandles.has(handle) ? handle : null;
}

function accountUrlFor(configured, handle, contentPath, pathname = "/") {
  if (!configured || !LABEL.test(handle || "") || !PATH.test(contentPath || "")) return null;
  const base = configured.replace("{handle}", handle);
  const rest = pathname === "/" ? "" : pathname.replace(/^\//, "");
  return `${base}/${contentPath}/${rest}`;
}

function recommendations(username, title, choose = randomInt) {
  return Array.from({ length: 3 }, () => candidate(username, title, suffix(6, choose)));
}

module.exports = {
  LABEL,
  PATH,
  accountTemplate,
  accountUrlFor,
  candidate,
  handleCandidate,
  handleFromHost,
  labelFromHost,
  pathCandidate,
  pathRecommendations,
  recommendations,
  template,
  urlFor,
  userPrefix,
  validForUser,
};
