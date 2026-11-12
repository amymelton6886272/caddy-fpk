import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
const execute = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true, env: options.env });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => { child.kill(); reject(new Error("Caddy 命令执行超时。")); }, options.timeout || 20_000);
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else { const error = new Error(stderr || stdout || "Caddy 命令执行失败。"); error.stderr = stderr; reject(error); } });
  child.stdin.end(options.input || "");
});

export async function adapt(config, binary = "caddy") {
  const temporary = join(tmpdir(), `caddy-fpk-${randomBytes(8).toString("hex")}.Caddyfile`);
  await writeFile(temporary, config, { mode: 0o600 });
  try {
    const { stdout } = await execute(binary, ["adapt", "--config", temporary, "--adapter", "caddyfile", "--pretty"], {
      timeout: 15_000,
      env: { ...process.env, CADDY_HTTP_PORT: "8080", CADDY_HTTPS_PORT: "8443" },
    });
    return stdout;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function adminRequest(path = "/config/", options = {}, adminUrl = "http://caddy:2019") {
  const url = new URL(path, adminUrl);
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: options.method || "GET", headers: { Host: url.host, ...options.headers }, timeout: 20_000 }, (incoming) => {
      let data = "";
      incoming.on("data", (chunk) => { data += chunk; });
      incoming.on("end", () => resolve({ ok: incoming.statusCode >= 200 && incoming.statusCode < 300, status: incoming.statusCode, text: async () => data }));
    });
    request.on("timeout", () => request.destroy(new Error("Caddy 管理 API 请求超时。")));
    request.on("error", reject);
    request.end(options.body);
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try { message = JSON.parse(text).error || text; } catch { /* Text response. */ }
    throw new Error(message || `Caddy 管理 API 返回 ${response.status}`);
  }
  return text;
}

export async function loadConfig(config, paths, binary = "caddy", adminUrl = "http://caddy:2019") {
  const json = await adapt(config, binary);
  await adminRequest("/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json,
  }, adminUrl);
  const current = await readFile(paths.config, "utf8").catch(() => "");
  if (current) {
    await mkdir(paths.backups, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const backup = join(paths.backups, `Caddyfile.${stamp}`);
    await writeFile(backup, current, { mode: 0o600 });
    const copies = (await readdir(paths.backups)).filter((name) => name.startsWith("Caddyfile.")).sort();
    for (const name of copies.slice(0, -10)) await rm(join(paths.backups, name));
  }
  const temp = `${paths.config}.${process.pid}.tmp`;
  await writeFile(temp, config, { mode: 0o644 });
  await rename(temp, paths.config);
  return { json, appliedAt: new Date().toISOString() };
}

export async function listBackups(paths) {
  let files = [];
  try { files = await readdir(paths.backups); } catch (error) { if (error.code !== "ENOENT") throw error; }
  return Promise.all(files.filter((name) => /^Caddyfile\.\d{4}-/.test(name)).sort().reverse().map(async (name) => {
    const info = await stat(join(paths.backups, name));
    return { name, size: info.size, createdAt: info.mtime.toISOString() };
  }));
}

export async function readBackup(paths, name) {
  if (basename(name) !== name || !/^Caddyfile\.[\dTZ.-]+$/.test(name)) throw new Error("备份文件名无效");
  return readFile(join(paths.backups, name), "utf8");
}

export async function readLog(paths) {
  try {
    const content = await readFile(paths.log, "utf8");
    const lines = content.slice(-2 * 1024 * 1024).split("\n").slice(-301);
    if (lines.length === 301) lines.shift();
    return lines.join("\n");
  } catch (error) {
    if (error.code === "ENOENT") return "暂无日志。";
    throw error;
  }
}

export async function listCertificates(root) {
  const certificates = [];
  const dataRoot = join(root, "data", "caddy", "certificates");
  async function walk(directory) {
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) {
        try {
          const cert = JSON.parse(await readFile(path, "utf8"));
          certificates.push({
            name: cert.sans?.join(", ") || entry.name.replace(/\.json$/, ""),
            issuer: cert.issuer || "Caddy",
            notBefore: cert.not_before || null,
            notAfter: cert.not_after || null,
            managed: cert.managed !== false,
          });
        } catch { /* Skip incomplete or unrelated metadata. */ }
      }
    }
  }
  await walk(dataRoot);
  return certificates.sort((a, b) => a.name.localeCompare(b.name));
}
