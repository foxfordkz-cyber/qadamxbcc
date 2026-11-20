import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("www");
const port = Number(process.env.QADAM_PREVIEW_PORT ?? 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const developer = pathname.startsWith("/dev/");
      const directory = developer ? path.resolve("dev") : root;
      const entry = developer ? pathname.slice(4) : pathname;
      const file = path.resolve(
        directory,
        `.${entry === "/" ? "/index.html" : entry}`,
      );
      if (!file.startsWith(directory + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res
        .writeHead(200, {
          "Content-Type":
            types[path.extname(file)] ?? "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log("Android asset preview: http://127.0.0.1:" + port),
  );
