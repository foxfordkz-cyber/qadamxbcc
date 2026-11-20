// Exercise the compiled Worker in workerd, with a deterministic HTTPS API fixture.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const directory = path.resolve("dist/server");
const config = JSON.parse(await readFile(path.join(directory, "wrangler.json"), "utf8"));
const files = await readdir(directory, { recursive: true });
const jsFiles = [config.main, ...files.filter(file => /\.m?js$/.test(file) && file !== config.main)];
const modules = await Promise.all(jsFiles.map(async file => ({
  type: "ESModule", path: path.join(directory, file), contents: await readFile(path.join(directory, file)),
})));
const origin = "https://frontend.example";
const upstream = "https://api.example";
const apiKey = randomBytes(32).toString("hex");
const socKey = randomBytes(32).toString("hex");
const paths = [];
const mf = new Miniflare(await convertV4MiniflareOptions({
  name: config.name, modules, modulesRoot: directory,
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  assets: { directory: path.resolve("dist/client"), binding: "ASSETS", routerConfig: { has_user_worker: true } },
  bindings: { ...config.vars, BCC_API_URL: upstream, BCC_DEMO_PUBLIC_ORIGIN: origin,
    BCC_DEMO_UPSTREAM_API_KEY: apiKey, BCC_DEMO_UPSTREAM_SOC_KEY: socKey },
  outboundService: async request => {
    const url = new URL(request.url);
    assert.equal(url.origin, upstream);
    const soc = url.pathname === "/api/v1/soc/feed";
    assert.ok(soc || url.pathname === "/api/v1/transfers/evaluate");
    assert.equal(request.headers.get("X-BCC-SOC-Key"), soc ? socKey : null);
    assert.equal(request.headers.get("X-BCC-API-Key"), soc ? null : apiKey);
    paths.push(url.pathname);
    if (soc && url.searchParams.has("since")) return Response.redirect("https://elsewhere.example/");
    return Response.json(soc ? { items: [], total: 0 } : { status: "approved" });
  },
}));
const fetch = (pathname, options) => mf.dispatchFetch(origin + pathname, options);
try {
  for (const pathname of ["/", "/mobile", "/pitch"]) {
    const response = await fetch(pathname);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.ok(html.includes("Saq Bol"), pathname);
    assert.ok(!html.includes(apiKey) && !html.includes(socKey), pathname);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  assert.equal((await (await fetch("/health")).json()).status, "ok");
  assert.deepEqual(await (await fetch("/mobile/link")).json(), { origins: [origin] });
  assert.equal((await fetch("/icons/icon-192.png")).status, 200);
  assert.deepEqual(await (await fetch("/api/v1/soc/feed")).json(), { items: [], total: 0 });
  const transfer = { sender_id: config.vars.BCC_NORMAL_SENDER_ID, recipient_phone: config.vars.BCC_NORMAL_RECIPIENT_PHONE, amount: "25000", context: {} };
  const post = source => fetch("/api/v1/transfers/evaluate", {
    method: "POST", headers: { origin: source, "content-type": "application/json" }, body: JSON.stringify(transfer),
  });
  assert.equal((await post("https://untrusted.example")).status, 403);
  assert.deepEqual(await (await post(origin)).json(), { status: "approved" });
  const redirect = await fetch("/api/v1/soc/feed?since=2026-11-18T00:00:00Z");
  assert.equal(redirect.status, 502);
  assert.equal(redirect.headers.get("location"), null);
  assert.deepEqual(paths, ["/api/v1/soc/feed", "/api/v1/transfers/evaluate", "/api/v1/soc/feed"]);
  console.log("Cloudflare Worker smoke passed (SSR, middleware, assets, Render BFF and same-origin requests).");
} finally {
  await mf.dispose();
}
