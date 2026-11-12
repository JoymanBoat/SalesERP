import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";

import { backupConfigurationDigest, isActiveLocalConnection, isExpiredBackup, verifyPinnedConfiguration } from "./active-backup-policy.mjs";

describe("active database backup policy", () => {
  it("only accepts the running application's matching local PostgreSQL connection", () => {
    const local = new URL("postgresql://app:secret@localhost:5432/saleserp?schema=public");
    const active = new URL("postgresql://app:secret@host.docker.internal:5432/saleserp?schema=public");
    assert.equal(isActiveLocalConnection(local, active), true);
    for (const value of [
      "postgresql://app:secret@db:5432/saleserp?schema=public",
      "postgresql://app:secret@host.docker.internal:5432/other?schema=public",
      "postgresql://app:other@host.docker.internal:5432/saleserp?schema=public",
      "postgresql://app:secret@host.docker.internal:5433/saleserp?schema=public",
    ]) {
      assert.equal(isActiveLocalConnection(local, new URL(value)), false);
    }
    assert.equal(isActiveLocalConnection(new URL("postgresql://app@localhost/saleserp"), active), false);
  });

  it("expires only matching regular backup files older than 30 days", () => {
    const name = "saleserp-active-20261110T142533Z-22c85fa1.dump";
    const now = 40 * 24 * 60 * 60 * 1000;
    const boundary = now - 30 * 24 * 60 * 60 * 1000;
    assert.equal(isExpiredBackup(name, true, boundary - 1, now), true);
    assert.equal(isExpiredBackup(name, true, boundary, now), false);
    assert.equal(isExpiredBackup(name, false, boundary - 1, now), false);
    assert.equal(isExpiredBackup("saleserp-docker-20261110.dump", true, 0, now), false);
    assert.equal(isExpiredBackup(`${name}.partial`, true, 0, now), false);
  });

  it("binds the pin to the local environment and every configured compose file", () => {
    const root = mkdtempSync(join(tmpdir(), "saleserp-backup-policy-"));
    try {
      writeFileSync(join(root, ".env"), "DATABASE_URL=example\n");
      writeFileSync(join(root, "compose.yaml"), "services: {}\n");
      writeFileSync(join(root, "custom.yaml"), "services: {}\n");
      const settings = { COMPOSE_FILE: ["compose.yaml", "custom.yaml"].join(delimiter) };
      const digest = backupConfigurationDigest(root, settings);
      verifyPinnedConfiguration({ version: 1, digest }, digest);
      assert.throws(() => verifyPinnedConfiguration(null, digest), /missing or local configuration changed/);
      writeFileSync(join(root, "custom.yaml"), "services: { app: {} }\n");
      assert.throws(() => verifyPinnedConfiguration({ version: 1, digest }, backupConfigurationDigest(root, settings)), /configuration changed/);
      writeFileSync(join(root, "custom.yaml"), "services: {}\n");
      writeFileSync(join(root, "compose.override.yaml"), "services: {}\n");
      assert.notEqual(backupConfigurationDigest(root, settings), digest);
      writeFileSync(join(root, ".env"), "DATABASE_URL=changed\n");
      assert.notEqual(backupConfigurationDigest(root, settings), digest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
