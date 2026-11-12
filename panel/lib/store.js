import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
const sessions = new Map();
const loginAttempts = new Map();

function prune(map) {
  if (map.size <= 1000) return;
  const now = Date.now();
  for (const [key, value] of map) if (value.expires < now || now - value.started > 60_000) map.delete(key);
}

export function makeSecret() {
  return randomBytes(32).toString("base64url");
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, salt, expected] = String(encoded).split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const derived = await scrypt(password, Buffer.from(salt, "base64url"), 64, { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024 });
  const wanted = Buffer.from(expected, "base64url");
  return derived.length === wanted.length && timingSafeEqual(derived, wanted);
}

export async function writeSecret(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}

export class SessionManager {
  constructor(secret) {
    this.secret = secret;
  }

  allowed(ip) {
    const entry = loginAttempts.get(ip);
    if (!entry || Date.now() - entry.started > 60_000) return true;
    return entry.count < 8;
  }

  failed(ip) {
    const current = loginAttempts.get(ip);
    const entry = !current || Date.now() - current.started > 60_000 ? { started: Date.now(), count: 0 } : current;
    entry.count += 1;
    loginAttempts.set(ip, entry);
  }

  create() {
    const id = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    sessions.set(id, { csrf, expires: Date.now() + 12 * 60 * 60 * 1000 });
    if (sessions.size > 500) {
      for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
    }
    prune(sessions);
    prune(loginAttempts);
    return { id, csrf };
  }

  get(id) {
    const session = sessions.get(id);
    if (!session || session.expires < Date.now()) {
      sessions.delete(id);
      return null;
    }
    return session;
  }

  destroy(id) {
    sessions.delete(id);
  }
}

export async function readSites(path) {
  try {
    const sites = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(sites)) throw new Error("站点数据格式无效");
    return sites;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function saveSites(path, sites) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(sites, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, path);
}

export function dataPaths(root) {
  return {
    config: join(root, "config", "Caddyfile"),
    sites: join(root, "panel", "sites.json"),
    password: join(root, "panel", "password.hash"),
    secret: join(root, "panel", "session.secret"),
    backups: join(root, "panel", "backups"),
    log: join(root, "logs", "caddy.log"),
  };
}
