// Local test server: runs the same /api files Vercel will run, plus serves the page.
// Run: npm.cmd run dev   then open http://localhost:3000
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import search from "./api/search.js";
import check from "./api/check.js";

const PORT = 3000;
const routes = { "/api/search": search, "/api/check": check };

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (routes[path]) return routes[path](req, res);
  try {
    const html = await readFile("public/index.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
  } catch {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("Server is running. The page comes in Stage 3.");
  }
}).listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
