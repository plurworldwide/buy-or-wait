// Stage 4 check: runs the /api/check logic against a FAKE idealo to test every edge case.
// No internet needed. Run: npm.cmd run stage4
process.env.QUIET = "1";
process.env.CALL_TIMEOUT_MS = "800"; // pretend "slow" = longer than 0.8 s
const { checkProduct, searchDE } = await import("../lib/check.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hist = (current, min, avg, conf = 0.95, cur = "€") => {
  const f = (n) => (cur === "£" ? `£${n.toFixed(2)}` : `${n.toFixed(2).replace(".", ",")} €`);
  return {
    priceTrend: {
      dataSourceConfidence: conf,
      statistics: { currentPrice: f(current), minPrice: f(min), avgPrice: f(avg), lowestPriceDate: "2026-11-10T22:59:59.999Z" },
      history: [min, avg, current].map((p, i) => ({ dateTimeISO: `2026-11-0${i + 1}T22:59:59.999Z`, price: f(p) })),
    },
  };
};
const offers = { nextOffset: 0, offers: [
  { shop: { name: "B-Shop" }, price: "105,00 €", minShippingCost: "4,99 €", delivery: { deliveryText: "2 days" }, relocatorUrl: "https://x/b" },
  { shop: { name: "A-Shop" }, price: "100,00 €", minShippingCost: "0,00 €", delivery: { deliveryText: "1 day" }, relocatorUrl: "https://x/a" },
] };

// Builds a fake idealo. "overrides" changes answers per country; "down" = everything fails; "slow" = countries that hang.
function fake({ overrides = {}, down = false, slow = [], search = [] } = {}) {
  const maybe = async (country, value) => {
    if (down) throw new Error("Service Unavailable");
    if (slow.includes(country)) await sleep(3000);
    return value;
  };
  return {
    getPriceHistory: (ref, c) => maybe(c, c in overrides ? overrides[c] : hist(100, 99, 102)),
    getOffers: () => maybe("DE", offers),
    callTool: (name, args) =>
      name === "search_products"
        ? maybe("DE", { results: search })
        : maybe(args.country, { name: "Test Product", nameDelta: "Black", imageUrls: [], url: `https://idealo.${args.country}/p` }),
  };
}

let pass = 0, fail = 0;
const expect = (label, ok) => { console.log(`${ok ? "OK  " : "FAIL"} ${label}`); ok ? pass++ : fail++; };
let n = 0;
const run = (api) => checkProduct(`test-${++n}`, api);

console.log("\n1. Normal product, near the 30-day low");
let r = await run(fake());
expect("verdict BUY_NOW (100 is within 2% of 99)", r.verdict === "BUY_NOW");
expect("shops sorted cheapest first (A-Shop 100)", r.shopsDE[0].shop === "A-Shop" && r.prices.todayBest === 100);
expect("no data notes", r.dataNotes.length === 0);

console.log("\n2. Price well above the low → WAIT");
r = await run(fake({ overrides: { DE: hist(100, 80, 90) } }));
expect("verdict WAIT", r.verdict === "WAIT");
expect(`reason: "${r.reason}"`, r.reason === "100,00 € is 25% above the 30-day low of 80,00 € from 10 Nov.");

console.log("\n3. priceTrend is null");
r = await run(fake({ overrides: { DE: { priceTrend: null } } }));
expect("verdict UNKNOWN", r.verdict === "UNKNOWN");
expect("note 'Not enough price history'", r.dataNotes.includes("Not enough price history"));
expect("best price + shops still shown", r.prices.todayBest === 100 && r.shopsDE.length === 2);

console.log("\n4. Low confidence (0.5)");
r = await run(fake({ overrides: { DE: hist(100, 98, 102, 0.5) } }));
expect("'Low confidence' note", r.dataNotes.some((t) => t.startsWith("Low confidence")));

console.log("\n5. Not sold in Spain");
r = await run(fake({ overrides: { ES: { priceTrend: null } } }));
const es = r.europe.find((e) => e.country === "ES");
expect("ES available: false, not a timeout", es.available === false && es.noAnswer === false);

console.log("\n6. Cheaper abroad: GB £70 ≈ 81,90 € (approx.)");
r = await run(fake({ overrides: { GB: hist(70, 70, 70, 0.95, "£") } }));
expect("cheapestCountry GB", r.cheapestCountry === "GB");
expect(`tip: "${r.tip}"`, r.tip === "Cheaper in GB: 81,90 € (-18.1%).");

console.log("\n7. Only 3% cheaper abroad → not highlighted");
r = await run(fake({ overrides: { AT: hist(97, 97, 97) } }));
expect("no cheapestCountry", r.cheapestCountry === "");

console.log("\n8. idealo slow in France and Italy");
r = await run(fake({ slow: ["FR", "IT"] }));
const fr = r.europe.find((e) => e.country === "FR");
expect("FR marked as no answer", fr.available === false && fr.noAnswer === true);
expect("rest of the answer still there", r.verdict === "BUY_NOW" && r.shopsDE.length === 2);
expect("notes mention FR and IT", r.dataNotes.some((t) => t.startsWith("FR")) && r.dataNotes.some((t) => t.startsWith("IT")));

console.log("\n9. idealo completely down");
r = await run(fake({ down: true }));
expect("answer still returned, verdict UNKNOWN", r.verdict === "UNKNOWN");
expect("no invented prices", r.prices.todayBest === null && r.europe.every((e) => e.priceEUR === null));
expect("notes explain it", r.dataNotes.length >= 3);

console.log("\n10. Search: no PRODUCT results");
const s = await searchDE("zzz", fake({ search: [{ itemType: "SINGLE_OFFER", name: "x" }] }));
expect("SINGLE_OFFER hidden, empty list", s.length === 0);

console.log("\n11. History says 90 € today, but cheapest shop is 100 €");
r = await run(fake({ overrides: { DE: hist(90, 90, 95) } }));
expect("verdict uses shop price → WAIT", r.verdict === "WAIT");
expect(`reason: "${r.reason}"`, r.reason === "100,00 € is 11% above the 30-day low of 90,00 € from 10 Nov.");
expect("note explains the gap", r.dataNotes.some((t) => t.includes("no shop currently offers")));
expect("Germany row in Europe table = 100 €", r.europe[0].priceEUR === 100);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
