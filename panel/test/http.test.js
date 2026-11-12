import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPanel } from "../lib/server.js";
import { dataPaths, hashPassword, makeSecret } from "../lib/store.js";
import { initialConfig, renderSites } from "../lib/config.js";

test("panel protects APIs, enforces CSRF, and serves the UI", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "caddy-panel-"));
  const paths = dataPaths(root);
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(paths.config, initialConfig());
  const server = createPanel({ root, passwordHash: await hashPassword("test-password-123"), sessionSecret: makeSecret(), binary: "missing-caddy" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true }); });

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Caddy 管理后台/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal((await fetch(`${base}/api/bootstrap`)).status, 401);

  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "test-password-123" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const { csrf } = await login.json();
  const bootstrap = await fetch(`${base}/api/bootstrap`, { headers: { cookie } });
  assert.equal(bootstrap.status, 200);
  assert.equal((await bootstrap.json()).managed, true);

  const noCsrf = await fetch(`${base}/api/apply`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ mode: "sites", sites: [] }) });
  assert.equal(noCsrf.status, 403);
  const badOrigin = await fetch(`${base}/api/apply`, { method: "POST", headers: { cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf, Origin: "https://attacker.invalid" }, body: JSON.stringify({ mode: "sites", sites: [] }) });
  assert.equal(badOrigin.status, 403);
  const apply = await fetch(`${base}/api/apply`, { method: "POST", headers: { cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ mode: "sites", sites: [] }) });
  assert.equal(apply.status, 400);
  assert.equal(await (await fetch(`${base}/%2e%2e/server.js`)).status, 404);
});
