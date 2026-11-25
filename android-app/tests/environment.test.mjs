import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("published client, SOC and platform use the Android ledger; jury is explicitly isolated", async()=>{
  const read=path=>readFile(new URL(path,import.meta.url),"utf8");
  const config=JSON.parse(await read("../../frontend/src/lib/connected-wallet.json"));
  assert.match(config.apiOrigin,/^https:\/\/[a-z0-9.-]+$/);
  for(const key of ["url","socUrl","platformUrl"]) assert.equal(new URL(config[key]).origin,config.apiOrigin);
  assert.notEqual(new URL(config.juryUrl).origin,config.apiOrigin);
  assert.match(await read("../android/app/build.gradle"),/configuredOrigin \?: ecosystem.apiOrigin/);
  assert.match(await read("../../frontend/src/app/soc/page.tsx"),/redirect\(wallets.socUrl\)/);
});
