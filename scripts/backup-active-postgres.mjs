import { spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

import { backupConfigurationDigest, isActiveLocalConnection, isExpiredBackup, verifyPinnedConfiguration } from "./active-backup-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backups = join(root, "backups");
const envPath = join(root, ".env");
const pinPath = join(backups, "active-backup-target.json");
const postgresBin = join(process.env.ProgramFiles || "C:\\Program Files", "PostgreSQL", "17", "bin");
const dumpTool = join(postgresBin, "pg_dump.exe");
const restoreTool = join(postgresBin, "pg_restore.exe");

function run(tool, args, options = {}) {
  const result = spawnSync(tool, args, { cwd: root, encoding: "utf8", windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${tool} failed with exit code ${result.status}: ${result.stderr?.trim() || "no error output"}`);
  return result.stdout;
}

function localConnection(pinTarget) {
  const settings = dotenv.parse(readFileSync(envPath));
  if (!settings.DATABASE_URL) throw new Error("DATABASE_URL is missing from .env.");
  for (const key of ["COMPOSE_FILE", "COMPOSE_PATH_SEPARATOR"]) {
    if (process.env[key] && process.env[key] !== settings[key]) {
      throw new Error(`${key} in the process environment differs from .env; refusing to determine the backup target.`);
    }
  }
  const local = new URL(settings.DATABASE_URL);
  const digest = backupConfigurationDigest(root, settings);
  const verifyPin = () => {
    if (!existsSync(pinPath)) throw new Error("The verified backup target is missing. Re-verify it while the app is running.");
    verifyPinnedConfiguration(JSON.parse(readFileSync(pinPath, "utf8")), digest);
  };
  const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (docker.status === 0) {
    const activeText = run("docker", ["compose", "exec", "-T", "app", "node", "-p", "process.env.DATABASE_URL"]);
    const active = new URL(activeText.trim());
    if (!isActiveLocalConnection(local, active)) throw new Error("The running app database does not match the configured localhost database; refusing to back up a different database.");
    if (pinTarget) {
      mkdirSync(backups, { recursive: true });
      writeFileSync(pinPath, `${JSON.stringify({ version: 1, digest })}\n`, { flag: "w", mode: 0o600 });
      console.log("Pinned the verified local database backup configuration.");
    } else {
      verifyPin();
      console.log("Backup target matches the running app and pinned configuration.");
    }
  } else {
    if (pinTarget) throw new Error("Docker and the running app are required to verify and pin the backup target.");
    verifyPin();
    console.log("Docker is unavailable; backing up the previously verified pinned host database.");
  }
  return local;
}

function prune(now) {
  for (const name of readdirSync(backups)) {
    const path = join(backups, name);
    const stat = lstatSync(path);
    if (isExpiredBackup(name, stat.isFile(), stat.mtimeMs, now)) {
      unlinkSync(path);
      console.log(`Removed expired active-database backup: ${name}`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--pin")) {
    throw new Error("Usage: node scripts/backup-active-postgres.mjs [--pin]");
  }
  if (!existsSync(dumpTool) || !existsSync(restoreTool)) throw new Error("PostgreSQL 17 pg_dump and pg_restore are required under Program Files.");
  const url = localConnection(args[0] === "--pin");
  if (args[0] === "--pin") return;
  mkdirSync(backups, { recursive: true });
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const name = `saleserp-active-${stamp}-${randomUUID().slice(0, 8)}.dump`;
  const finalPath = join(backups, name);
  const partialPath = `${finalPath}.partial`;
  closeSync(openSync(partialPath, "wx"));
  try {
    run(dumpTool, [
      "--no-password", "--format=custom", "--host", url.hostname,
      "--port", url.port || "5432", "--username", decodeURIComponent(url.username),
      "--dbname", decodeURIComponent(url.pathname.slice(1)), "--file", partialPath,
    ], { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) } });
    if (lstatSync(partialPath).size === 0) throw new Error("The backup archive is empty.");
    run(restoreTool, ["--file", "NUL", partialPath]);
    renameSync(partialPath, finalPath);
  } catch (error) {
    if (existsSync(partialPath)) unlinkSync(partialPath);
    throw error;
  }
  console.log(`Verified active-database backup: ${finalPath}`);
  prune(now.getTime());
}

main();
