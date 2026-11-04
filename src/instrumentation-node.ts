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
startEpisodeScheduler();
