// 시세 데이터 수집 (Nasdaq 종목 목록 · 실적 일정, Yahoo 차트 시세) + 메모리 캐시
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const cache = new Map();   // key -> { t, v }
const inflight = new Map(); // key -> Promise

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const v = await loader();
      cache.set(key, { t: Date.now(), v });
      return v;
    } catch (err) {
      if (hit) return hit.v; // 실패하면 오래된 값이라도 사용
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

async function getJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

const num = (v) => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const cleanName = (n) => String(n || '')
  .replace(/\s+(Class [A-Z] )?(Common Stock|Capital Stock|Ordinary Shares|American Depositary Shares?|Depositary Shares?|Common Shares|Units?)\b.*$/i, '')
  .replace(/\s+-\s*$/, '')
  .trim();

// ---------- 미국 상장 종목 목록 ----------
const EXCHANGES = { nasdaq: 'NASDAQ', nyse: 'NYSE', amex: 'NYSE American' };

function screener() {
  return cached('screener', 3 * 3600e3, async () => {
    const lists = await Promise.all(Object.keys(EXCHANGES).map(async (ex) => {
      const j = await getJson(`https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true&exchange=${ex}`, 30000);
      return (j?.data?.rows || []).map((r) => ({ r, ex: EXCHANGES[ex] }));
    }));
    const seen = new Set();
    const rows = [];
    for (const { r, ex } of lists.flat()) {
      const s = String(r.symbol || '').trim().replace('/', '.');
      if (!s || seen.has(s) || s.includes('^')) continue;
      seen.add(s);
      rows.push({
        s,
        n: cleanName(r.name),
        ex,
        sec: r.sector || '',
        ind: r.industry || '',
        mc: num(r.marketCap) || null,
        p: num(r.lastsale),
        chg: num(r.pctchange),
        vol: num(r.volume),
        ctry: r.country || '',
        ipo: r.ipoyear || '',
      });
    }
    rows.sort((a, b) => (b.mc || 0) - (a.mc || 0));
    return { updatedAt: new Date().toISOString(), rows };
  });
}

// ---------- Yahoo 시세 ----------
// 미국 티커의 점(BRK.B)은 Yahoo에서 하이픈(BRK-B)
const toYahoo = (s) => (/\.(KS|KQ|T|HK|L|TO)$/i.test(s) || s.includes('=') ? s : s.replace('.', '-'));

async function yahooChart(symbol, range, interval = '1d') {
  const ys = encodeURIComponent(toYahoo(symbol));
  const qs = `range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
  let j;
  try {
    j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${ys}?${qs}`);
  } catch {
    j = await getJson(`https://query2.finance.yahoo.com/v8/finance/chart/${ys}?${qs}`);
  }
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error('no data ' + symbol);
  return r;
}

const RANGES = new Set(['5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);

function history(symbol, range = '1y') {
  if (!RANGES.has(range)) range = '1y';
  return cached(`h:${symbol}:${range}`, 3 * 3600e3, async () => {
    const r = await yahooChart(symbol, range, ['5y', '10y', 'max'].includes(range) ? '1wk' : '1d');
    const ts = r.timestamp || [];
    const closes = r.indicators?.quote?.[0]?.close || [];
    const t = [], c = [];
    ts.forEach((sec, i) => {
      const v = closes[i];
      if (v == null || !Number.isFinite(v)) return;
      t.push(new Date((sec + (r.meta?.gmtoffset || 0)) * 1000).toISOString().slice(0, 10));
      c.push(+v.toFixed(4));
    });
    return { t, c, cur: r.meta?.currency || null };
  });
}

function quote(symbol) {
  return cached(`q:${symbol}`, 10 * 60e3, async () => {
    const r = await yahooChart(symbol, '5d');
    const m = r.meta || {};
    const closes = (r.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
    const p = m.regularMarketPrice ?? closes[closes.length - 1] ?? null;
    // 마지막 종가가 현재가와 같으면(오늘 봉) 그 전날 종가가 전일 종가
    const last = closes[closes.length - 1];
    const sameBar = last != null && p != null && Math.abs(last - p) / p < 1e-6;
    const prev = sameBar ? (closes[closes.length - 2] ?? m.chartPreviousClose ?? null) : (last ?? m.chartPreviousClose ?? null);
    return {
      p,
      prev,
      chg: p != null && prev ? ((p / prev - 1) * 100) : null,
      cur: m.currency || null,
      name: m.longName || m.shortName || symbol,
      ex: m.fullExchangeName || m.exchangeName || '',
      at: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    };
  });
}

async function quotes(symbols) {
  const list = await mapLimit(symbols, 8, (s) => quote(s));
  const out = {};
  symbols.forEach((s, i) => { if (list[i]) out[s] = list[i]; });
  return out;
}

async function histories(symbols, range) {
  const list = await mapLimit(symbols, 8, (s) => history(s, range));
  const out = {};
  symbols.forEach((s, i) => { if (list[i]) out[s] = list[i]; });
  return out;
}

// ---------- 실적 발표 일정 (월 단위) ----------
function earningsMonth(ym) {
  return cached(`e:${ym}`, 12 * 3600e3, async () => {
    const [y, m] = ym.split('-').map(Number);
    const days = [];
    for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      const wd = dt.getUTCDay();
      if (wd !== 0 && wd !== 6) days.push(dt.toISOString().slice(0, 10));
    }
    const res = await mapLimit(days, 4, async (date) => {
      const j = await getJson(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`);
      return (j?.data?.rows || []).map((r) => ({
        date,
        s: String(r.symbol || '').replace('/', '.'),
        n: cleanName(r.name),
        time: r.time === 'time-pre-market' ? 'BMO' : r.time === 'time-after-hours' ? 'AMC' : '',
        est: r.epsForecast || '',
        q: r.fiscalQuarterEnding || '',
        mc: num(r.marketCap),
      }));
    });
    return res.flat().filter(Boolean);
  });
}

module.exports = { screener, history, histories, quote, quotes, earningsMonth };
