import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isActiveLocalConnection, isExpiredBackup } from "./active-backup-policy.mjs";

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
});
