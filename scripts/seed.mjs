// Loads clearly-labelled SAMPLE content so the UI can be tried before real data is imported.
// These are not the owner's reviews. Remove them in Studio (filter by the "Sample" tag, select all, Delete).
import fs from "node:fs";
import path from "node:path";

const base = process.env.SEED_URL || "http://localhost:3000";
const password = process.env.OWNER_PASSWORD || process.argv[2];
if (!password) {
  console.error("Usage: OWNER_PASSWORD=... npm run seed   (the app must be running)");
  process.exit(1);
}
const headers = { "Content-Type": "application/json", Origin: base };
const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ password }) });
if (!login.ok) {
  console.error("Login failed:", await login.text());
  process.exit(1);
}
const cookie = login.headers.get("set-cookie").split(";")[0];
const data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "sample-data.json"), "utf8"));
for (const item of data) {
  const res = await fetch(`${base}/api/media?allowDuplicate=1`, { method: "POST", headers: { ...headers, Cookie: cookie }, body: JSON.stringify(item.create) });
  const body = await res.json();
  if (!res.ok) {
    console.error(item.create.metadata.title, body);
    continue;
  }
  if (item.ratings) {
    const r = await fetch(`${base}/api/media/${body.media.id}/episodes/text`, { method: "POST", headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ text: item.ratings }) });
    if (!r.ok) console.error("ratings", item.create.metadata.title, await r.text());
  }
  console.log("Added sample:", item.create.metadata.title);
}
