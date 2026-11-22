// Samudra - crypto AI agent built on the CoinMarketCap API.
// Node 18+ (uses global fetch). No frameworks, no build step.
//
//   CMC_API_KEY=... GEMINI_API_KEY=... node server.js
//
// CMC endpoints used:
//   /v1/cryptocurrency/quotes/latest        price, market cap, 24h change per symbol
//   /v1/cryptocurrency/listings/latest      top N by market cap
//   /v1/cryptocurrency/trending/gainers-losers  (falls back to listings sort on lower tiers)
//   /v1/cryptocurrency/trending/most-visited    (falls back likewise)
//   /v1/global-metrics/quotes/latest        total market cap + BTC dominance
//   /v1/tools/price-conversion              convert a coin amount to fiat (IDR, USD, ...)
// Free-text questions are answered by Gemini with the live CMC figures above as context.
import http from 'node:http';

const CMC = process.env.CMC_API_KEY;
const GEMINI = process.env.GEMINI_API_KEY || '';
const PORT = process.env.PORT || 3456;
const BASE = 'https://pro-api.coinmarketcap.com';

if (!CMC) { console.error('CMC_API_KEY is required'); process.exit(1); }

const SYMBOLS = {
  bitcoin:'BTC', btc:'BTC', ethereum:'ETH', eth:'ETH', solana:'SOL', sol:'SOL',
  dogecoin:'DOGE', doge:'DOGE', cardano:'ADA', ada:'ADA', ripple:'XRP', xrp:'XRP',
  binance:'BNB', bnb:'BNB', tron:'TRX', toncoin:'TON', ton:'TON', avalanche:'AVAX',
  chainlink:'LINK', polkadot:'DOT', litecoin:'LTC', shiba:'SHIB', pepe:'PEPE',
  tether:'USDT', usdc:'USDC', sui:'SUI', near:'NEAR', aptos:'APT', arbitrum:'ARB',
  optimism:'OP', render:'RENDER', injective:'INJ', bittensor:'TAO', kaspa:'KAS',
  monero:'XMR', stellar:'XLM', hedera:'HBAR', uniswap:'UNI', aave:'AAVE',
  bitcoincash:'BCH', bch:'BCH', cosmos:'ATOM', filecoin:'FIL', algorand:'ALGO'
};

