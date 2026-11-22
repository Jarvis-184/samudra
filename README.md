# Samudra - Indonesian-first Crypto AI Agent (CoinMarketCap API)

Samudra ("ocean" in Indonesian) is a conversational crypto agent built for the
**Build with CMC: API Hackathon, Round 2**. It answers questions about crypto
prices, market cap, dominance, conversions and trends in natural Indonesian,
using **live data from the CoinMarketCap API** for every number it reports.
Free-form questions are answered by an LLM that is grounded only in the live
CMC figures it was just given, so it cannot invent prices.

![live](https://img.shields.io/badge/data-live%20CoinMarketCap%20API-16c784)
![node](https://img.shields.io/badge/runtime-Node%2018%2B-3861fb)

## What it does

Ask in plain Indonesian (or English):

- "berapa harga bitcoin sekarang?" -> live price, 24h change, market cap
- "10 dogecoin ke rupiah" -> live fiat conversion (IDR/USD/...)
- "top 5 koin" -> top N by market cap
- "dominansi BTC" -> global metrics: total market cap, BTC/ETH dominance, 24h volume
- "bandingkan ETH vs SOL" -> side-by-side live comparison
- "koin apa yang lagi trending?" -> trending / top gainers (most-visited + gainers-losers, with a listings-based fallback for lower API tiers)
- anything else (e.g. "kenapa pasar kripto naik hari ini?") -> Gemini answers, grounded strictly in the live CMC figures above

Every answer shows which CMC endpoint supplied the numbers.

## CoinMarketCap endpoints used

| Endpoint | Used for |
|---|---|
| `/v1/cryptocurrency/quotes/latest` | price, 24h change, market cap per symbol; comparisons |
| `/v1/cryptocurrency/listings/latest` | top-N lists; gainers fallback |
| `/v1/cryptocurrency/trending/gainers-losers` | top gainers/losers |
| `/v1/cryptocurrency/trending/most-visited` | trending coins |
| `/v1/global-metrics/quotes/latest` | total market cap, BTC/ETH dominance, 24h volume |
| `/v1/tools/price-conversion` | coin amount -> IDR/USD conversions |

## Run it

Requires Node 18+ (no dependencies, no build step).

```bash
export CMC_API_KEY=your_coinmarketcap_api_key     # https://pro.coinmarketcap.com
export GEMINI_API_KEY=your_google_ai_studio_key    # optional, enables free-form Q&A
node server.js
# open http://localhost:3456
```

The web UI is a single page (dark "CMC blue" theme) with quick-prompt buttons,
a chat view and a per-answer source line. The same brain is available as JSON:

```bash
curl -X POST http://localhost:3456/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"q":"berapa harga bitcoin sekarang?"}'
```

## How it works

1. The question is classified by lightweight rules (conversion? global metrics?
   top-N? trending? comparison? plain price?).
2. The matching CoinMarketCap endpoints are called live; answers are composed
   directly from the returned numbers - no cached or hallucinated prices.
3. If no rule matches and a Gemini key is configured, the live CMC figures
   (global metrics + top-5) are passed to Gemini as the only allowed source of
   numbers, and its answer is returned in the user's language.

## Files

- `server.js` - API client, intent routing, answer composition, web server
- `public/index.html` - the chat UI

## Notes

- Not financial advice.
- Built by [@Jarvis-184](https://github.com/Jarvis-184) for the
  [Build with CMC: API Hackathon, Round 2](https://dorahacks.io/hackathon/coinmarketcap-api-202611).
