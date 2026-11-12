import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, makeSecret, SessionManager, verifyPassword } from "../lib/store.js";

test("scrypt verifies the correct password only", async () => {
  const encoded = await hashPassword("a-secure-test-password");
  assert.equal(await verifyPassword("a-secure-test-password", encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
  assert.equal(await verifyPassword("a-secure-test-password", "invalid"), false);
});

test("sessions expire and rate limits are enforced", () => {
  const manager = new SessionManager(makeSecret());
  const session = manager.create();
  assert.equal(manager.get(session.id).csrf, session.csrf);
  manager.destroy(session.id);
  assert.equal(manager.get(session.id), null);
  for (let count = 0; count < 8; count += 1) manager.failed("192.0.2.1");
  assert.equal(manager.allowed("192.0.2.1"), false);
  assert.equal(manager.allowed("192.0.2.2"), true);
});
