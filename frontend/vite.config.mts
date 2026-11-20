import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";

// An ordinary local Next.js session can contain credentials for another backend.
// Cloudflare previews use .dev.vars and production uses Worker secrets.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";

export default defineConfig({
  // vinext's RSC handler imports ./ssr/index.js at runtime. Preserve that name
  // for this Next.js package, which otherwise receives a .mjs SSR entry from Vite.
  environments: { ssr: { build: { rolldownOptions: { output: { entryFileNames: "[name].js" } } } } },
  plugins: [
    vinext(),
    cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } }),
  ],
});
