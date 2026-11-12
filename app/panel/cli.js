#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { hashPassword, makeSecret, writeSecret } from "../panel/lib/store.js";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--data-root");
const passwordIndex = args.indexOf("--password");
const root = rootIndex >= 0 ? args[rootIndex + 1] : "";
const password = passwordIndex >= 0 ? args[passwordIndex + 1] : "";
if (args[0] !== "init" || !root || password.length < 10 || password.length > 128) {
  console.error("Usage: cli.js init --data-root PATH --password PASSWORD (10-128 characters)");
  process.exit(1);
}
const panel = join(root, "panel");
await mkdir(panel, { recursive: true, mode: 0o700 });
await writeSecret(join(panel, "password.hash"), await hashPassword(password));
await writeSecret(join(panel, "session.secret"), makeSecret());
