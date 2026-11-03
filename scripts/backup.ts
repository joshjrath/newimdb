// Consistent SQLite snapshot into DATA_DIR/backups. Safe to run while the app is up (e.g. from cron).
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { dataDir, dataSubdir } from "../src/lib/db.ts";

const file = process.env.DATABASE_FILE || path.join(dataDir(), "watch.db");
if (!fs.existsSync(file)) {
  console.error(`No database at ${file}`);
  process.exit(1);
}
const dest = path.join(dataSubdir("backups"), `watch-${new Date().toISOString().replace(/[:.]/g, "-")}-cli.db`);
await new Database(file, { readonly: true }).backup(dest);
console.log(`Backup written to ${dest}`);
