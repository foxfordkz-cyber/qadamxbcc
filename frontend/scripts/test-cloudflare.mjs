// Exercise the compiled Worker in workerd, with a deterministic HTTPS API fixture.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
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
const circleToken = randomBytes(32).toString("base64url");
let circleCode = "ABCDEF0123456789";
let signedIn = false;
const mf = new Miniflare(await convertV4MiniflareOptions({
  name: config.name, modules, modulesRoot: directory,
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  assets: { directory: path.resolve("dist/client"), binding: "ASSETS", routerConfig: { has_user_worker: true } },
  bindings: { ...config.vars, BCC_API_URL: upstream, BCC_DEMO_PUBLIC_ORIGIN: origin,
    BCC_DEMO_UPSTREAM_API_KEY: apiKey, BCC_DEMO_UPSTREAM_SOC_KEY: socKey },
  outboundService: async request => {
    const url = new URL(request.url);
    assert.equal(url.origin, upstream);
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    if (url.pathname.startsWith("/api/v1/trusted-contacts")) {
      assert.equal(request.headers.get("Authorization"), null);
      assert.equal(request.headers.get("X-BCC-API-Key"), apiKey);
      if (url.pathname.endsWith("/web-session") && request.method === "GET") return Response.json({ available: true });
      if (url.pathname.endsWith("/web-session") && request.method === "POST") {
        if ((await request.json()).code !== circleCode || signedIn) return Response.json({ detail: "invalid_or_expired_code" }, { status: 401 });
        signedIn = true; circleCode = "";
        return Response.json({ session: circleToken, expires_in: 900 });
      }
      if (!signedIn || request.headers.get("X-BCC-Circle-Session") !== circleToken) return Response.json({ detail: "circle_login_required" }, { status: 401 });
      if (request.method === "DELETE") { signedIn = false; return new Response(null, { status: 204 }); }
      return Response.json({ contacts: [] });
    }
    const soc = url.pathname === "/api/v1/soc/feed";
    assert.ok(soc || url.pathname === "/api/v1/transfers/evaluate");
    assert.equal(request.headers.get("X-BCC-SOC-Key"), soc ? socKey : null);
    assert.equal(request.headers.get("X-BCC-API-Key"), soc ? null : apiKey);
    if (!soc) {
      const source = request.headers.get("x-bcc-submission-source");
      assert.match(source ?? "", /^[a-f0-9]{64}$/);
      assert.notEqual(source, "1".repeat(64));
    }
    paths.push(url.pathname);
    if (soc && url.searchParams.has("since")) return Response.redirect("https://elsewhere.example/");
    return Response.json(soc ? { items: [], total: 0 } : { status: "approved" });
  },
}));
const fetch = (pathname, options) => mf.dispatchFetch(origin + pathname, options);
function checkInitialLanguageSwitch(html) {
  const group = html.match(/<div\b[^>]*class="language"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.match(group, /aria-busy="true"/);
  for (const label of ["ҚАЗ", "РУС"]) {
    // The visible controls must wait for hydration before accepting the first press.
    assert.match(group, new RegExp(`<button\\b[^>]*\\bdisabled(?:=""|(?=[\\s>]))[^>]*>${label}</button>`));
  }
}
try {
  await checkPrivateCircle();
  for (const pathname of ["/", "/mobile", "/pitch"]) {
    const response = await fetch(pathname);
    assert.equal(response.status, 200, pathname);
    const html = await response.text();
    assert.ok(html.includes("Saq Bol"), pathname);
    if (pathname !== "/pitch") {
      const header = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0] ?? "";
      checkInitialLanguageSwitch(header);
      assert.match(header, /<img\b[^>]*src="\/saq-bol-mark\.svg"/, pathname);
      assert.ok(header.includes('href="https://saq-bol-jury.onrender.com/"'), pathname);
      assert.ok(html.includes('href="https://saq-bol-mobile.onrender.com/wallet/"'), pathname);
    }
    if (pathname === "/") {
      assert.match(html, /class="public-signin"[^>]*>Кіру/, "Public navigation must lead to sign-in");
      assert.ok(!html.includes('id="tab-soc"') && !html.includes('class="transfer-cta"'), "Public home must not mount the workspaces");
    }
    assert.ok(!html.includes(apiKey) && !html.includes(socKey), pathname);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  for (const path of ["/soc", "/soc?workspace=full"]) {
    const response = await fetch(path, { redirect: "manual" });
    assert.ok([303, 307, 308].includes(response.status), "Hosted SOC requires wallet sign-in");
    assert.equal(response.headers.get("location"), "https://saq-bol-jury.onrender.com/");
  }
  assert.equal((await (await fetch("/health")).json()).status, "ok");
  assert.deepEqual(await (await fetch("/health?tour=1")).json(), { source: "api" });
  const tour = await (await fetch("/mobile?tour=1")).text();
  assert.ok(tour.includes("Стендті дайындап жатырмыз"), "jury entry should render the warm-up screen");
  assert.ok(!tour.includes('class="wallet-home-account"'), "the ordinary wallet must stay unmounted during a tour");
  assert.deepEqual(await (await fetch("/mobile/link")).json(), { origins: [origin] });
  assert.equal((await fetch("/icons/icon-192.png")).status, 200);
  const mark = await fetch("/saq-bol-mark.svg");
  assert.equal(mark.status, 200);
  assert.match(mark.headers.get("content-type") ?? "", /image\/svg\+xml/);
  assert.equal(await mark.text(), await readFile("public/saq-bol-mark.svg", "utf8"));
  const release = await (await fetch("/downloads/current.json")).json();
  const apkPath = release.url;
  const apk = await fetch(apkPath);
  assert.equal(apk.status, 200, "Android installer must be available without a login");
  const installerHtml = await (await fetch("/download/android")).text();
  checkInitialLanguageSwitch(installerHtml);
  assert.ok(installerHtml.includes(apkPath));
  const team = await (await fetch("/downloads/team.json")).json();
  assert.equal(team.package, "kz.qadamx.bccshield.demo");
  assert.deepEqual(team, release);
  const legacy = await (await fetch("/downloads/legacy-website-2.9.json")).json();
  assert.equal(legacy.package, "kz.qadamx.bccshield.website");
  assert.ok(installerHtml.includes(legacy.url));
  assert.equal(createHash("sha256").update(Buffer.from(await apk.arrayBuffer())).digest("hex"), release.apk_sha256);
  for (const pathname of ["/", "/mobile"]) {
    assert.ok((await (await fetch(pathname)).text()).includes('href="/download/android'), `${pathname} is missing the installer link`);
  }
  assert.deepEqual(await (await fetch("/api/v1/soc/feed")).json(), { items: [], total: 0 });
  const publicWrite = { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" };
  assert.equal((await fetch(`/api/v1/soc/recipients/${config.vars.BCC_NORMAL_SENDER_ID}/flag`, publicWrite)).status, 403);
  assert.equal((await fetch(`/api/v1/soc/recipients/${config.vars.BCC_NORMAL_SENDER_ID}/prior-receipts?version=1`)).status, 403);
  assert.equal((await fetch("/api/v1/integrations/guardian/soc/cases", publicWrite)).status, 403);
  const transfer = { sender_id: config.vars.BCC_NORMAL_SENDER_ID, recipient_phone: config.vars.BCC_NORMAL_RECIPIENT_PHONE, amount: "25000", context: {} };
  const post = source => fetch("/api/v1/transfers/evaluate", {
    method: "POST", headers: { origin: source, "content-type": "application/json", "x-bcc-submission-source": "1".repeat(64) }, body: JSON.stringify(transfer),
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

async function checkPrivateCircle() {
  const members = "/api/v1/trusted-circle/members";
  const login = "/api/v1/trusted-circle/session";
  const body = JSON.stringify({ code: circleCode });
  const headers = { origin, "content-type": "application/json" };
  assert.deepEqual(await (await fetch(login)).json(), { available: true });
  assert.equal((await fetch(members, { headers: { "X-BCC-Circle-Session": circleToken } })).status, 401);
  assert.equal((await fetch(login, { method: "POST", headers: { ...headers, origin: "https://untrusted.example" }, body })).status, 403);
  const entered = await fetch(login, { method: "POST", headers, body });
  assert.equal(entered.status, 200);
  assert.deepEqual(await entered.json(), { signed_in: true });
  const cookie = entered.headers.get("set-cookie") || "";
  for (const attr of ["__Host-saqbol-circle=", "Path=/", "HttpOnly", "Secure", "SameSite=strict"]) assert.ok(cookie.toLowerCase().includes(attr.toLowerCase()), attr);
  const authenticated = { ...headers, cookie: cookie.split(";")[0] };
  assert.equal((await fetch(login, { method: "POST", headers, body })).status, 401);
  assert.deepEqual(await (await fetch(members, { headers: authenticated })).json(), { contacts: [], private_session: true });
  assert.equal((await fetch(members)).status, 401);
  assert.equal((await fetch(login, { method: "DELETE", headers: authenticated })).status, 200);
  assert.equal((await fetch(members, { headers: authenticated })).status, 401);
}
