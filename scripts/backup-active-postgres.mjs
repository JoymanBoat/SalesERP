import { spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

import { isActiveLocalConnection, isExpiredBackup } from "./active-backup-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backups = join(root, "backups");
const envPath = join(root, ".env");
const postgresBin = join(process.env.ProgramFiles || "C:\\Program Files", "PostgreSQL", "17", "bin");
const dumpTool = join(postgresBin, "pg_dump.exe");
const restoreTool = join(postgresBin, "pg_restore.exe");

function run(tool, args, options = {}) {
  const result = spawnSync(tool, args, { cwd: root, encoding: "utf8", windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${tool} failed with exit code ${result.status}: ${result.stderr?.trim() || "no error output"}`);
  return result.stdout;
}

function localConnection() {
  const settings = dotenv.parse(readFileSync(envPath));
  if (!settings.DATABASE_URL) throw new Error("DATABASE_URL is missing from .env.");
  const local = new URL(settings.DATABASE_URL);
  const activeText = run("docker", ["compose", "exec", "-T", "app", "node", "-p", "process.env.DATABASE_URL"]);
  const active = new URL(activeText.trim());
  if (!isActiveLocalConnection(local, active)) throw new Error("The running app database does not match the configured localhost database; refusing to back up a different database.");
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
  if (!existsSync(dumpTool) || !existsSync(restoreTool)) throw new Error("PostgreSQL 17 pg_dump and pg_restore are required under Program Files.");
  const url = localConnection();
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
