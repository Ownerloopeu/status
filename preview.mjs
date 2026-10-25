// Shows the built page on this laptop: node preview.mjs, then open http://localhost:4400
// (build it first: node build.mjs --sample up).
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(import.meta.dirname, "site");
const types = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".png": "image/png" };

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, "http://localhost").pathname)).replace(/^[/\\]+/, "") || "index.html";
  try {
    const body = await readFile(join(root, path.includes("..") ? "index.html" : path));
    response.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(Number(process.env.PORT ?? 4400), () => console.log("Status page on http://localhost:4400"));
