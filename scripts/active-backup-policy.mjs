import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";

const retentionMs = 30 * 24 * 60 * 60 * 1000;
const backupName = /^saleserp-active-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump$/;

export function isExpiredBackup(name, isFile, modifiedAt, now) {
  return isFile && backupName.test(name) && now - modifiedAt > retentionMs;
}

export function isActiveLocalConnection(local, active) {
  if (!["postgres:", "postgresql:"].includes(local.protocol) || local.hostname !== "localhost" || !local.username || !local.password || !local.pathname.slice(1)) {
    return false;
  }
  if (active.hostname !== "host.docker.internal") return false;
  const mapped = new URL(active.href);
  mapped.hostname = "localhost";
  return mapped.href === local.href;
}

export function backupConfigurationDigest(root, settings) {
  const files = new Set([
    resolve(root, ".env"),
    resolve(root, "compose.yaml"),
    resolve(root, "compose.yml"),
    resolve(root, "compose.override.yaml"),
    resolve(root, "compose.override.yml"),
    resolve(root, "docker-compose.yml"),
    resolve(root, "docker-compose.yaml"),
    resolve(root, "docker-compose.override.yml"),
    resolve(root, "docker-compose.override.yaml"),
    ...(settings.COMPOSE_FILE || "").split(settings.COMPOSE_PATH_SEPARATOR || delimiter)
      .filter(Boolean).map((path) => resolve(root, path)),
  ]);
  const hash = createHash("sha256");
  for (const path of [...files].sort()) {
    const name = Buffer.from(path);
    hash.update(`${name.length}:`).update(name);
    if (!existsSync(path)) {
      hash.update(":missing;");
      continue;
    }
    const content = readFileSync(path);
    hash.update(`:${content.length}:`).update(content);
  }
  return hash.digest("hex");
}

export function verifyPinnedConfiguration(pin, digest) {
  if (!pin || pin.version !== 1 || typeof pin.digest !== "string" || pin.digest !== digest) {
    throw new Error("The verified backup target is missing or local configuration changed. Re-verify it while the app is running.");
  }
}
