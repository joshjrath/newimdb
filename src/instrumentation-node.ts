import { registerRelease } from "./lib/repo/releases";
import { startEpisodeScheduler } from "./lib/episodes/sync";

try {
  registerRelease();
} catch (e) {
  console.error("[startup] couldn't record this deploy:", e);
}
// Keep every show's episode list current without re-importing.
startEpisodeScheduler();
