// GET /api/search?q=...  -> up to 5 PRODUCT results from idealo Germany
import { searchDE } from "../lib/check.js";

export default async function handler(req, res) {
  const q = new URL(req.url, "http://x").searchParams.get("q")?.trim();
  if (!q) return send(res, 400, { error: "Missing ?q=" });
  try {
    const results = await searchDE(q);
    if (!results.length) return send(res, 200, { results, message: "No match found. Try the exact model name." });
    send(res, 200, { results });
  } catch (err) {
    const limited = /Limit Exceeded|Too Many Requests/i.test(err.message);
    send(res, limited ? 429 : 502, {
      error: limited
        ? "We've hit our price data limit for now. Please try again later."
        : "Our price data source isn't responding right now. Please try again.",
      detail: err.message,
    });
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
