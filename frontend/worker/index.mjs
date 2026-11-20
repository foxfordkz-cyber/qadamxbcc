import handler from "vinext/server/fetch-handler";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export default {
  async fetch(request, env, ctx) {
    if (env.BCC_EDGE_SUBMISSION_LIMITS === "true" && request.method === "POST"
      && /^\/api\/v1\/(?:transfers\/evaluate|returns\/[0-9a-f-]{36})\/?$/i.test(new URL(request.url).pathname)) {
      const address = request.headers.get("cf-connecting-ip") || "";
      const key = env.BCC_DEMO_UPSTREAM_API_KEY || env.BCC_API_KEY;
      if (!key) return Response.json({ error: "apiError" }, { status: 503 });
      const source = createHmac("sha256", key).update("saqbol/transfer-source/v1/")
        .update(isIP(address) ? address.toLowerCase() : "unattributed").digest("hex");
      const incoming = new Request(request);
      incoming.headers.set("x-bcc-submission-source", source);
      return handler.fetch(incoming, env, ctx);
    }
    if (request.headers.has("x-bcc-submission-source")) {
      const cleaned = new Request(request);
      cleaned.headers.delete("x-bcc-submission-source");
      return handler.fetch(cleaned, env, ctx);
    }
    return handler.fetch(request, env, ctx);
  },
};
