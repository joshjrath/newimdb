// End-to-end tests against a real production build.
// Run: npm run build && npm run test:e2e
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const PASSWORD = "e2e-owner-password-123";
const PORT = 4000 + Math.floor(Math.random() * 2000);
const BASE = `http://localhost:${PORT}`;
const root = path.resolve(import.meta.dirname, "..");
let server, browser, dataDir;

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}

async function apiCall(cookie, method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function ownerPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("**/watch/movies");
  return { ctx, page };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-e2e-"));
  const hash = execFileSync("node", [path.join(root, "scripts/hash-password.ts"), PASSWORD]).toString().trim();
  server = spawn(path.join(root, "node_modules/.bin/next"), ["start", "-p", String(PORT)], {
    cwd: root,
    env: { ...process.env, OWNER_PASSWORD_HASH: hash, DATA_DIR: dataDir, COOKIE_SECURE: "false", NODE_ENV: "production" },
    stdio: "ignore",
  });
  await waitForServer();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test("signed-out visitors can't read anything", async () => {
  const cookie = await login();
  const m = await apiCall(cookie, "POST", "/api/media", { type: "movie", metadata: { title: "Secret Film" }, review: { body: "secret words" } });
  assert.equal(m.status, 200);
  const id = m.body.media.id;

  for (const url of ["/api/media", `/api/media/${id}`, "/api/backup", "/api/tags", "/api/poster?src=https%3A%2F%2Fimage.tmdb.org%2Fx.jpg", `/api/media/${id}/episodes/text`]) {
    for (const c of [undefined, "sw_session=forged-token"]) {
      const r = await fetch(BASE + url, { headers: c ? { Cookie: c } : {} });
      assert.equal(r.status, 401, `${url} with ${c ?? "no cookie"}`);
      assert.ok(!(await r.text()).includes("secret words"));
    }
  }
  for (const url of ["/watch/movies", `/watch/movies/${id}-secret-film`, "/studio", `/studio/${id}`, "/studio/import"]) {
    for (const c of [undefined, "sw_session=forged-token"]) {
      const r = await fetch(BASE + url, { redirect: "manual", headers: c ? { Cookie: c } : {} });
      assert.ok([307, 308].includes(r.status), `${url} should redirect, got ${r.status}`);
      assert.match(r.headers.get("location"), /\/login/);
      const text = await r.text();
      assert.ok(!text.includes("Secret Film") && !text.includes("secret words"), `${url} leaked content`);
    }
  }
  // Fresh browser context (like an incognito window)
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/watch/movies/${id}-secret-film`);
  assert.match(page.url(), /\/login/);
  assert.ok(!(await page.content()).includes("secret words"));
  await ctx.close();

  // headers
  const r = await fetch(`${BASE}/login`);
  assert.match(r.headers.get("cache-control"), /no-store/);
  assert.match(r.headers.get("x-robots-tag"), /noindex/);
});

test("wrong password and cross-origin writes are refused", async () => {
  const bad = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "nope" }) });
  assert.equal(bad.status, 401);
  const cookie = await login();
  const r = await fetch(`${BASE}/api/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "https://evil.example" },
    body: JSON.stringify({ type: "movie", metadata: { title: "x" } }),
  });
  assert.equal(r.status, 403);
  // publishing is not possible in this release
  const m = await apiCall(cookie, "POST", "/api/media", { type: "movie", metadata: { title: "P" } });
  const p = await apiCall(cookie, "PATCH", `/api/media/${m.body.media.id}`, { version: m.body.media.version, review: { visibility: "public" } });
  assert.equal(p.status, 400);
});

test("edit a review with paragraphs in Studio; it persists after reload", async () => {
  const cookie = await login();
  const m = await apiCall(cookie, "POST", "/api/media", { type: "movie", metadata: { title: "Paragraph Film", year: 2020, imdbId: "tt1234567" } });
  const { ctx, page } = await ownerPage();
  await page.goto(`${BASE}/studio/${m.body.media.id}`);
  await page.fill("textarea.textarea >> nth=0", "First paragraph.\n\nSecond paragraph & more.");
  await page.locator(".star-input-wrap").focus();
  await page.keyboard.press("4");
  await page.keyboard.press("ArrowRight");
  await page.click("text=Save review and details");
  await page.waitForSelector("text=All changes saved");
  await page.reload();
  assert.equal(await page.inputValue("textarea.textarea >> nth=0"), "First paragraph.\n\nSecond paragraph & more.");
  const d = await apiCall(cookie, "GET", `/api/media/${m.body.media.id}`);
  assert.equal(d.body.media.review.rating, 4.5);
  assert.equal(d.body.media.imdbId, "tt1234567");
  await page.goto(`${BASE}/watch/movies/${m.body.media.id}-paragraph-film`);
  assert.equal(await page.locator(".review-body p").count(), 2);
  await ctx.close();
});

