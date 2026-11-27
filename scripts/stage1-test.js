// Stage 1 check: connect to idealo, fetch raw data for one product, test parsePrice.
// Run: npm run stage1            (or: npm run stage1 -- "iPhone 16 128GB")
import { mkdirSync, writeFileSync } from "node:fs";
import { listTools, searchProducts, getOffers, getPriceHistory, close } from "../lib/idealo.js";
import { parsePrice, GBP_TO_EUR } from "../lib/parsePrice.js";

const query = process.argv[2] || "Sony WH-1000XM5";
const raw = {};
const line = (t) => console.log(`\n=== ${t} ===`);

try {
  line("1. Connecting to idealo");
  const tools = await listTools();
  console.log("Connected. Tools:", tools.map((t) => t.name).join(", "));

  line(`2. Searching "${query}" in DE`);
  raw.search = await searchProducts(query, "DE");
  const results = raw.search.results ?? raw.search.items ?? [];
  const products = results.filter((r) => r.itemType === "PRODUCT");
  console.log(`${results.length} results, ${products.length} are PRODUCT:`);
  for (const p of products.slice(0, 5)) {
    console.log(`  - ${p.name} | ${p.nameDelta ?? ""} | ${p.price} -> ${parsePrice(p.price)}`);
  }
  if (!products.length) throw new Error("No PRODUCT results. Try the exact model name.");
  const ref = products[0].productRef;

  line("3. Shop offers in DE (first page, sorted cheapest first by us)");
  raw.offers = await getOffers(ref, "DE");
  const offers = (raw.offers.offers ?? raw.offers.items ?? [])
    .map((o) => ({ shop: o.shop?.name, price: parsePrice(o.price), shipping: parsePrice(o.minShippingCost), delivery: o.delivery?.deliveryText }))
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  console.table(offers);

  line("4. 30-day price history in DE");
  raw.historyDE = await getPriceHistory(ref, "DE");
  const trend = raw.historyDE.priceTrend;
  if (!trend) console.log("priceTrend is null (not enough history)");
  else {
    const s = trend.statistics;
    console.log(`Today ${parsePrice(s.currentPrice)} €, 30-day low ${parsePrice(s.minPrice)} € on ${s.lowestPriceDate}, average ${parsePrice(s.avgPrice)} €, confidence ${trend.dataSourceConfidence}`);
    console.log(`${trend.history?.length ?? 0} daily points`);
  }

  line("5. Same product in GB (checks the productRef works abroad)");
  raw.historyGB = await getPriceHistory(ref, "GB");
  const gb = raw.historyGB.priceTrend?.statistics?.currentPrice;
  console.log(gb ? `GB today ${gb} -> about ${(parsePrice(gb) * GBP_TO_EUR).toFixed(2)} € (approx.)` : "Not available in GB");

  line("6. parsePrice self-test");
  for (const [input, want] of [["1.234,56 €", 1234.56], ["299,00 €", 299], ["£165.00", 165], ["£1,165.50", 1165.5]]) {
    const got = parsePrice(input);
    console.log(`${got === want ? "OK  " : "FAIL"} ${input} -> ${got}`);
  }
} catch (err) {
  console.error("\nERROR:", err.message);
  process.exitCode = 1;
} finally {
  mkdirSync("output", { recursive: true });
  writeFileSync("output/stage1-raw.json", JSON.stringify(raw, null, 2));
  console.log("\nFull raw data saved to output/stage1-raw.json");
  await close();
}
