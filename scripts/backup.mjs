// Consistent SQLite snapshot into DATA_DIR/backups. Safe to run while the app is up (e.g. from cron).
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.env.DATA_DIR || "data");
const file = process.env.DATABASE_FILE || path.join(dir, "watch.db");
if (!fs.existsSync(file)) {
  console.error(`No database at ${file}`);
  process.exit(1);
}
const out = path.join(dir, "backups");
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const dest = path.join(out, `watch-${new Date().toISOString().replace(/[:.]/g, "-")}-cli.db`);
await new Database(file, { readonly: true }).backup(dest);
console.log(`Backup written to ${dest}`);