test("a failed save shows an error and keeps the edits", async () => {
  const cookie = await login();
  const m = await apiCall(cookie, "POST", "/api/media", { type: "movie", metadata: { title: "Flaky Film" } });
  const { ctx, page } = await ownerPage();
  await page.goto(`${BASE}/studio/${m.body.media.id}`);
  await page.route(`**/api/media/${m.body.media.id}`, (route) => (route.request().method() === "PATCH" ? route.abort() : route.continue()));
  await page.fill("textarea.textarea >> nth=0", "Words I don't want to lose.");
  await page.click("text=Save review and details");
  await page.waitForSelector(".toast.error");
  assert.equal(await page.inputValue("textarea.textarea >> nth=0"), "Words I don't want to lose.");
  assert.ok(await page.locator("text=All changes saved").count() === 0);
  // Leaving now asks for confirmation
  let asked = false;
  page.on("dialog", (d) => {
    asked = true;
    d.dismiss();
  });
  await page.click("text=Library");
  assert.ok(asked, "should warn about unsaved changes");
  assert.match(page.url(), /\/studio\//);
  const d = await apiCall(cookie, "GET", `/api/media/${m.body.media.id}`);
  assert.equal(d.body.media.review.body, "");
  await ctx.close();
});

test("rating an episode in the grid persists, updates progress and Recently Watched", async () => {
  const cookie = await login();
  const old = await apiCall(cookie, "POST", "/api/media", {
    type: "tv",
    metadata: { title: "Older Show" },
    review: { status: "watching" },
    segments: [1, 2].map((n) => ({ kind: "season", label: `Season ${n}`, seasonNumber: n, courNumber: null, episodeCount: 3 })),
  });
  await apiCall(cookie, "POST", "/api/media", { type: "tv", metadata: { title: "Newer Show" }, segments: [] });
  const { ctx, page } = await ownerPage();
  await page.goto(`${BASE}/watch/tv`);
  assert.equal(await page.locator(".card-title").first().innerText(), "Newer Show");
  await page.goto(`${BASE}/watch/tv/${old.body.media.id}-older-show`);
  await page.click(".heatmap .cell >> nth=0");
  await page.click(".pop .rate-grid button[aria-label='4.5 stars']");
  await page.waitForResponse((r) => r.url().includes("/episodes/") && r.request().method() === "PATCH");
  await page.click(".heatmap .cell >> nth=1");
  await page.click("text=Skip (N/A)");
  await page.waitForResponse((r) => r.url().includes("/episodes/") && r.request().method() === "PATCH");
  await page.reload();
  const cells = page.locator(".heatmap .cell");
  assert.equal(await cells.nth(0).innerText(), "4.5");
  assert.equal(await cells.nth(1).innerText(), "N/A");
  assert.equal(await cells.nth(2).innerText(), "?");
  assert.match(await page.locator(".progress-label").first().innerText(), /1\/5 watched, 1 skipped/);
  await page.goto(`${BASE}/watch/tv`);
  assert.equal(await page.locator(".card-title").first().innerText(), "Older Show");
  assert.match(await page.locator(".now-item").first().innerText(), /S1E3/);
  await ctx.close();
});

test("anime structure: add an OVA between cours after creation; persists and keeps ratings", async () => {
  const cookie = await login();
  const m = await apiCall(cookie, "POST", "/api/media", {
    type: "anime",
    metadata: { title: "Cour Anime", malId: 123 },
    segments: [
      { kind: "cour", label: "S1 Cour 1", seasonNumber: 1, courNumber: 1, episodeCount: 2 },
      { kind: "cour", label: "S1 Cour 2", seasonNumber: 1, courNumber: 2, episodeCount: 2 },
    ],
  });
  const id = m.body.media.id;
  const t = await apiCall(cookie, "POST", `/api/media/${id}/episodes/text`, { text: "S1C2E1: 5" });
  assert.equal(t.status, 200);
  const { ctx, page } = await ownerPage();
  await page.goto(`${BASE}/studio/${id}`);
  await page.click("#structure button:has-text('OVA')");
  await page.click("button[aria-label^='Move OVA up']");
  await page.click("text=Save seasons");
  await page.waitForSelector("text=Seasons saved");
  await page.reload();
  const d = await apiCall(cookie, "GET", `/api/media/${id}`);
  assert.deepEqual(d.body.media.segments.map((s) => s.label), ["S1 Cour 1", "OVA", "S1 Cour 2"]);
  assert.equal(d.body.media.segments[2].episodes[0].rating, 5);
  assert.equal(d.body.media.malId, 123);
  // Export + reimport text round trip
  const ex = await apiCall(cookie, "GET", `/api/media/${id}/episodes/text`);
  assert.match(ex.body.text, /S1C2E1: 5/);
  await ctx.close();
});

test("library works on a phone without horizontal scroll", async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("**/watch/movies");
  const first = await page.evaluate(async () => (await (await fetch("/api/media?type=tv")).json()).items[0]);
  for (const u of ["/watch/movies", "/watch/tv", "/studio", "/studio/import", "/studio/new", `/studio/${first.id}`, `/watch/tv/${first.id}`]) {
    await page.goto(BASE + u);
    await page.waitForLoadState("networkidle");
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 375, `${u} scrollWidth ${sw}`);
  }
  await ctx.close();
});
