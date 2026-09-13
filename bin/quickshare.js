#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { parseArgs } = require("node:util");
const configPath =
  process.env.QUICKSHARE_CONFIG ||
  path.join(os.homedir(), ".config/quickshare/config.json");
const CLI_VERSION = "1.6.0";
const { createHash, randomUUID } = require("node:crypto");
let flags = {},
  args = [];
try {
  ({ values: flags, positionals: args } = parseArgs({
    allowPositionals: true,
    options: {
      mode: { type: "string" },
      expires: { type: "string" },
      name: { type: "string" },
      new: { type: "boolean" },
      version: { type: "boolean" },
      username: { type: "string" },
      "password-stdin": { type: "boolean" },
      "verify-password-stdin": { type: "boolean" },
      "generate-password": { type: "boolean" },
      preview: { type: "boolean" },
      gallery: { type: "string" },
      published: { type: "string" },
      note: { type: "string" },
      disabled: { type: "string" },
      cover: { type: "string" },
      capture: { type: "boolean" },
      "share-enabled": { type: "string" },
      indexable: { type: "string" },
      "remove-cover": { type: "boolean" },
      url: { type: "string" },
      "token-stdin": { type: "boolean" },
      "invite-stdin": { type: "boolean" },
      "code-stdin": { type: "boolean" },
      slug: { type: "string" },
      "request-id": { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      tags: { type: "string" },
      theme: { type: "string" },
      draft: { type: "boolean" },
      listed: { type: "boolean" },
      all: { type: "boolean" },
      json: { type: "boolean" },
      output: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  }));
} catch (error) {
  reportError(error, process.argv.includes("--json"));
  process.exit(process.exitCode);
}
const [command = "status", target, file] = args;
const help = `QiaoPage / Quickshare Agent CLI ${CLI_VERSION}
  quickshare whoami --json        # live identity, connection, permissions and usage
  quickshare capabilities --json  # live tools, limits, defaults and boundaries
  quickshare account [--username NAME] [--password-stdin]
  quickshare account --generate-password --output PRIVATE_NEW_FILE
  quickshare account --verify-password-stdin
  quickshare visibility SLUG [--gallery true|false] [--published true|false]
  quickshare access SLUG [--mode public|private|link]
  quickshare share SLUG --name NAME --expires 7d --output PRIVATE_FILE
  quickshare share-list SLUG
  quickshare share-revoke SLUG LINK_ID
  quickshare friends --json
  quickshare friend MEMBER_ID --note TEXT | --disabled true|false
  quickshare reinvite INVITE_ID --output PRIVATE_FILE
  quickshare revoke-invite INVITE_ID
  quickshare recover MEMBER_ID --output PRIVATE_FILE
  sharing --preview previews without saving. Account changes always target the connected member.
  Password changes keep Agent keys, but revoke browser sessions and pending login links.
  Secrets only through stdin/private files, never command arguments.

Publish FILE or DIRECTORY.
  quickshare join --url URL --invite-stdin # activate an invitation without registration
  quickshare connect --url URL --code-stdin # connect an existing space
  quickshare dashboard  # one-use browser login link
  quickshare invite NAME # one-use invitation, admin only
  quickshare sharing SLUG [--share-enabled true|false] [--indexable true|false] [--title TEXT] [--description TEXT] [--cover FILE | --remove-cover]
  quickshare versions SLUG
  quickshare rollback SLUG REVISION
  --listed adds a site to the optional public gallery
  Addresses are assigned automatically; --slug is an optional custom address.
  publish SOURCE creates once, then updates the linked site. publish SOURCE --new creates a separate site.
  update SOURCE requires an existing link. update SLUG SOURCE remains supported.
  link SLUG SOURCE explicitly associates an existing site. status [SOURCE] reads the association.
  Pending retries reuse their request ID; do not change files until an uncertain publish is resolved.
  --request-id ID starts an explicit publication (16–128 letters, numbers, _ or -); reuse it to retry.

QiaoPage — publish an HTML or Markdown work\n\n  quickshare login --url https://share.example.com --token-stdin\n  quickshare publish index.html --slug my-work --title "我的作品" --tags 工具,实验 --capture\n  quickshare update my-work index.html [--title ...] [--description ...]\n  quickshare list [--all] [--json]\n  quickshare get my-work [--output saved.html]\n  quickshare unpublish my-work\n  quickshare restore my-work\n  quickshare doctor\n\nOptions: --description TEXT --tags a,b --theme sage|sand|ink|rose --draft --json --cover cover.png --capture\nMarkdown (.md/.markdown) is rendered as styled HTML.\nDirectories need index.html or index.md; max 100 files, 8 MB total, 5 MB per file.\nToken: saved by login or QUICKSHARE_TOKEN; config: QUICKSHARE_CONFIG.\n`;
function normalizeUrl(raw) {
  const u = new URL(raw);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      ))
  ) {
    throw new Error(
      "Use an HTTPS origin, or HTTP localhost for development; no path/query/credentials.",
    );
  }
  return u.origin;
}
function saveConfig(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const temporary =
    configPath + "." + require("node:crypto").randomBytes(6).toString("hex");
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporary, configPath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
async function privateInput() {
  if (process.stdin.isTTY)
    throw new Error(
      "Read the invitation or connection code through stdin, not command arguments.",
    );
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 4096) throw new Error("Input is too long.");
  }
  return input.trim();
}
function writePrivate(file, text) {
  fs.writeFileSync(file, text, { flag: "wx", mode: 0o600 });
  return path.resolve(file);
}
async function passwordInput() {
  if (process.stdin.isTTY)
    throw new Error(
      "Read the password through stdin or use --generate-password --output PRIVATE_NEW_FILE.",
    );
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk;
    if (Buffer.byteLength(value) > 4096)
      throw new Error("Password input too long.");
  }
  value = value.replace(/\r?\n$/, "");
  if (value.length < 12 || value.length > 200)
    throw new Error("Password must contain 12–200 characters.");
  return value;
}
function boolFlag(name) {
  if (flags[name] === undefined) return undefined;
  if (!["true", "false"].includes(flags[name]))
    throw new Error(name + " must be true or false.");
  return flags[name] === "true";
}
async function main() {
  if (flags.version) return console.log(CLI_VERSION);
  if (flags.mode !== undefined && command !== "access")
    throw new Error("--mode requires access.");
  if (
    ["expires", "name"].some((k) => flags[k] !== undefined) &&
    command !== "share"
  )
    throw new Error("Link options require share.");
  if (
    flags["request-id"] !== undefined &&
    !/^[a-zA-Z0-9_-]{16,128}$/.test(flags["request-id"])
  )
    throw new Error(
      "Request IDs need 16–128 letters, numbers, underscores or hyphens.",
    );
  if (flags.new && command !== "publish")
    throw new Error("--new requires publish.");
  if (args.length > 3) throw new Error("Too many positional arguments.");
  if (
    command !== "account" &&
    [
      "username",
      "password-stdin",
      "generate-password",
      "verify-password-stdin",
    ].some((k) => flags[k] !== undefined)
  )
    throw new Error("Account options require the account command.");
  if (
    command !== "visibility" &&
    ["gallery", "published"].some((k) => flags[k] !== undefined)
  )
    throw new Error("Visibility options require the visibility command.");
  if (
    command !== "friend" &&
    ["note", "disabled"].some((k) => flags[k] !== undefined)
  )
    throw new Error("Member options require the friend command.");
  if (flags.preview && command !== "sharing")
    throw new Error("--preview requires sharing.");
  if (flags.help || !command || command === "help") return console.log(help);
  if (
    command !== "sharing" &&
    ["share-enabled", "indexable", "remove-cover"].some(
      (k) => flags[k] !== undefined,
    )
  )
    throw new Error("Share settings require the sharing command.");
  if (command === "join" || command === "connect") {
    const isInvite = command === "join";
    if (
      args.length !== 1 ||
      !flags.url ||
      !flags[isInvite ? "invite-stdin" : "code-stdin"]
    )
      throw new Error(
        "Use " +
          command +
          " --url URL --" +
          (isInvite ? "invite-stdin" : "code-stdin") +
          "; keep codes out of command arguments.",
      );
    const url = normalizeUrl(flags.url);
    let config = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, "utf8"))
      : null;
    if (config && config.url !== url)
      throw new Error(
        "A different server is configured. Use a separate QUICKSHARE_CONFIG path.",
      );
    let reconnect = false;
    if (config && !config.pending) {
      try {
        const result = await request(config, "/api/v1/me");
        return console.log(
          flags.json
            ? JSON.stringify(result)
            : "Already connected. Existing configuration preserved.",
        );
      } catch (error) {
        if (error.status !== 401) throw error;
        reconnect = true;
      }
    }
    let code = await privateInput();
    if (isInvite && /^https?:/.test(code)) {
      const invitation = new URL(code);
      if (
        invitation.origin !== url ||
        invitation.pathname !== "/join" ||
        invitation.search
      )
        throw new Error("Invitation must belong to the selected server.");
      code = new URLSearchParams(invitation.hash.slice(1)).get("invite") || "";
    }
    if (isInvite) code = code.replace(/[\s-]/g, "").toLowerCase();
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(code))
      throw new Error("Invalid invitation or connection code.");
    if (reconnect) {
      const backup =
        configPath +
        ".revoked-" +
        require("node:crypto").randomBytes(6).toString("hex");
      fs.writeFileSync(backup, fs.readFileSync(configPath), {
        mode: 0o600,
        flag: "wx",
      });
    }
    if (!config || reconnect) {
      config = {
        url,
        token: require("node:crypto").randomBytes(32).toString("hex"),
        pending: true,
      };
      // Persist the private key before redeeming a one-use invitation, so a lost response is retryable.
      saveConfig(config);
    }
    await request(config, isInvite ? "/auth/accept" : "/auth/connect", "POST", {
      [isInvite ? "invite" : "code"]: code,
      apiToken: config.token,
    });
    delete config.pending;
    saveConfig(config);
    const result = await request(config, "/api/v1/me");
    return console.log(
      flags.json
        ? JSON.stringify(result)
        : "Connected. Private credentials saved; registration is optional.",
    );
  }
  if (command === "login") {
    if (!flags.url || !flags["token-stdin"])
      throw new Error("Usage: quickshare login --url URL --token-stdin");
    if (process.stdin.isTTY)
      throw new Error("Pipe your token to stdin; it will not be printed.");
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const config = { url: normalizeUrl(flags.url), token: input.trim() };
    if (config.token.length < 32)
      throw new Error("Token must contain at least 32 characters.");
    await request(config, "/api/v1/me");
    saveConfig(config);
    return console.log(
      flags.json
        ? JSON.stringify({ ok: true, url: config.url })
        : `Connected to ${config.url}. Token saved privately.`,
    );
  }
  let config = {};
  if (fs.existsSync(configPath))
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (
    (flags.url || process.env.QUICKSHARE_URL) &&
    config.url &&
    normalizeUrl(flags.url || process.env.QUICKSHARE_URL) !== config.url &&
    !process.env.QUICKSHARE_TOKEN
  )
    throw new Error(
      "Different server: run login for that server or provide QUICKSHARE_TOKEN explicitly.",
    );
  const serverUrl = flags.url || process.env.QUICKSHARE_URL || config.url;
  if (!serverUrl)
    throw new Error(
      "No Quickshare server configured. Run login --url URL or set QUICKSHARE_URL.",
    );
  config.url = normalizeUrl(serverUrl);
  config.token = process.env.QUICKSHARE_TOKEN || config.token;
  if (!config.token) throw new Error("Run quickshare login first.");
  let result;
  // Reserve a private destination before creating any one-use credential.
  const privateOutput =
    flags.output &&
    ["dashboard", "invite", "recover", "reinvite"].includes(command)
      ? fs.openSync(flags.output, "wx", 0o600)
      : null;
  if (command === "whoami" || command === "doctor")
    result = await request(config, "/api/v1/me");
  else if (command === "capabilities")
    result = await request(config, "/api/v1/capabilities");
  else if (command === "account") {
    if (target)
      throw new Error(
        "Account changes target the authenticated member; no member ID is accepted.",
      );
    const secretFlags = [
      "password-stdin",
      "generate-password",
      "verify-password-stdin",
    ].filter((k) => flags[k]);
    if (secretFlags.length > 1)
      throw new Error("Choose one password input mode.");
    if (flags["verify-password-stdin"] && flags.username)
      throw new Error("Password verification cannot change a username.");
    if (flags["generate-password"] && !flags.output)
      throw new Error("Generated passwords require --output PRIVATE_NEW_FILE.");
    if (flags.output && !flags["generate-password"])
      throw new Error("Account --output is only for a generated password.");
    result = await request(config, "/api/v1/account");
    let password, savedPath;
    if (flags["password-stdin"] || flags["verify-password-stdin"])
      password = await passwordInput();
    if (flags["generate-password"]) {
      password = require("node:crypto").randomBytes(24).toString("base64url");
      savedPath = writePrivate(flags.output, password + "\n");
    }
    if (flags["verify-password-stdin"]) {
      result = await request(
        config,
        "/api/v1/account/verify-password",
        "POST",
        { password },
      );
      if (!result.valid)
        throw Object.assign(
          new Error(
            "The supplied password does not match the current account.",
          ),
          { code: "PASSWORD_MISMATCH" },
        );
    } else if (flags.username !== undefined || password !== undefined) {
      try {
        result = await request(config, "/api/v1/account", "PATCH", {
          revision: result.account.revision,
          ...(flags.username !== undefined ? { username: flags.username } : {}),
          ...(password !== undefined ? { password } : {}),
        });
        if (password !== undefined) {
          const verified = await request(
            config,
            "/api/v1/account/verify-password",
            "POST",
            { password },
          );
          if (!verified.valid)
            throw new Error(
              "Password update could not be verified. Re-read account state before retrying.",
            );
          result.passwordVerified = true;
        }
        result.identity = (await request(config, "/api/v1/me")).member;
        if (savedPath) result.passwordFile = savedPath;
      } catch (error) {
        if (savedPath)
          error.message +=
            " Generated password saved at " +
            savedPath +
            "; account update may not have completed. Verify it before retrying.";
        throw error;
      }
    }
    if (!flags.json)
      return console.log(
        result.account
          ? `Account: ${result.account.username} (#${result.account.id}, ${result.account.role})\nPassword configured: ${result.account.registered}${savedPath ? "\nPassword saved privately: " + savedPath : ""}`
          : "Password verified.",
      );
  } else if (command === "visibility") {
    if (!target) throw new Error("Specify a work slug.");
    const endpoint = "/api/v1/works/" + encodeURIComponent(target),
      current = (await request(config, endpoint)).work;
    const listed = boolFlag("gallery"),
      published = boolFlag("published");
    if (listed !== undefined || published !== undefined)
      result = await request(config, endpoint, "PATCH", {
        revision: current.revision,
        ...(listed === undefined ? {} : { listed }),
        ...(published === undefined ? {} : { published }),
      });
    else {
      const { html, files, cover, share_image, ...work } = current;
      result = { work };
    }
  } else if (
    ["access", "share", "share-list", "share-revoke"].includes(command)
  ) {
    result = await accessCommand(config);
  } else if (command === "friends")
    result = await request(config, "/api/v1/friends");
  else if (
    ["friend", "recover", "reinvite", "revoke-invite"].includes(command)
  ) {
    if (!target)
      throw new Error(
        "Specify the exact member or invitation ID from friends --json.",
      );
    if (
      ["friend", "recover"].includes(command) &&
      (!/^\d+$/.test(target) || Number(target) <= 1)
    )
      throw new Error("Specify a friend member ID greater than 1.");
    if (command === "friend") {
      const disabled = boolFlag("disabled");
      if ((flags.note !== undefined) === (disabled !== undefined))
        throw new Error("Choose --note or --disabled.");
      result = await request(
        config,
        "/api/v1/members/" + target,
        "PATCH",
        flags.note === undefined ? { disabled } : { note: flags.note },
      );
    } else if (command === "recover")
      result = await request(
        config,
        "/api/v1/members/" + target + "/recovery",
        "POST",
        {},
      );
    else if (command === "reinvite")
      result = await request(
        config,
        "/api/v1/invites/" + encodeURIComponent(target) + "/reissue",
        "POST",
        {},
      );
    else
      result = await request(
        config,
        "/api/v1/invites/" + encodeURIComponent(target),
        "DELETE",
      );
  } else if (command === "list")
    result = await request(config, "/api/v1/works?all=true");
  else if (command === "dashboard")
    result = await request(config, "/api/v1/dashboard-link", "POST", {});
  else if (command === "invite")
    result = await request(config, "/api/v1/invites", "POST", {
      label: target || "朋友",
    });
  else if (command === "sharing") {
    if (!target || file)
      throw new Error("Usage: quickshare sharing SLUG [options]");
    if (flags.output && !flags.preview)
      throw new Error("Sharing --output requires --preview.");
    for (const key of ["share-enabled", "indexable"])
      if (flags[key] !== undefined && !["true", "false"].includes(flags[key]))
        throw new Error(key + " must be true or false.");
    if (flags.cover && flags["remove-cover"])
      throw new Error("Choose --cover or --remove-cover.");
    const endpoint = "/api/v1/works/" + encodeURIComponent(target) + "/sharing";
    const state = await request(config, endpoint);
    result = state;
    if (
      flags.preview ||
      [
        "share-enabled",
        "indexable",
        "title",
        "description",
        "cover",
        "remove-cover",
      ].some((k) => flags[k] !== undefined)
    ) {
      const body = {
        revision: state.revision,
        shareRevision: state.shareRevision,
        enabled:
          flags["share-enabled"] === undefined
            ? state.enabled
            : flags["share-enabled"] === "true",
        indexable:
          flags.indexable === undefined
            ? state.indexable
            : flags.indexable === "true",
        title: flags.title ?? state.title,
        description: flags.description ?? state.description,
      };
      if (flags.cover) {
        if (fs.statSync(flags.cover).size > 2 * 1024 * 1024)
          throw new Error("Cover must be at most 2 MB.");
        body.image = fs.readFileSync(flags.cover).toString("base64");
      } else if (flags["remove-cover"]) body.image = null;
      result = await request(
        config,
        flags.preview ? endpoint + "-preview" : endpoint,
        flags.preview ? "POST" : "PATCH",
        body,
      );
    }
    if (flags.output) {
      if (!flags.preview)
        throw new Error("Sharing --output requires --preview.");
      const match =
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
          result.preview.image,
        );
      if (!match)
        throw new Error(
          "This page uses an existing OG image URL; inspect the preview.image URL instead of exporting a generated cover.",
        );
      const saved = writePrivate(flags.output, Buffer.from(match[2], "base64"));
      result.output = saved;
    }
    result = {
      ...result,
      preview: {
        ...result.preview,
        image: result.preview.image.startsWith("data:")
          ? "generated-or-uploaded-cover"
          : result.preview.image,
      },
    };
    if (!flags.json)
      return console.log(
        `Sharing: ${result.enabled ? "enabled" : "original HTML"}\nSearch indexing: ${result.indexable ? "allowed" : "off"}\nTitle: ${result.preview.title}`,
      );
  } else if (command === "versions")
    result = await request(
      config,
      "/api/v1/works/" + encodeURIComponent(target) + "/versions",
    );
  else if (command === "rollback") {
    const endpoint = "/api/v1/works/" + encodeURIComponent(target);
    const { work } = await request(config, endpoint);
    await request(config, endpoint + "/rollback", "POST", {
      revision: work.revision,
      version: Number(file),
    });
    result = { work: (await request(config, endpoint)).work };
  } else if (["get", "unpublish", "restore"].includes(command)) {
    if (!target) throw new Error("Specify a work slug.");
    const endpoint = "/api/v1/works/" + encodeURIComponent(target);
    const { work } = await request(config, endpoint);
    if (command === "get") {
      if (flags.output) {
        fs.writeFileSync(flags.output, work.html, { flag: "wx" });
        return console.log(`Saved ${flags.output}`);
      }
      const { html, files, ...metadata } = work;
      result = { work: metadata };
    } else
      result = await request(config, endpoint, "PATCH", {
        published: command === "restore",
        revision: work.revision,
      });
  } else if (["publish", "update", "link", "status"].includes(command)) {
    result = await projectCommand(config);
  } else throw new Error(`Unknown command: ${command}. Use --help.`);
  if (
    flags.output &&
    ["dashboard", "invite", "recover", "reinvite"].includes(command)
  ) {
    fs.writeFileSync(privateOutput, JSON.stringify(result, null, 2) + "\n");
    fs.closeSync(privateOutput);
    const saved = path.resolve(flags.output);
    return console.log(
      flags.json
        ? JSON.stringify({ ok: true, output: saved, sensitive: true })
        : "Saved privately: " + saved,
    );
  }
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else if (result.url) console.log(result.url);
  else if (result.versions)
    console.log(
      result.versions
        .map((v) => `v${v.revision}  ${v.created_at}`)
        .join("\n") || "No versions yet.",
    );
  else if (result.works)
    console.log(
      result.works.length
        ? result.works
            .map(
              (w) =>
                `${w.published ? "live " : "draft"}  ${w.slug.padEnd(24)} ${w.title}\n       ${w.url}`,
            )
            .join("\n")
        : "No works yet.",
    );
  else if (result.work)
    console.log(
      `${result.work.published ? "Published" : "Unpublished"}: ${result.work.title}\n${result.work.url}\nRevision ${result.work.revision}`,
    );
  else if (result.mode)
    console.log(`Access: ${result.mode}\n${result.links.length} link records`);
  else if (result.output) console.log(`Saved privately: ${result.output}`);
  else if (result.project)
    console.log(
      result.project.slug
        ? `Linked: ${result.project.slug}\nRevision ${result.project.revision}${result.project.pending ? " · pending publication" : ""}`
        : "This source is not linked to a site.",
    );
  else if (result.tools)
    console.log(result.tools.map((t) => `${t.name}: ${t.command}`).join("\n"));
  else if (result.account)
    console.log(
      `Connected: ${config.url}\n${result.account.username} (#${result.account.id}, ${result.account.role}) · ${result.usage.sites} sites`,
    );
  else if (result.friends)
    console.log(
      result.friends
        .map(
          (f) =>
            `${f.member_id || f.id}  ${f.note}  ${f.state}  ${f.works_count} sites`,
        )
        .join("\n") || "No friends yet.",
    );
  else console.log(`Completed: ${command}`);
}
async function accessCommand(config) {
  if (!target) throw new Error("Specify the site slug.");
  const endpoint = "/api/v1/works/" + encodeURIComponent(target) + "/access";
  const state = await request(config, endpoint);
  if (
    command === "share-list" ||
    (command === "access" && flags.mode === undefined)
  )
    return state;
  if (command === "access") {
    if (!["public", "private", "link"].includes(flags.mode))
      throw new Error("--mode must be public, private or link.");
    await request(config, endpoint, "PATCH", {
      mode: flags.mode,
      revision: state.revision,
    });
    const readback = await request(config, endpoint);
    if (readback.mode !== flags.mode)
      throw projectError(
        "ACCESS_CONFLICT",
        "Access changed during verification.",
        "Read current access settings.",
      );
    return readback;
  }
  if (command === "share-revoke") {
    if (!file) throw new Error("Specify the link ID from share-list.");
    const result = await request(
      config,
      endpoint + "/links/" + encodeURIComponent(file),
      "DELETE",
    );
    const readback = await request(config, endpoint);
    if (!readback.links.find((x) => x.id === file && x.revoked))
      throw new Error("Link revocation could not be verified.");
    return result;
  }
  if (state.mode !== "link")
    throw projectError(
      "ACCESS_MODE_REQUIRED",
      "Set access to link before creating a restricted share.",
      "Run quickshare access SLUG --mode link.",
    );
  if (!flags.output)
    throw new Error(
      "Restricted links require --output PRIVATE_FILE; the URL grants read-only access.",
    );
  const { member } = await request(config, "/api/v1/me");
  let receipt;
  if (fs.existsSync(flags.output)) {
    receipt = JSON.parse(fs.readFileSync(flags.output, "utf8"));
    if (
      receipt.kind !== "qiaopage-share-v1" ||
      receipt.server !== config.url ||
      receipt.memberId !== member.id ||
      receipt.slug !== target ||
      receipt.name !== (flags.name || "分享链接") ||
      receipt.duration !== (flags.expires || "never")
    )
      throw projectError(
        "SHARE_OUTPUT_CONFLICT",
        "Output belongs to a different share request.",
        "Use the original arguments to retry, or choose a new output file.",
      );
    if (receipt.id) {
      if (
        !state.links.find(
          (x) =>
            x.id === receipt.id &&
            !x.revoked &&
            (x.expires === null || x.expires > Date.now()),
        )
      )
        throw projectError(
          "SHARE_LINK_INACTIVE",
          "This link expired or was revoked.",
          "Create a new link using a different output file.",
        );
      return {
        ok: true,
        id: receipt.id,
        output: path.resolve(flags.output),
        sensitive: true,
        expires: receipt.expires,
      };
    }
  } else {
    const duration = flags.expires || "never";
    const match = /^(\d+)(m|h|d)$/.exec(duration);
    if (duration !== "never" && (!match || Number(match[1]) <= 0))
      throw new Error("Use --expires 30m, 24h, 7d or never.");
    const ttl = match
      ? Number(match[1]) * { m: 60000, h: 3600000, d: 86400000 }[match[2]]
      : null;
    if (ttl !== null && (!Number.isSafeInteger(ttl) || ttl > 366 * 86400000))
      throw new Error("Link expiry must be within one year.");
    const key = require("node:crypto").randomBytes(32).toString("hex");
    receipt = {
      kind: "qiaopage-share-v1",
      server: config.url,
      memberId: member.id,
      slug: target,
      key,
      name: flags.name || "分享链接",
      duration,
      expires: ttl === null ? null : Date.now() + ttl,
    };
    writePrivate(flags.output, JSON.stringify(receipt));
  }
  const result = await request(config, endpoint + "/links", "POST", {
    key: receipt.key,
    name: receipt.name,
    expires: receipt.expires,
  });
  const saved = {
    ...receipt,
    id: result.id,
    url: config.url + "/r/" + receipt.key + "/" + target + "/",
  };
  // The key is retained only in this user-selected private receipt so a lost response can be resumed.
  saveProject(path.resolve(flags.output), saved);
  const readback = await request(config, endpoint);
  if (!readback.links.find((x) => x.id === result.id && !x.revoked))
    throw new Error("Share link creation could not be verified.");
  return {
    ok: true,
    id: result.id,
    output: path.resolve(flags.output),
    sensitive: true,
    expires: receipt.expires,
  };
}
function projectError(code, message, recovery) {
  return Object.assign(new Error(message), {
    code,
    recovery,
    retryable: false,
  });
}
function projectFile(source) {
  // State is outside the upload tree; key by source, not credentials, so switching profiles cannot silently create another site.
  return path.join(
    path.dirname(configPath),
    "projects",
    createHash("sha256").update(source).digest("hex") + ".json",
  );
}
function saveProject(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomUUID();
  try {
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
async function projectCommand(config) {
  const selectedSource =
    command === "update" && file
      ? file
      : command === "link"
        ? file || "."
        : target || ".";
  if (fs.lstatSync(selectedSource).isSymbolicLink())
    throw new Error("Symbolic links are not published.");
  const source = fs.realpathSync(selectedSource);
  const stateFile = projectFile(source),
    lockFile = stateFile + ".lock";
  fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  const { member } = await request(config, "/api/v1/me");
  let state = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
    : null;
  if (
    command !== "link" &&
    state &&
    (state.url !== config.url || state.memberId !== member.id)
  )
    throw projectError(
      "PROJECT_IDENTITY_MISMATCH",
      "This source is linked to another server or member.",
      "Select the original profile, or explicitly link the intended site with quickshare link SLUG SOURCE.",
    );
  if (command === "status")
    return {
      ok: true,
      project: state
        ? {
            source,
            slug: state.slug || null,
            revision: state.revision || null,
            pending: !!state.pending,
            url: state.url,
            memberId: state.memberId,
          }
        : { source, linked: false },
      identity: member,
    };
  let lock;
  try {
    lock = fs.openSync(lockFile, "wx", 0o600);
  } catch {
    throw projectError(
      "PROJECT_BUSY",
      "Another command holds this project lock.",
      "Wait for the active command. After a crash, verify the PID in the .lock file has exited before removing only that lock; keep the project JSON and pending request.",
    );
  }
  fs.writeFileSync(lock, String(process.pid));
  try {
    // Re-read after taking the lock.
    state = fs.existsSync(stateFile)
      ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
      : null;
    if (
      command !== "link" &&
      state &&
      (state.url !== config.url || state.memberId !== member.id)
    )
      throw projectError(
        "PROJECT_IDENTITY_MISMATCH",
        "Project identity changed.",
        "Select the original profile.",
      );
    const explicit =
      command === "link" || (command === "update" && file) ? target : null;
    if (
      state?.pending &&
      flags["request-id"] &&
      flags["request-id"] !== state.pending.requestId
    )
      throw projectError(
        "PENDING_PUBLICATION",
        "The pending request ID cannot be changed.",
        "Retry with the original request ID.",
      );
    if (
      state?.pending &&
      (!!flags.new !== !!state.pending.newSite ||
        (explicit && explicit !== state.pending.slug))
    )
      throw projectError(
        "PENDING_PUBLICATION",
        "A publication has an uncertain result.",
        "Retry the original command and source before starting another operation.",
      );
    if (command === "link") {
      if (!target) throw new Error("Usage: quickshare link SLUG SOURCE");
      if (state?.pending)
        throw projectError(
          "PENDING_PUBLICATION",
          "Resolve the pending publication before relinking.",
          "Retry the original publish command.",
        );
      const { work } = await request(
        config,
        "/api/v1/works/" + encodeURIComponent(target),
      );
      saveProject(stateFile, {
        source,
        url: config.url,
        memberId: member.id,
        slug: work.slug,
        revision: work.revision,
      });
      return {
        ok: true,
        linked: true,
        work: { slug: work.slug, url: work.url, revision: work.revision },
      };
    }
    if (!target) throw new Error("Specify an HTML/Markdown file or directory.");
    const slug =
      state?.pending?.slug || explicit || (!flags.new && state?.slug);
    if (command === "update" && !slug)
      throw projectError(
        "PROJECT_NOT_LINKED",
        "This source has no linked site.",
        "Run quickshare link SLUG SOURCE, or publish SOURCE to create a site.",
      );
    const current = slug
      ? (await request(config, "/api/v1/works/" + encodeURIComponent(slug)))
          .work
      : null;
    if (flags.slug !== undefined && slug && flags.slug !== slug)
      throw projectError(
        "PROJECT_CONFLICT",
        "--slug cannot change a linked site's address.",
        "Use publish SOURCE --new for a separate site.",
      );
    // Keep the original metadata and revision during an uncertain retry.
    const baseline = state?.pending?.baseline || current || {};
    const body = {
      ...(await documentBody(source, flags, baseline)),
      ...(!slug && flags.slug !== undefined ? { slug: flags.slug } : {}),
    };
    const {
      revision: ignoredRevision,
      slug: ignoredSlug,
      ...semanticBody
    } = body;
    const hash = createHash("sha256")
      .update(JSON.stringify(semanticBody))
      .digest("hex");
    if (state?.pending && state.pending.hash !== hash)
      throw projectError(
        "PENDING_SOURCE_CHANGED",
        "Source or flags changed while a publication is unresolved.",
        "Restore the previous source and flags, then retry. Do not create another site.",
      );
    if (
      !state?.pending &&
      current &&
      state?.slug === slug &&
      state.revision !== current.revision
    )
      throw projectError(
        "PROJECT_CONFLICT",
        "The remote site changed since this project's last publication.",
        "Review quickshare get SLUG and versions SLUG; explicitly link SLUG SOURCE to adopt the current revision after review.",
      );
    if (!state?.pending && current && state?.hash === hash)
      return {
        work: {
          slug: current.slug,
          url: current.url,
          revision: current.revision,
          published: current.published,
          title: current.title,
        },
        unchanged: true,
      };
    const capability = await request(config, "/api/v1/capabilities");
    if (slug && !capability.publishing?.updateIdempotency)
      throw projectError(
        "SERVER_UPGRADE_REQUIRED",
        "The server does not support safe update retries.",
        "Upgrade the server before using project-aware updates.",
      );
    const requestId =
      state?.pending?.requestId ||
      flags["request-id"] ||
      (flags.new || slug
        ? randomUUID()
        : createHash("sha256")
            .update(
              JSON.stringify({
                url: config.url,
                member: member.id,
                source,
                body,
              }),
            )
            .digest("hex"));
    const { html, files, cover, share_image, ...metadata } = baseline;
    const pending = {
      requestId,
      hash,
      slug: slug || null,
      newSite: flags.new,
      baseline: metadata,
    };
    state = {
      ...(state || {}),
      source,
      url: config.url,
      memberId: member.id,
      pending,
    };
    saveProject(stateFile, state);
    let result;
    try {
      result = await request(
        config,
        slug ? "/api/v1/works/" + encodeURIComponent(slug) : "/api/v1/works",
        slug ? "PUT" : "POST",
        { ...body, requestId },
      );
    } catch (error) {
      // Deterministic rejections did not commit. Keep uncertain results durable.
      if (
        error.status &&
        error.status < 500 &&
        ![408, 429].includes(error.status)
      ) {
        delete state.pending;
        saveProject(stateFile, state);
      }
      throw error;
    }
    const { work } = result;
    if (result.replayed && work.revision !== (slug ? body.revision + 1 : 1)) {
      saveProject(stateFile, {
        source,
        url: config.url,
        memberId: member.id,
        slug: work.slug,
        revision: slug ? body.revision + 1 : 1,
        hash,
      });
      throw projectError(
        "PROJECT_CONFLICT",
        "The original request succeeded, but the site changed again afterwards.",
        "Review the current site and explicitly link its revision before updating.",
      );
    }
    const readback = (
      await request(config, "/api/v1/works/" + encodeURIComponent(work.slug))
    ).work;
    if (readback.revision !== work.revision)
      throw projectError(
        "PROJECT_CONFLICT",
        "The remote site changed during verification.",
        "Read current state before retrying.",
      );
    saveProject(stateFile, {
      source,
      url: config.url,
      memberId: member.id,
      slug: work.slug,
      revision: work.revision,
      hash,
    });
    return {
      ...result,
      operation: slug ? "updated" : "created",
      verified: true,
    };
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockFile);
  }
}
async function documentBody(file, flags, old = {}) {
  const stat = fs.lstatSync(file);
  const files = [];
  let total = 0;
  function add(full, relative) {
    const info = fs.lstatSync(full);
    if (info.isSymbolicLink())
      throw new Error("Symbolic links are not published: " + relative);
    if (
      relative
        .split("/")
        .some((p) => /^(?:\..*|node_modules|.*\.(pem|key|sqlite|db))$/i.test(p))
    )
      return;
    if (info.isDirectory()) {
      for (const name of fs.readdirSync(full))
        add(path.join(full, name), relative ? relative + "/" + name : name);
      return;
    }
    if (!info.isFile()) throw new Error("Only regular files can be published.");
    total += info.size;
    if (
      info.size > 5 * 1024 * 1024 ||
      total > 8 * 1024 * 1024 ||
      files.length >= 100
    )
      throw new Error("Limit: 5 MB per file, 8 MB total, 100 files.");
    files.push({
      path: relative,
      data: fs.readFileSync(full).toString("base64"),
    });
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(file)) add(path.join(file, name), name);
  } else {
    if (!/\.(html?|md|markdown)$/i.test(file))
      throw new Error("Use an HTML/Markdown file or a website directory.");
    add(file, /\.(md|markdown)$/i.test(file) ? "index.md" : "index.html");
  }
  let sourceFile =
    files.find((f) => f.path === "index.html") ||
    files.find((f) => /^index\.(md|markdown)$/.test(f.path));
  if (!sourceFile)
    throw new Error("The directory needs index.html or index.md.");
  const source = Buffer.from(sourceFile.data, "base64").toString("utf8");
  const isMarkdown = /\.(md|markdown)$/i.test(sourceFile.path);
  // Markdown is rendered on the server; the original source stays in the published file tree.
  const rendered = {
    html: source,
    title: isMarkdown ? source.match(/^# +(.+)$/m)?.[1] : undefined,
  };
  let cover;
  if (flags.cover && flags.capture)
    throw new Error("Choose --cover or --capture, not both.");
  if (flags.cover) {
    if (fs.statSync(flags.cover).size > 2 * 1024 * 1024)
      throw new Error("Cover must be under 2 MB.");
    cover = { data: fs.readFileSync(flags.cover).toString("base64") };
  } else if (flags.capture) {
    if (stat.isDirectory())
      throw new Error(
        "Directory capture is not supported; use --cover or publish without a cover.",
      );
    if (isMarkdown)
      rendered.html = require("../lib/markdown").renderMarkdown(source).html;
    const { captureCover } = require("../lib/capture");
    cover = {
      data: (await captureCover(rendered.html)).toString("base64"),
    };
  }
  return {
    ...(cover ? { cover } : {}),
    files,
    title:
      flags.title ??
      old.title ??
      rendered.title ??
      path.basename(file, path.extname(file)),
    description: flags.description ?? old.description ?? "",
    tags:
      flags.tags === undefined
        ? old.tags || []
        : flags.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
    theme: flags.theme ?? old.theme ?? "sage",
    listed: flags.listed ?? old.listed ?? false,
    published: flags.draft ? false : (old.published ?? true),
    ...(old.revision ? { revision: old.revision } : {}),
  };
}
async function request(config, endpoint, method = "GET", body) {
  const serialized = body ? JSON.stringify(body) : undefined;
  if (
    ["POST", "PUT"].includes(method) &&
    /^\/api\/v1\/works(?:\/[^/]+)?$/.test(endpoint) &&
    Buffer.byteLength(serialized || "") > 3 * 1024 * 1024
  ) {
    const bytes = Buffer.from(serialized);
    const upload = await request(config, "/api/v1/uploads", "POST", {
      method,
      slug:
        method === "PUT"
          ? decodeURIComponent(endpoint.split("/").pop())
          : undefined,
      bytes: bytes.length,
      sha256: require("node:crypto")
        .createHash("sha256")
        .update(bytes)
        .digest("hex"),
    });
    const target = "/api/v1/uploads/" + upload.id;
    try {
      for (
        let offset = 0, part = 0;
        offset < bytes.length;
        offset += upload.chunkBytes, part++
      )
        await request(config, target + "/chunks/" + part, "POST", {
          data: bytes
            .subarray(offset, offset + upload.chunkBytes)
            .toString("base64"),
        });
      return await request(config, target + "/complete", "POST", {});
    } finally {
      await request(config, target, "DELETE").catch(() => {});
    }
  }
  let res;
  try {
    res = await fetch(config.url + endpoint, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${config.token}`,
        ...(endpoint.startsWith("/auth/") ? { Origin: config.url } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: serialized,
    });
  } catch (error) {
    throw Object.assign(
      new Error(
        "Cannot confirm the server response. Keep this project state and retry the same command.",
      ),
      {
        code: error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR",
        retryable: true,
        recovery:
          "Retry the identical command without changing source files or project state.",
      },
    );
  }
  let text;
  try {
    text = await res.text();
  } catch {
    throw Object.assign(
      new Error(
        "Server response was interrupted. Retry the identical command.",
      ),
      { code: "NETWORK_ERROR", retryable: true },
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Object.assign(
      new Error(`Server returned HTTP ${res.status}, not JSON. Check the URL.`),
      {
        status: res.status,
        code: "INVALID_SERVER_RESPONSE",
        retryable: res.status >= 500,
      },
    );
  }
  if (!res.ok) {
    const detail = typeof data.error === "object" ? data.error : {};
    throw Object.assign(
      new Error(
        `HTTP ${res.status}: ${detail.message || data.error || "Request failed"}`,
      ),
      {
        status: res.status,
        code: detail.code || data.code || "HTTP_" + res.status,
        retryable: detail.retryable ?? data.retryable,
        recovery: detail.recovery || data.recovery,
        requestId:
          detail.requestId || data.requestId || res.headers.get("x-request-id"),
        pointer: detail.pointer || data.pointer,
      },
    );
  }
  return data;
}
function reportError(error, json = flags.json) {
  const status = error.status || null;
  const code = error.code || (status ? "HTTP_" + status : "VALIDATION_ERROR");
  const retryable =
    error.retryable ??
    (status === 429 ||
      status >= 500 ||
      ["NETWORK_ERROR", "TIMEOUT"].includes(code));
  const recovery =
    error.recovery ||
    (status === 401
      ? "Keep your profile; reconnect with an authorized connection or recovery prompt."
      : status === 403
        ? "Use only permitted actions; do not switch to an administrator profile."
        : status === 409
          ? "Read the current site and resolve the conflict before retrying."
          : "Check command arguments with quickshare --help.");
  const message = String(error.message)
    .replace(/(?:Bearer\s+)[^\s]+/gi, "Bearer [redacted]")
    .replace(/\/r\/[a-f0-9]{64}(?=\/|\b)/gi, "/r/[redacted]")
    .replace(/([?#])[^\s]+/g, "$1[redacted]");
  const detail = {
    code,
    status,
    message,
    retryable,
    recovery,
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ...(error.pointer ? { pointer: error.pointer } : {}),
  };
  console.error(
    json
      ? JSON.stringify({ ok: false, error: detail })
      : `quickshare: ${message}\n${recovery}`,
  );
  process.exitCode = ["NETWORK_ERROR"].includes(code)
    ? 40
    : code === "TIMEOUT"
      ? 50
      : [401, 403].includes(status)
        ? 10
        : [404, 410].includes(status)
          ? 20
          : status === 409 || code === "PROJECT_CONFLICT"
            ? 30
            : status >= 500
              ? 1
              : 2;
}
main().catch((error) => reportError(error));
