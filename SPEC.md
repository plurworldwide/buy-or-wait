# Buy or Wait? — SPEC

## What it is
A one-page website that finds the best price for any product and answers two questions: "Is today's best price a good one, or should I wait?" and "Where in Europe is it cheapest?"

## User flow
1. Search: one input "What are you about to buy?" + button "Find best price". Under it, 3 example chips: "Sony WH-1000XM5", "iPhone 16 128GB", "Dyson V15".
2. Pick: show up to 5 product cards (image, name, variant, current lowest price). Hide results with itemType SINGLE_OFFER. If there is only one PRODUCT result, skip this step.
3. Working: show live progress steps: "Found product on idealo" → "Checked shops" → "Read 30-day price history" → "Compared 6 countries".
4. Result page, top to bottom:
   - Best price today: big number, shop name, link
   - Verdict banner: BUY NOW (green) or WAIT (amber) + one-sentence reason + one tip line
   - Three numbers: today's best, 30-day low, 30-day average
   - 30-day line chart (Chart.js) with the 30-day low marked
   - Top 5 shops in Germany, sorted by price: shop, price, shipping, delivery, link
   - "Cheaper elsewhere in Europe?" table: country, best price in EUR, difference vs Germany in %, link. Note under it: "Check shipping to Germany, warranty and plug type."
   - Button "Check another product"
Style: clean, high contrast, mobile-first. No login. English UI.

## Data: idealo MCP
Server: https://mcp.idealo.com/mcp (streamable HTTP). Connect from the backend as an MCP client using the official MCP TypeScript SDK. Every tool takes country: DE, AT, GB, FR, IT, ES (default DE).
- search_products(query, country, filters?) → results with productRef, itemType, name, nameDelta (variant), price, imageUrl, url
- get_product_offers(productRef, country, offset?) → 5 offers per page: shop.name, price, minShippingCost, delivery.deliveryText, relocatorUrl (buy link), nextOffset (0 = last page). The first page is NOT sorted cheapest-first.
- get_product_price_history(productRef, country) → priceTrend.history (daily points: dateTimeISO, price) and priceTrend.statistics (currentPrice, minPrice, maxPrice, avgPrice, lowestPriceDate, dataSourceConfidence). priceTrend can be null.
Important facts:
- The SAME productRef works in every country.
- Prices are formatted strings: "1.234,56 €" (DE/AT/FR/IT/ES) or "£165.00" (GB). Write one parsePrice() helper for both.
- Convert GB to EUR at a fixed rate of 1.17, labelled "approx." on the page.

## Backend (Vercel serverless functions, Node.js)
- GET /api/search?q= → search_products(q, "DE"), return only PRODUCT items (max 5)
- GET /api/check?productRef= → runs the logic below, returns the JSON below
- Cache /api/check results in memory for 10 minutes per productRef
- Timeout 15 s per idealo call; return partial results with a note instead of failing

## Logic for /api/check
1. get_product_price_history(ref, "DE") → M = minPrice, A = avgPrice, lowestPriceDate, daily history
2. get_product_offers(ref, "DE") → up to 4 pages, sort by price in code, keep top 5. C = cheapest shop price (decided 27 Nov 2026: history currentPrice can show offers no shop lists). If no shops come back, C = history currentPrice. If the two differ, add a note.
3. In parallel: get_product_price_history(ref, c) for AT, FR, IT, ES, GB → each country's currentPrice in EUR
4. Verdict: BUY NOW if C <= M * 1.02, otherwise WAIT
5. cheapestCountry = country with the lowest EUR price. Highlight it only if it is at least 5% below Germany.
6. Reason and tip are built from templates in code (no AI API):
   - BUY NOW reason: "{C} € is at or near the lowest price in the last 30 days."
   - WAIT reason: "{C} € is {x}% above the 30-day low of {M} € from {date}."
   - Tip: "Prices were lower than today on {n} of the last 30 days." If another country is at least 5% cheaper, use instead: "Cheaper in {country}: {price} € ({diff}%)."

## /api/check response
{
  "product": { "name": "", "variant": "", "imageUrl": "", "idealoUrl": "" },
  "verdict": "BUY_NOW | WAIT | UNKNOWN",
  "reason": "", "tip": "",
  "prices": { "todayBest": 0, "todayBestShop": "", "todayBestUrl": "", "min30": 0, "avg30": 0, "lowestDate": "" },
  "history": [ { "date": "", "price": 0 } ],
  "shopsDE": [ { "shop": "", "price": 0, "shipping": 0, "delivery": "", "url": "" } ],
  "europe": [ { "country": "", "priceEUR": 0, "diffVsDE": 0, "available": true } ],
  "cheapestCountry": "",
  "dataNotes": []
}

## Edge cases
- No search results → "No match on idealo. Try the exact model name."
- priceTrend is null → verdict UNKNOWN, show best price + shop table, note "Not enough price history"
- dataSourceConfidence < 0.7 → add "Low confidence" to dataNotes
- Product not sold in a country → available: false, row shows "Not available"
- idealo slow/down → partial results + note

## Rules
- Never invent a price. Every number on screen comes from idealo.
- No API keys or paid services in this version.
- Build in 4 stages and stop after each so I can test: 1) MCP connection + raw data, 2) /api/check logic, 3) the page, 4) edge cases and polish.
