import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { hashSitePassword } from "../lib/security.js";
import { renderSites } from "../lib/config.js";

const caddy = process.env.CADDY_TEST_BINARY;
const status = (port, credentials = "") => execFileSync("curl.exe", ["--noproxy", "*", "-s", "-o", "NUL", "-w", "%{http_code}", ...(credentials ? ["-u", credentials] : []), `http://127.0.0.1:${port}/`], { encoding: "utf8" });

test("Caddy enforces generated website password and IP allowlist", { skip: !caddy }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "caddy-fpk-security-"));
  const web = join(root, "www");
  await mkdir(web);
  await writeFile(join(web, "index.html"), "authorized");
  const authHash = await hashSitePassword("site-password", caddy);
  const site = { id: "secure", type: "static", address: ":28080", root: web, authUser: "visitor", authHash, allowedIps: [] };
  let config = renderSites([site]).replace("admin 0.0.0.0:2019", "admin 127.0.0.1:28083").replace("origins caddy:2019", "origins 127.0.0.1:28083");
  const configPath = join(root, "Caddyfile");
  await writeFile(configPath, config);
  assert.doesNotThrow(() => JSON.parse(execFileSync(caddy, ["adapt", "--config", configPath, "--adapter", "caddyfile"], { encoding: "utf8" })));
  let child = spawn(caddy, ["run", "--config", configPath]);
  context.after(() => child.kill());
  context.after(() => rm(root, { recursive: true, force: true }));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(status(28080), "401");
  assert.equal(status(28080, "visitor:site-password"), "200");
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  site.allowedIps = ["10.0.0.8"];
  config = renderSites([site]).replace("admin 0.0.0.0:2019", "admin 127.0.0.1:28083").replace("origins caddy:2019", "origins 127.0.0.1:28083");
  await writeFile(configPath, config);
  child = spawn(caddy, ["run", "--config", configPath]);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(status(28080, "visitor:site-password"), "403");
});
