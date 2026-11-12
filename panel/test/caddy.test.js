import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listBackups, listCertificates, readBackup } from "../lib/caddy.js";
import { dataPaths } from "../lib/store.js";

test("backup names cannot escape the history directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "caddy-backups-"));
  const paths = dataPaths(root);
  await assert.rejects(readBackup(paths, "../Caddyfile"), /备份文件名无效/);
  await rm(root, { recursive: true });
});

test("certificate metadata is summarized without exposing private keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "caddy-certificates-"));
  const directory = join(root, "data", "caddy", "certificates", "acme-v02.api.letsencrypt.org-directory", "example.com");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "example.com.json"), JSON.stringify({ sans: ["example.com"], issuer: "acme", not_after: "2030-01-01T00:00:00Z", managed: true }));
  const certificates = await listCertificates(root);
  assert.equal(certificates.length, 1);
  assert.equal(certificates[0].name, "example.com");
  assert.equal("PrivateKeyPEM" in certificates[0], false);
  await rm(root, { recursive: true });
});
