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
