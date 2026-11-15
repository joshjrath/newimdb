// A background job that fails (a provider down, a slow site, a bad response) must never take
// the whole site down: log it and keep serving. Node would otherwise exit on an unhandled
// rejection, and after a few crashes in a row the host stops restarting the app.
const g = globalThis as unknown as { __crashGuard?: boolean };
if (!g.__crashGuard) {
  g.__crashGuard = true;
  process.on("unhandledRejection", (reason) => console.error("[background] unhandled error (kept running):", reason));
  process.on("uncaughtException", (err) => console.error("[background] uncaught error (kept running):", err));
}

import { registerRelease } from "./lib/repo/releases";
import { startEpisodeScheduler } from "./lib/episodes/sync";
import { autoMergeDuplicates } from "./lib/repo/duplicates";

try {
  registerRelease();
} catch (e) {
  console.error("[startup] couldn't record this deploy:", e);
}
// Fold any duplicates left by earlier imports into one entry each.
try {
  autoMergeDuplicates();
} catch {}
// Keep every show's episode list current without re-importing.
try {
  startEpisodeScheduler();
} catch (e) {
  console.error("[startup] background checks didn't start:", e);
}
