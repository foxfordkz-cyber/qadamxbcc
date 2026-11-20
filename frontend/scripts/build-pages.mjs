// Build the static GitHub Pages demo into <out> (default: frontend/pages-out).
// usage: node scripts/build-pages.mjs [out] [--base /qadamxbcc]
//
// GitHub Pages serves files only, so this works on a temporary copy of the frontend:
// server routes (API proxy, health, mobile link, request proxy) are removed, pages are
// rendered at build time, and the synthetic demo engine runs in the browser
// (src/lib/static-api.ts). The FastAPI backend, PostgreSQL and the ML model are not used.
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "/qadamxbcc";
const outArg = args.find((value, index) => !value.startsWith("--") && (baseIndex < 0 || index !== baseIndex + 1));
const out = path.resolve(outArg ?? path.join(root, "pages-out"));
if (base && !/^\/[A-Za-z0-9._-]+$/.test(base)) throw new Error(`Invalid base path: ${base}`);

const work = await mkdtemp(path.join(os.tmpdir(), "saqbol-pages-"));
try {
  const skip = new Set(["node_modules", ".next", "pages-out", "tests", "scripts"]);
  await cp(root, work, { recursive: true, filter: source => !skip.has(path.relative(root, source).split(path.sep)[0]) || source === root });
  await symlink(path.join(root, "node_modules"), path.join(work, "node_modules"), "dir");
  for (const server of ["src/app/api", "src/app/health", "src/app/mobile/link", "src/proxy.ts"]) await rm(path.join(work, server), { recursive: true, force: true });
  for (const page of ["src/app/page.tsx", "src/app/mobile/page.tsx", "src/app/pitch/page.tsx"]) {
    const file = path.join(work, page);
    const text = await readFile(file, "utf8");
    if (!text.includes('export const dynamic = "force-dynamic";')) throw new Error(`${page}: expected a force-dynamic export`);
    await writeFile(file, text.replace('export const dynamic = "force-dynamic";', 'export const dynamic = "force-static";'));
  }
  // The web manifest is a route handler: render it once, with paths under the base path.
  const manifest = path.join(work, "src/app/manifest.ts");
  let manifestText = (await readFile(manifest, "utf8"))
    .replace('id: "/mobile"', `id: "${base}/mobile/"`).replace('start_url: "/mobile"', `start_url: "${base}/mobile/"`)
    .replace('scope: "/"', `scope: "${base}/"`).replaceAll('src: "/', `src: "${base}/`);
  manifestText = `export const dynamic = "force-static";\n${manifestText}`;
  await writeFile(manifest, manifestText);
  const walletOrigin = new URL((await readFile(path.join(root, "../android-app/demo-origin.txt"), "utf8")).trim());
  if (walletOrigin.protocol !== "https:" || walletOrigin.username || walletOrigin.password) throw new Error("Invalid demo HTTPS origin");
  const env = { ...process.env, NEXT_PUBLIC_CONNECTED_WALLET: new URL("/wallet/", walletOrigin).href, BCC_PAGES: "1", NEXT_PUBLIC_BCC_STATIC: "1", NEXT_PUBLIC_BASE_PATH: base, BCC_ENVIRONMENT: "local", NEXT_TELEMETRY_DISABLED: "1" };
  for (const name of ["BCC_API_MODE", "BCC_API_KEY", "BCC_SOC_API_KEY", "BCC_DEMO_ACTIONS_ENABLED"]) delete env[name];
  const build = spawnSync(process.execPath, [path.join(work, "node_modules/next/dist/bin/next"), "build", "--webpack"], { cwd: work, env, stdio: "inherit" });
  if (build.status !== 0) throw new Error("next build failed");
  if (!existsSync(path.join(work, "out/index.html"))) throw new Error("static export produced no index.html");
  await rm(out, { recursive: true, force: true });
  await cp(path.join(work, "out"), out, { recursive: true });
  await writeFile(path.join(out, ".nojekyll"), "");
  // A plain 404 page that sends visitors back to the demo instead of GitHub's default.
  if (!existsSync(path.join(out, "404.html"))) await cp(path.join(out, "index.html"), path.join(out, "404.html"));
  console.log(`Static demo written to ${out} (base path ${base || "/"})`);
} finally {
  await rm(work, { recursive: true, force: true });
}
