import { registerRelease } from "./lib/repo/releases";

try {
  registerRelease();
} catch (e) {
  console.error("[startup] couldn't record this deploy:", e);
}
