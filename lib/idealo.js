// Talks to the idealo MCP server. One connection per call keeps serverless functions simple.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getAccessToken } from "./auth.js";

const SERVER_URL = "https://mcp.idealo.com/mcp";
const TIMEOUT_MS = 15000;

let clientPromise = null;

let connectedAt = 0;
const RECONNECT_AFTER_MS = 45 * 60 * 1000; // login tokens last about an hour

async function getClient() {
  if (clientPromise && Date.now() - connectedAt > RECONNECT_AFTER_MS) {
    const old = clientPromise;
    clientPromise = null;
    old.then((c) => c.close()).catch(() => {});
  }
  if (!clientPromise) {
    connectedAt = Date.now();
    clientPromise = (async () => {
      const client = new Client({ name: "buy-or-wait", version: "0.1.0" });
      const token = await getAccessToken();
      await client.connect(
        new StreamableHTTPClientTransport(new URL(SERVER_URL), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        })
      );
      return client;
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

export async function listTools() {
  const client = await getClient();
  return (await client.listTools()).tools;
}

// idealo allows only a few requests at once: run at most 4 together, queue the rest.
const MAX_PARALLEL = 4;
let running = 0;
const queue = [];
async function limited(fn) {
  if (running >= MAX_PARALLEL) await new Promise((r) => queue.push(r));
  running++;
  try { return await fn(); } finally { running--; queue.shift()?.(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Calls one idealo tool and returns its result as a JS object.
// If idealo says "Too Many Requests", waits and tries again (up to 3 tries).
export async function callTool(name, args) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await limited(() => callOnce(name, args));
    } catch (err) {
      if (attempt >= 3 || !/Too Many Requests/i.test(err.message)) throw err;
      await sleep(800 * attempt);
    }
  }
}

async function callOnce(name, args) {
  const client = await getClient();
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: TIMEOUT_MS });
  if (result.isError) {
    const msg = result.content?.map((c) => c.text).join(" ") || "unknown error";
    throw new Error(`idealo ${name} failed: ${msg}`);
  }
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text };
  }
}

export async function close() {
  if (clientPromise) {
    const client = await clientPromise;
    await client.close();
    clientPromise = null;
  }
}

export const searchProducts = (query, country = "DE") => callTool("search_products", { query, country });
export const getOffers = (productRef, country = "DE", offset) =>
  callTool("get_product_offers", offset ? { productRef, country, offset } : { productRef, country });
export const getPriceHistory = (productRef, country = "DE") =>
  callTool("get_product_price_history", { productRef, country });
