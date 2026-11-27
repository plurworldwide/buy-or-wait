// The "Buy or Wait?" logic behind /api/check. Every number comes from idealo; nothing is guessed.
import * as idealo from "./idealo.js";
import { parsePrice, GBP_TO_EUR } from "./parsePrice.js";

const OTHER_COUNTRIES = ["AT", "FR", "IT", "ES", "GB"];
const CACHE_MS = 10 * 60 * 1000;
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS) || 15000;
const cache = new Map(); // productRef -> { at, data }

const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => n.toFixed(2).replace(".", ","); // 199 -> "199,00"
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); // "28 Oct"

// Resolves to { ok, value } or { ok: false, error } — never throws, never waits longer than 15 s.
// Takes a function that starts the call; a quick failure gets one retry within the same 15 s.
function safe(start) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), CALL_TIMEOUT_MS); });
  const attempt = start().catch((e) => {
    if (/Limit Exceeded/i.test(e.message)) throw e; // retrying won't help and uses up more quota
    if (!process.env.QUIET) console.warn("idealo call failed, retrying:", e.message.slice(0, 200));
    return new Promise((r) => setTimeout(r, 1000)).then(start);
  });
  return Promise.race([attempt, timeout])
    .then((value) => ({ ok: true, value }), (error) => {
      if (!process.env.QUIET) console.warn("idealo call gave up:", error.message.slice(0, 200));
      return { ok: false, error: error.message };
    })
    .finally(() => clearTimeout(timer));
}

const toEUR = (priceStr) => {
  const n = parsePrice(priceStr);
  if (n == null) return null;
  return String(priceStr).includes("£") ? round2(n * GBP_TO_EUR) : n;
};

// idealo's first page of offers isn't the cheapest, so read up to 4 pages (20 offers).
const MAX_OFFER_PAGES = 4;
async function getOfferPages(api, ref) {
  const offers = [];
  let offset;
  for (let page = 0; page < MAX_OFFER_PAGES; page++) {
    const r = await api.getOffers(ref, "DE", offset);
    offers.push(...(r.offers ?? []));
    if (!(r.nextOffset > 0)) break; // idealo uses 0 or a negative number for "last page"
    offset = r.nextOffset;
  }
  return { offers };
}

