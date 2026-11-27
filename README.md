# Buy or Wait?

**Should you buy now or wait, and is it cheaper elsewhere in Europe?**

A one-page website that finds today's best price for any product on [idealo](https://www.idealo.de) and answers two questions:

1. **Is today's price a good one?** It compares the cheapest shop with the last 30 days and gives a clear **BUY NOW** or **WAIT** verdict.
2. **Where in Europe is it cheapest?** It compares Germany with Austria, France, Italy, Spain and the UK.

Live demo: https://buy-or-wait-nine.vercel.app

## What you see

- Today's best price in Germany, with the shop and a buy link
- A BUY NOW or WAIT verdict with a one-sentence reason and a tip
- Today's best price, the 30-day low and the 30-day average
- A 30-day price chart with the low marked
- The 5 cheapest German shops: price, shipping, delivery
- A table of 6 countries in euros, with the difference vs Germany (UK prices converted at a fixed 1 £ = 1.17 €, approx.)

## How the verdict works

- **BUY NOW** if the cheapest shop today is within 2% of the 30-day low.
- **WAIT** otherwise, with how far above the low it is and on which date the low was.
- Another country is highlighted only if it's at least 5% cheaper than Germany.
- Every number comes from idealo. If data is missing or idealo is slow, the page shows what it has and says what's missing. It never guesses a price.

## How it's built

Kept as simple as possible: no framework, no build step, no database.

| Part | What it is |
|---|---|
| `public/index.html` | The whole page: plain HTML, CSS and JavaScript, plus [Chart.js](https://www.chartjs.org) |
| `api/search.js` | `GET /api/search?q=` returns up to 5 matching products |
| `api/check.js` | `GET /api/check?productRef=` returns the verdict, prices, history, shops and countries |
| `lib/check.js` | The verdict logic, caching (10 min) and timeouts (15 s per call) |
| `lib/idealo.js` | Connects to the [idealo MCP server](https://mcp.idealo.com/mcp) with the official MCP TypeScript SDK |
| `lib/parsePrice.js` | Turns `"1.234,56 €"` and `"£165.00"` into numbers |
| `SPEC.md` | The full product spec |

The backend runs as Vercel serverless functions (Node.js).

## Run it locally

You need [Node.js](https://nodejs.org) 20 or newer and an idealo account.

```bash
npm install
npm run login     # one-time: opens idealo's sign-in page in your browser
npm run dev       # then open http://localhost:3000
```

On Windows PowerShell, use `npm.cmd` instead of `npm` if scripts are blocked.

The login saves your credentials to `.env`, which is never committed.

## Tests

```bash
npm run stage1    # checks the live idealo connection and prints raw data
npm run stage4    # 24 edge-case tests against a fake idealo (no internet needed)
```

## Deploy to Vercel

1. `npx vercel login`
2. Add `IDEALO_CLIENT_ID` and `IDEALO_REFRESH_TOKEN` from your `.env` as Production environment variables (`npx vercel env add …`).
3. `npx vercel --prod`

If the site says the idealo login expired, run `npm run login` again and update `IDEALO_REFRESH_TOKEN` on Vercel.

## Limitations

- The idealo server only allows signed-in access, so the app runs on one person's idealo login, and heavy use can hit idealo's rate limits.
- Prices for other countries come from idealo's price history, not that country's live shop list.
- Not affiliated with idealo.
