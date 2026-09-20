"use strict";
const { randomInt } = require("node:crypto");

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";

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
  if (probe.protocol !== "https:" && probe.hostname !== "127.0.0.1" && probe.hostname !== "localhost")
    throw new Error("CONTENT_ORIGIN_TEMPLATE must use HTTPS outside local development.");
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

function recommendations(username, title, choose = randomInt) {
  return Array.from({ length: 3 }, () => candidate(username, title, suffix(6, choose)));
}

module.exports = { LABEL, candidate, labelFromHost, recommendations, template, urlFor, userPrefix, validForUser };