// "api" can be swapped for a fake idealo in tests (scripts/stage4-test.js).
export async function checkProduct(ref, api = idealo) {
  const hit = cache.get(ref);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const dataNotes = [];

  // Steps 1–3 run at the same time to stay fast.
  const [historyRes, offersRes, detailsRes, ...abroadRes] = await Promise.all([
    safe(() => api.getPriceHistory(ref, "DE")),
    safe(() => getOfferPages(api, ref)),
    safe(() => api.callTool("get_product_details", { productRef: ref, country: "DE" })),
    ...OTHER_COUNTRIES.map((c) => safe(() => api.getPriceHistory(ref, c))),
    ...OTHER_COUNTRIES.map((c) => safe(() => api.callTool("get_product_details", { productRef: ref, country: c }))), // only for the link
  ]);
  const abroadLinks = abroadRes.splice(OTHER_COUNTRIES.length);

  // If idealo refused everything because of its usage limit, say so instead of showing an empty result.
  const all = [historyRes, offersRes, detailsRes, ...abroadRes, ...abroadLinks];
  if (all.every((r) => !r.ok)) {
    const limit = all.find((r) => /Limit Exceeded|Too Many Requests/i.test(r.error));
    throw new Error(limit ? limit.error : "idealo did not respond");
  }

  // Product info
  const d = detailsRes.ok ? detailsRes.value : {};
  const product = {
    name: d.name ?? "",
    variant: d.nameDelta ?? "",
    imageUrl: d.imageUrls?.[0] ?? "",
    idealoUrl: d.url ?? "",
  };
  if (!detailsRes.ok) dataNotes.push("Product details unavailable (idealo did not respond).");

  // Step 2: German shops, sorted by price in code, top 5
  let shopsDE = [];
  if (offersRes.ok) {
    shopsDE = (offersRes.value.offers ?? [])
      .map((o) => ({
        shop: o.shop?.name ?? "",
        price: parsePrice(o.price),
        shipping: parsePrice(o.minShippingCost),
        delivery: o.delivery?.deliveryText ?? "",
        url: o.relocatorUrl ?? "",
      }))
      .filter((o) => o.price != null)
      .sort((a, b) => a.price - b.price)
      .slice(0, 5);
  } else {
    dataNotes.push("Shop list unavailable (idealo did not respond).");
  }
  const best = shopsDE[0];
  // Step 1: 30-day history in Germany
  const trend = historyRes.ok ? historyRes.value.priceTrend : null;
  const stats = trend?.statistics;
  const historyToday = parsePrice(stats?.currentPrice);
  // Today's price C = the cheapest shop people can actually click. Falls back to idealo's history price if no shops came back.
  const C = best?.price ?? historyToday;
  if (best && historyToday != null && Math.abs(best.price - historyToday) >= 0.01) {
    dataNotes.push(`idealo's price history shows ${fmt(historyToday)} € today, but no shop currently offers that. The verdict uses the cheapest listed shop, ${fmt(best.price)} €.`);
  }
  const M = parsePrice(stats?.minPrice);
  const A = parsePrice(stats?.avgPrice);
  const history = (trend?.history ?? [])
    .map((p) => ({ date: p.dateTimeISO?.slice(0, 10) ?? "", price: parsePrice(p.price) }))
    .filter((p) => p.price != null);
  if (!historyRes.ok) dataNotes.push("Price history unavailable (idealo did not respond).");
  else if (!trend || M == null) dataNotes.push("Not enough price history");
  if (typeof trend?.dataSourceConfidence === "number" && trend.dataSourceConfidence < 0.7) dataNotes.push("Low confidence in idealo's price history for this product.");

  // Step 3: other countries, compared with Germany's current price
  const dePrice = C ?? null;
  const europe = [{ country: "DE", priceEUR: dePrice, diffVsDE: 0, available: dePrice != null, approx: false, url: product.idealoUrl }];
  OTHER_COUNTRIES.forEach((country, i) => {
    const r = abroadRes[i];
    const s = r.ok ? r.value.priceTrend?.statistics : null;
    const priceEUR = toEUR(s?.currentPrice);
    if (!r.ok) dataNotes.push(`${country}: idealo did not respond in time.`);
    europe.push({
      country,
      priceEUR,
      diffVsDE: priceEUR != null && dePrice ? round2(((priceEUR - dePrice) / dePrice) * 100) : null,
      available: priceEUR != null,
      noAnswer: !r.ok, // true = idealo timed out, false = really not sold there
      approx: country === "GB",
      url: abroadLinks[i].ok ? abroadLinks[i].value.url ?? "" : "",
    });
  });

  // Step 5: cheapest country, highlighted only if at least 5% below Germany
  const abroad = europe.filter((e) => e.country !== "DE" && e.available).sort((a, b) => a.priceEUR - b.priceEUR);
  const cheapest = abroad[0];
  const cheapestCountry = cheapest && dePrice && cheapest.priceEUR <= dePrice * 0.95 ? cheapest.country : "";

  // Steps 4 + 6: verdict, reason, tip
  const days = history.length || 30; // idealo usually returns 31 daily points; say what we actually have
  let verdict = "UNKNOWN", reason = "", tip = "";
  if (C != null && M != null) {
    if (C <= M * 1.02) {
      verdict = "BUY_NOW";
      reason = `${fmt(C)} € is at or near the lowest price in the last ${days} days.`;
    } else {
      verdict = "WAIT";
      const x = Math.round(((C - M) / M) * 100);
      reason = `${fmt(C)} € is ${x}% above the 30-day low of ${fmt(M)} € from ${fmtDate(stats.lowestPriceDate)}.`;
    }
    const n = history.filter((p) => p.price < C).length;
    tip = `Prices were lower than today on ${n} of the last ${days} days.`;
  }
  if (cheapestCountry) {
    tip = `Cheaper in ${cheapestCountry}: ${fmt(cheapest.priceEUR)} € (${cheapest.diffVsDE}%).`;
  }

  const data = {
    checkedAt: new Date().toISOString(),
    product,
    verdict,
    reason,
    tip,
    prices: {
      todayBest: best?.price ?? null,
      todayBestShop: best?.shop ?? "",
      todayBestUrl: best?.url ?? "",
      min30: M,
      avg30: A,
      aboveLow: C != null && M != null ? round2(C - M) : null,
      lowestDate: stats?.lowestPriceDate?.slice(0, 10) ?? "",
    },
    history,
    shopsDE,
    europe,
    cheapestCountry,
    dataNotes,
  };

  // Only cache complete answers, so a slow moment at idealo isn't remembered for 10 minutes.
  const complete = [historyRes, offersRes, detailsRes, ...abroadRes, ...abroadLinks].every((r) => r.ok);
  if (complete) cache.set(ref, { at: Date.now(), data });
  return data;
}

export async function searchDE(q, api = idealo) {
  const r = await safe(() => api.callTool("search_products", { query: q, country: "DE" }));
  if (!r.ok) throw new Error(r.error);
  const res = r.value;
  return (res.results ?? [])
    .filter((r) => r.itemType === "PRODUCT")
    .slice(0, 5)
    .map((r) => ({
      productRef: r.productRef,
      name: r.name ?? "",
      variant: r.nameDelta ?? "",
      price: parsePrice(r.price),
      imageUrl: r.imageUrl ?? "",
      url: r.url ?? "",
    }));
}
