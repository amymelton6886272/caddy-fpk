import test from "node:test";
import assert from "node:assert/strict";
import { defaultSites, initialConfig, isManaged, migrateLegacy, renderSites } from "../lib/config.js";

test("default configuration supports the internal management API", () => {
  const config = initialConfig();
  assert.match(config, /admin 0\.0\.0\.0:2019/);
  assert.match(config, /origins caddy:2019/);
  assert.equal(isManaged(config), true);
});

test("renders proxy and static sites without mixing directives", () => {
  const config = renderSites([
    { id: "app", name: "App", type: "proxy", address: "app.example.com", upstream: "192.168.1.10:3000" },
    { id: "files", name: "Files", type: "static", address: ":8080", root: "/srv/files" },
  ]);
  assert.match(config, /app\.example\.com \{\n\treverse_proxy 192\.168\.1\.10:3000\n\}/);
  assert.match(config, /:8080 \{\n\troot \* \/srv\/files\n\tfile_server\n\tencode gzip\n\}/);
  assert.equal(isManaged(config), true);
});

test("rejects invalid or duplicate sites", () => {
  assert.throws(() => renderSites([{ id: "bad", type: "proxy", address: "example.com {", upstream: "localhost:1" }]));
  assert.throws(() => renderSites([{ id: "bad", type: "proxy", address: "example.com", upstream: "http://localhost:3000" }]));
  assert.throws(() => renderSites([
    { id: "a", type: "proxy", address: "example.com", upstream: "localhost:1" },
    { id: "b", type: "proxy", address: "example.com", upstream: "localhost:2" },
  ]));
  assert.throws(() => renderSites([{ id: "bad", type: "static", address: ":8080", root: "relative" }]));
});

test("custom Caddyfile stays in advanced mode", () => {
  assert.equal(isManaged("example.com {\n reverse_proxy localhost:3000\n}\n"), false);
  assert.equal(isManaged(initialConfig().replaceAll("\n", "\r\n")), true);
  assert.equal(defaultSites()[0].type, "static");
});

test("site security policies combine basic authentication and IP allowlists", () => {
  const config = renderSites([{ id: "secure", type: "proxy", address: "private.example.com", upstream: "app:3000", authUser: "admin", authHash: "$2a$14$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu", allowedIps: ["192.168.1.0/24", "10.0.0.8", "::1"] }]);
  assert.match(config, /@denied not remote_ip 192\.168\.1\.0\/24 10\.0\.0\.8 ::1/);
  assert.match(config, /respond @denied "Forbidden" 403/);
  assert.match(config, /basic_auth \{\n\t\tadmin \$2a\$14\$/);
});

test("security policy input is validated", () => {
  assert.throws(() => renderSites([{ id: "bad", type: "static", address: ":8080", root: "/srv", allowedIps: ["999.1.1.1"] }]));
  assert.throws(() => renderSites([{ id: "bad", type: "static", address: ":8080", root: "/srv", authUser: "admin" }]));
});

test("simple legacy proxy sites can be migrated without losing upstreams", () => {
  const legacy = initialConfig().replace("# BEGIN CADDY FPK PANEL\n# END CADDY FPK PANEL", "") + "\napp.example.com {\n\treverse_proxy 192.168.1.10:3000\n}\n";
  const migrated = migrateLegacy(legacy);
  assert.equal(migrated.sites[0].upstream, "192.168.1.10:3000");
  assert.equal(migrateLegacy("example.com {\n\trespond \"Hello\"\n}\n"), null);
});
