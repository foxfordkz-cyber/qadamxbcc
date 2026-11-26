import { readFile } from "node:fs/promises";
const urls = JSON.parse(await readFile(new URL("../frontend/src/lib/connected-wallet.json", import.meta.url), "utf8"));
await Promise.all([[urls.apiOrigin, urls.readiness.team], [urls.juryUrl, urls.readiness.jury]].map(async ([origin, probe]) => {
  const target = new URL(probe.url, origin);
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    try {
      const result = await fetch(target, {cache:"no-store", redirect:"error", signal:AbortSignal.timeout(Math.max(1, Math.min(15000, end - Date.now())))});
      const body = result.ok ? await result.json() : {};
      if (body.status === probe.status && (!probe.mode || body.mode === probe.mode)) { console.log(target.host + " ready"); return; }
    } catch { /* Retry the read within the shared deadline. */ }
    await new Promise(resolve => setTimeout(resolve, Math.min(4000, Math.max(0, end - Date.now()))));
  }
  console.error(target.host + " unavailable"); process.exitCode = 1;
}));
