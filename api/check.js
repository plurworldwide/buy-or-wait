// GET /api/check?productRef=...  -> verdict, prices, history, shops, Europe comparison
import { checkProduct } from "../lib/check.js";

export default async function handler(req, res) {
  const ref = new URL(req.url, "http://x").searchParams.get("productRef")?.trim();
  if (!ref) return send(res, 400, { error: "Missing ?productRef=" });
  try {
    send(res, 200, await checkProduct(ref));
  } catch (err) {
    const limited = /Limit Exceeded|Too Many Requests/i.test(err.message);
    send(res, limited ? 429 : 502, {
      error: limited
        ? "So many prices checked today that we need a short break. Please try again in an hour or so."
        : "Prices are taking longer than usual to load. Please try again in a moment.",
      detail: err.message,
    });
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}