async function cmc(path, params = {}) {
  const q = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}?${q}`, { headers: { 'X-CMC_PRO_API_KEY': CMC } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status?.error_code) {
    const e = new Error(`CMC ${path} -> ${res.status} ${body?.status?.error_message || ''}`);
    e.status = res.status; throw e;
  }
  return body.data;
}

const money = (n, cur='USD') => {
  if (n == null) return '?';
  const opts = { style:'currency', currency:cur, maximumFractionDigits: n>=1?2:6 };
  return new Intl.NumberFormat(cur==='IDR'?'id-ID':'en-US', opts).format(n);
};
const big = n => n>=1e12?(n/1e12).toFixed(2)+'T':n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n.toFixed(0);
const pct = n => (n>=0?'+':'')+n.toFixed(2)+'%';

function coinLine(sym, d, cur='USD') {
  const q = d.quote[cur] || d.quote.USD;
  return `${d.name} (${sym}): ${money(q.price,cur)} | 24h ${pct(q.percent_change_24h)} | market cap ${cur==='IDR'?'Rp':'$'}${big(q.market_cap)}`;
}

function detectCoins(text) {
  const found = new Set();
  const words = text.toLowerCase().replace(/[^a-z0-9$ ]/g,' ');
  for (const [k,v] of Object.entries(SYMBOLS)) {
    if (new RegExp(`\\b${k}\\b`).test(words)) found.add(v);
  }
  for (const m of text.matchAll(/\$([A-Za-z]{2,10})\b/g)) found.add(m[1].toUpperCase());
  return [...found];
}

async function answer(qRaw) {
  const q = qRaw.trim();
  const low = q.toLowerCase();
  const idr = /idr|rupiah|rp\b/.test(low);
  const coins = detectCoins(q);

  // 1) price conversion to fiat
  let m = low.match(/(?:berapa|how much|convert|konversi|nilai)?\s*(\d+(?:\.\d+)?)\s*([a-z$]{2,12})\s*(?:ke|to|in)\s*(idr|rupiah|usd|dollar)/);
  if (m) {
    const amt = parseFloat(m[1]); const sym = (SYMBOLS[m[2]]||m[2].replace('$','')).toUpperCase();
    const cur = /idr|rupiah/.test(m[3]) ? 'IDR' : 'USD';
    const d = await cmc('/v1/tools/price-conversion', { amount: amt, symbol: sym, convert: cur });
    return { text: `${amt} ${sym} saat ini sekitar ${money(d.quote[cur].price, cur)} menurut data live CoinMarketCap.`,
      endpoints:['/v1/tools/price-conversion'], facts:{ [sym]: d } };
  }
  // 2) global metrics
  if (/(market cap (global|total)|dominansi|dominance|total crypto)/.test(low)) {
    const d = await cmc('/v1/global-metrics/quotes/latest', {});
    const t = d.quote.USD;
    return { text: `Total market cap kripto sekarang sekitar $${big(t.total_market_cap)} (${pct(t.total_market_cap_yesterday_percentage_change)} vs kemarin). Dominasi Bitcoin ${d.btc_dominance.toFixed(1)}%, Ethereum ${d.eth_dominance.toFixed(1)}%. Volume 24 jam $${big(t.total_volume_24h)}.`,
      endpoints:['/v1/global-metrics/quotes/latest'], facts:d };
  }
  // 3) top N
  m = low.match(/top\s*(\d+)/) || low.match(/(\d+)\s*(?:koin|coin|teratas|terbesar)/);
  if (m || /top\s*(koin|coins?)|teratas|terbesar/.test(low)) {
    const n = Math.min(parseInt(m?.[1]||'5'), 20);
    const d = await cmc('/v1/cryptocurrency/listings/latest', { limit: n, convert: 'USD' });
    const lines = d.map((c,i)=>`${i+1}. ${coinLine(c.symbol, c)}`).join('\n');
    return { text:`Top ${n} kripto berdasarkan market cap (live dari CoinMarketCap):\n${lines}`,
      endpoints:['/v1/cryptocurrency/listings/latest'], facts:d };
  }
  // 4) trending / gainers
  if (/trending|gainers?|losers?|most visited|populer|lagi hot|paling naik|naik paling|turun paling/.test(low)) {
    try {
      const g = await cmc('/v1/cryptocurrency/trending/gainers-losers', { limit: 5 });
      const v = await cmc('/v1/cryptocurrency/trending/most-visited', { limit: 5 });
      const gl = g.gainers.map(c=>`${c.name} (${c.symbol}) ${pct(c.quote.USD.percent_change_24h)}`).join(', ');
      const vl = v.map((c,i)=>`${i+1}. ${c.name} (${c.symbol})`).join(', ');
      return { text:`Paling banyak dilihat di CoinMarketCap: ${vl}.\nTop gainers 24 jam: ${gl}.`,
        endpoints:['/v1/cryptocurrency/trending/gainers-losers','/v1/cryptocurrency/trending/most-visited'], facts:{gainers:g, visited:v} };
    } catch (e) { // lower plan tiers: compute from listings
      const d = await cmc('/v1/cryptocurrency/listings/latest', { limit: 100, sort:'percent_change_24h', sort_dir:'desc' });
      const gl = d.slice(0,5).map(c=>`${c.name} (${c.symbol}) ${pct(c.quote.USD.percent_change_24h)}`).join(', ');
      return { text:`Top gainers 24 jam di antara 100 teratas (dihitung dari listings CoinMarketCap): ${gl}.`,
        endpoints:['/v1/cryptocurrency/listings/latest'], facts:d.slice(0,5) };
    }
  }
  // 5) compare two coins
  if ((/vs|versus|banding|compare|mending/.test(low)) && coins.length >= 2) {
    const syms = coins.slice(0,2);
    const d = await cmc('/v1/cryptocurrency/quotes/latest', { symbol: syms.join(','), convert: 'USD' });
    const lines = syms.map(s=>coinLine(s, d[s][0]||d[s])).join('\n');
    return { text:`Perbandingan live dari CoinMarketCap:\n${lines}`,
      endpoints:['/v1/cryptocurrency/quotes/latest'], facts:d };
  }
  // 6) plain price question
  if (coins.length) {
    const cur = idr ? 'IDR' : 'USD';
    const d = await cmc('/v1/cryptocurrency/quotes/latest', { symbol: coins.join(','), convert: cur });
    const lines = coins.map(s=>{ const c = d[s]?.[0]||d[s]; return c?coinLine(s,c,cur):`${s}: tidak ditemukan`; }).join('\n');
    return { text: `Data live CoinMarketCap:\n${lines}`,
      endpoints:['/v1/cryptocurrency/quotes/latest'], facts:d };
  }
  // 7) free text: gather context then ask Gemini
  const facts = {};
  try { facts.global = await cmc('/v1/global-metrics/quotes/latest', {}); } catch {}
  try { facts.top5 = (await cmc('/v1/cryptocurrency/listings/latest', { limit: 5 }))
    .map(c=>({name:c.name,symbol:c.symbol,price_usd:c.quote.USD.price,pct24h:c.quote.USD.percent_change_24h})); } catch {}
  if (GEMINI) {
    const prompt = `You are Samudra, a concise crypto data assistant. Answer in the user's language (Indonesian by default) using ONLY these live CoinMarketCap figures; do not invent numbers. Question: ${q}\nLive data: ${JSON.stringify(facts).slice(0,3000)}`;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI}`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{ parts:[{ text: prompt }] }] })
    });
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return { text, endpoints:['/v1/global-metrics/quotes/latest','/v1/cryptocurrency/listings/latest'], facts };
  }
  return { text:'Coba tanya misalnya: "harga bitcoin", "5 doge ke rupiah", "top 10", "dominansi BTC", atau "bandingkan ETH vs SOL".',
    endpoints:[], facts:{} };
}

const PAGE = (await import('node:fs')).readFileSync(new URL('./public/index.html', import.meta.url));

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/ask' && (req.method === 'POST' || (req.method === 'GET' && u.searchParams.get('q')))) {
    let body=''; for await (const c of req) body+=c;
    try {
      const q = req.method === 'GET' ? u.searchParams.get('q') : JSON.parse(body||'{}').q;
      if (!q) throw new Error('empty question');
      const out = await answer(q);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ q, ...out, source:'CoinMarketCap API (live)' }));
    } catch (e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error:String(e.message||e) }));
    }
    return;
  }
  if (u.pathname === '/api/health') {
    try { const d = await cmc('/v1/global-metrics/quotes/latest', {}); res.end(JSON.stringify({ ok:true, btc_dom:d.btc_dominance })); }
    catch (e) { res.writeHead(500); res.end(JSON.stringify({ ok:false, error:String(e) })); }
    return;
  }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end(PAGE);
}).listen(PORT, () => console.log(`Samudra listening on http://localhost:${PORT}`));
