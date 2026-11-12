import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSites, isManaged, migrateLegacy, renderSites } from "./config.js";
import { adminRequest, adapt, listBackups, listCertificates, loadConfig, readBackup, readLog } from "./caddy.js";
import { dataPaths, hashPassword, readSites, saveSites, SessionManager, verifyPassword } from "./store.js";
import { hashSitePassword } from "./security.js";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function cookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value));
}

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

async function body(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512 * 1024) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createPanel({ root, passwordHash, sessionSecret, binary = "caddy", adminUrl = "http://caddy:2019" }) {
  const paths = dataPaths(root);
  const sessions = new SessionManager(sessionSecret);
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const url = new URL(request.url, "http://localhost");
    const id = cookies(request).caddy_panel;
    const session = sessions.get(id);
    const ip = request.socket.remoteAddress || "unknown";
    try {
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/health" && request.method === "GET") return json(response, 200, { ok: true });
        if (url.pathname === "/api/login" && request.method === "POST") {
          if (!sessions.allowed(ip)) return json(response, 429, { error: "登录尝试过于频繁，请稍后重试。" });
          const input = await body(request);
          if (typeof input.password !== "string" || !(await verifyPassword(input.password, passwordHash))) {
            sessions.failed(ip);
            return json(response, 401, { error: "密码不正确。" });
          }
          const created = sessions.create();
          const secure = request.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
          response.setHeader("Set-Cookie", `caddy_panel=${created.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
          return json(response, 200, { csrf: created.csrf });
        }
        if (!session) return json(response, 401, { error: "请先登录。" });
        if (request.method !== "GET" && request.headers["x-csrf-token"] !== session.csrf) return json(response, 403, { error: "请求验证失败，请刷新页面。" });
        if (request.method !== "GET") {
          const origin = request.headers.origin;
          if (origin) {
            let expected;
            try { expected = new URL(origin); } catch { return json(response, 403, { error: "请求来源无效。" }); }
            const protocol = request.headers["x-forwarded-proto"] === "https" ? "https:" : "http:";
            if (expected.protocol !== protocol || expected.host !== request.headers.host) return json(response, 403, { error: "请求来源与后台地址不一致。" });
          }
        }
        if (url.pathname === "/api/logout" && request.method === "POST") {
          sessions.destroy(id);
          response.setHeader("Set-Cookie", "caddy_panel=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
          return json(response, 200, { ok: true });
        }
        if (url.pathname === "/api/bootstrap" && request.method === "GET") {
          const config = await readFile(paths.config, "utf8");
          const migration = migrateLegacy(config);
          const managed = isManaged(config) || Boolean(migration);
          let sites = migration ? migration.sites : managed ? await readSites(paths.sites) : null;
          if (managed && !sites) {
            sites = defaultSites();
            await saveSites(paths.sites, sites);
          }
          let status = { running: false };
          try {
            const running = JSON.parse(await adminRequest("/config/", {}, adminUrl));
            status = { running: true, admin: running.admin || {} };
          } catch (error) { status.error = error.message; }
          return json(response, 200, { config, managed, sites: sites || [], status, revision: createHash("sha256").update(config).digest("hex") });
        }
        if (url.pathname === "/api/apply" && request.method === "POST") {
          const input = await body(request);
          const current = await readFile(paths.config, "utf8");
          if (input.revision && createHash("sha256").update(current).digest("hex") !== input.revision) return json(response, 409, { error: "配置已被其他会话修改，请刷新页面后再应用。" });
          let config;
          let sites = null;
          if (input.mode === "sites") {
            if (!isManaged(current) && !migrateLegacy(current)) return json(response, 409, { error: "当前配置包含手动修改，请使用高级编辑器保存。" });
            if (!Array.isArray(input.sites) || input.sites.length > 100) return json(response, 400, { error: "站点列表无效。" });
            const previous = new Map((await readSites(paths.sites) || []).map((site) => [site.id, site]));
            sites = [];
            for (const site of input.sites) {
              const password = String(site.authPassword || "");
              if (password && (password.length < 8 || password.length > 72)) return json(response, 400, { error: "站点密码长度须为 8-72 个字符。" });
              if (site.authUser && !password && !previous.get(site.id)?.authHash) return json(response, 400, { error: "启用站点密码时必须设置密码。" });
              const authHash = password ? await hashSitePassword(password, binary) : (previous.get(site.id)?.authHash || "");
              sites.push({ ...site, authPassword: "", authHash });
            }
            const httpPort = current.match(/^\s*http_port\s+(\d+)\s*$/m)?.[1];
            const httpsPort = current.match(/^\s*https_port\s+(\d+)\s*$/m)?.[1];
            const admin = current.match(/^\s*admin\s+([^\s{]+)\s*\{/m)?.[1];
            config = renderSites(sites, httpPort || 8080, httpsPort || 8443, admin || "0.0.0.0:2019");
          } else {
            if (typeof input.config !== "string" || !input.config.trim() || input.config.length > 256 * 1024) return json(response, 400, { error: "Caddyfile 不能为空且不得超过 256 KiB。" });
            config = input.config;
            if (!/admin\s+0\.0\.0\.0:2019/.test(config) || !/origins\s+caddy:2019/.test(config)) return json(response, 400, { error: "为保持后台可用，请保留 admin 0.0.0.0:2019 和 origins caddy:2019 全局配置。" });
            if (!isManaged(config)) sites = [];
            else sites = await readSites(paths.sites);
          }
          await loadConfig(config, paths, binary, adminUrl);
          if (sites) await saveSites(paths.sites, sites);
          return json(response, 200, { ok: true, message: "配置已校验并热加载，无需重启。" });
        }
        if (url.pathname === "/api/password" && request.method === "POST") {
          const input = await body(request);
          if (!(await verifyPassword(input.currentPassword || "", passwordHash))) return json(response, 403, { error: "当前密码不正确。" });
          if (typeof input.newPassword !== "string" || input.newPassword.length < 10 || input.newPassword.length > 128) return json(response, 400, { error: "新密码长度须为 10-128 个字符。" });
          passwordHash = await hashPassword(input.newPassword);
          const { writeSecret } = await import("./store.js");
          await writeSecret(paths.password, passwordHash);
          return json(response, 200, { ok: true });
        }
        if (url.pathname === "/api/certificates" && request.method === "GET") return json(response, 200, { certificates: await listCertificates(root) });
        if (url.pathname === "/api/logs" && request.method === "GET") return json(response, 200, { log: await readLog(paths) });
        if (url.pathname === "/api/backups" && request.method === "GET") return json(response, 200, { backups: await listBackups(paths) });
        if (url.pathname === "/api/backup" && request.method === "GET") {
          const name = url.searchParams.get("name") || "";
          const config = await readBackup(paths, name);
          if (url.searchParams.get("download") === "1") {
            response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`, "Cache-Control": "no-store" });
            return response.end(config);
          }
          return json(response, 200, { config });
        }
        if (url.pathname === "/api/validate" && request.method === "POST") {
          const input = await body(request);
          return json(response, 200, { json: await adapt(input.config || "", binary) });
        }
        if (url.pathname === "/api/export" && request.method === "GET") {
          response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": "attachment; filename=Caddyfile", "Cache-Control": "no-store" });
          return response.end(await readFile(paths.config, "utf8"));
        }
        return json(response, 404, { error: "接口不存在。" });
      }
      if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "不支持的请求方法。" });
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const path = normalize(join(publicRoot, relative));
      if (!path.startsWith(publicRoot)) return json(response, 403, { error: "禁止访问。" });
      const info = await stat(path);
      if (!info.isFile()) throw new Error("Not found");
      const content = await readFile(path);
      response.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream", "Content-Length": content.length, "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      const status = error.code === "ENOENT" && !url.pathname.startsWith("/api/") ? 404 : 400;
      json(response, status, { error: error.message || "操作失败。" });
    }
  });
}
