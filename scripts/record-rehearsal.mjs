/** Run the release film or a second-browser acceptance pass on a disposable local stack. */
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const backend = path.join(root, "backend");
const frontend = path.resolve(process.env.RECORD_FRONTEND_DIR || path.join(root, "frontend"));
const children = [];
async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}
function start(executable, args, cwd, env) {
  const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: "inherit" });
  children.push(child);
  return child;
}
async function ready(child, url, check) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok && await check(res)) return;
    } catch { /* startup */ }
    await delay(350);
  }
  throw new Error(`Local rehearsal service failed to start at ${url}`);
}
const cleanup = () => { for (const child of children.reverse()) if (child.exitCode === null) child.kill(); };
process.once("SIGINT", () => { cleanup(); process.exit(130); });
process.once("SIGTERM", () => { cleanup(); process.exit(143); });

try {
  const args = process.argv.slice(2);
  if (!args.includes("--output")) throw new Error("Use --output <new directory> [--quick-check]");
  const apiPort = await freePort();
  let webPort = await freePort();
  while (webPort === apiPort) webPort = await freePort();
  const api = `http://127.0.0.1:${apiPort}`;
  const web = `http://127.0.0.1:${webPort}`;
  const owner = "00000000-0000-4000-8000-000000000001";
  const key = randomBytes(32).toString("hex");
  const capability = role => {
    const body = `${role}:${owner}:${Math.floor(Date.now() / 1000) + 1800}`;
    return body + ":" + createHmac("sha256", key).update(body).digest("hex");
  };
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(BCC_|NEXT_PUBLIC_BCC_)/i.test(name)));
  const env = { ...inherited, BCC_ENVIRONMENT: "demo", BCC_API_MODE: "live",
    BCC_API_URL: api,
    BCC_CIRCLE_WEB_LOGIN: "false", BCC_DEMO_ACTIONS_ENABLED: "true", BCC_ALLOW_DEMO_OVERRIDES: "true",
    BCC_INTEGRATIONS_ENABLED: "true", BCC_INTEGRATIONS_ENVIRONMENT: "local", BCC_INTEGRATIONS_TELEGRAM_MODE: "fake",
    BCC_INTEGRATIONS_TELEGRAM_TOKEN: "", BCC_INTEGRATIONS_TELEGRAM_ALLOWED_CHAT_IDS: "[]",
    BCC_INTEGRATIONS_GATEWAY_ENABLED: "true", BCC_INTEGRATIONS_SIGNING_KEY: key, BCC_SOC_CAPABILITY: capability("soc"),
    BCC_INTEGRATIONS_RATE_LIMIT_PER_MINUTE: "300", BCC_NORMAL_SENDER_ID: owner,
    BCC_SCAM_SENDER_ID: owner, BCC_HUB_SENDER_ID: owner, BCC_NORMAL_RECIPIENT_PHONE: "+77010000002",
    BCC_SCAM_RECIPIENT_PHONE: "+77010000003", BCC_HUB_RECIPIENT_PHONE: "+77010000004",
    BCC_COOLING_OFF_MINUTES: "15", OMP_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1",
    NEXT_TELEMETRY_DISABLED: "1", PYTHONUNBUFFERED: "1" };
  const venv = path.join(backend, ".venv");
  let python = path.join(venv, "bin", "python");
  if (process.platform === "win32") {
    // Launch the interpreter directly so cleanup also stops the listener on Windows.
    const cfg = await readFile(path.join(venv, "pyvenv.cfg"), "utf8");
    python = path.join(cfg.match(/^home\s*=\s*(.+)$/m)[1].trim(), "python.exe");
    env.PYTHONPATH = path.join(venv, "Lib", "site-packages");
  }
  const file = path.join(root, ".local-checks", "rehearsals", `release-${randomUUID()}.db`);
  const apiProcess = start(python, ["-m", "scripts.run_local_demo", "--port", String(apiPort),
    "--database", file, "--fresh", "--soc-demo"], backend, env);
  await ready(apiProcess, api + "/ready", async res => (await res.json()).status === "ready");
  const webProcess = start(process.execPath, [path.join(frontend, "node_modules/next/dist/bin/next"), "start",
    "--hostname", "127.0.0.1", "--port", String(webPort)], frontend, env);
  await ready(webProcess, web, async () => true);
  const recorder = start(process.execPath, [path.join(root, "scripts/record-demo.mjs"), "--url", web,
    "--allow-demo-writes", ...args], root, { ...inherited, RECORD_SIMULATOR_CAPABILITY: capability("simulator"),
    RECORD_FAKE_API: api, PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE || path.join(frontend, "node_modules/playwright-core") });
  process.exitCode = await new Promise((resolve, reject) => recorder.once("error", reject).once("exit", code => resolve(code ?? 1)));
} finally { cleanup(); }
