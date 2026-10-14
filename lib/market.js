// 시세 데이터 수집 (Nasdaq 종목 목록 · 실적 일정, Yahoo 차트 시세) + 메모리 캐시
const nasdaq = require('./nasdaq');
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

// ---------- 기업 펀더멘털 (Yahoo quoteSummary · 쿠키+crumb 필요) ----------
let yAuth = null; // { cookie, crumb, t }

const PAGE_HEADERS = {
  'User-Agent': UA['User-Agent'],
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// 페이지를 열어 쿠키 수집 (리디렉션은 직접 따라가며 단계마다 쿠키 저장) · 마지막 페이지 본문 반환
async function collectCookies(url, jar) {
  let body = '';
  for (let hop = 0; hop < 4 && url; hop++) {
    const r = await fetch(url, { headers: { ...PAGE_HEADERS, Cookie: [...jar.values()].join('; ') }, redirect: 'manual' });
    for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
      const kv = c.split(';')[0];
      jar.set(kv.split('=')[0], kv);
    }
    const loc = r.headers.get('location');
    url = r.status >= 300 && r.status < 400 && loc ? new URL(loc, url).toString() : null;
    if (!url && r.ok) body = await r.text().catch(() => '');
  }
  return body;
}

// 페이지 HTML 안에 들어 있는 crumb 값 찾기
function crumbFromHtml(html) {
  const m = html.match(/"crumb"\s*:\s*"((?:[^"\\]|\\.){4,60})"/);
  if (!m) return null;
  try { return JSON.parse(`"${m[1]}"`); } catch { return null; }
}

const validCrumb = (c) => c && !c.includes('<') && c.length < 60;

// 쿠키와 crumb 확보. crumb을 끝내 못 받으면 crumb 없이(쿠키만) 진행
async function yahooAuth(force = false) {
  if (!force && yAuth && Date.now() - yAuth.t < (yAuth.crumb ? 3600e3 : 10 * 60e3)) return yAuth;
  const tried = [];
  const jar = new Map();
  for (const page of ['https://fc.yahoo.com/', 'https://finance.yahoo.com/quote/AAPL/', 'https://www.yahoo.com/']) {
    let html = '';
    try { html = await collectCookies(page, jar); } catch (e) { tried.push(`${page} ${e.message}`); continue; }
    const cookie = [...jar.values()].join('; ');
    const embedded = crumbFromHtml(html);
    if (validCrumb(embedded)) {
      yAuth = { cookie, crumb: embedded, t: Date.now(), how: 'page' };
      return yAuth;
    }
    for (const host of ['query1', 'query2']) {
      try {
        const cr = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, { headers: { 'User-Agent': UA['User-Agent'], Accept: '*/*', Cookie: cookie } });
        const crumb = (await cr.text()).trim();
        if (cr.ok && validCrumb(crumb)) {
          yAuth = { cookie, crumb, t: Date.now(), how: host };
          return yAuth;
        }
        tried.push(`${host}:${cr.status}`);
      } catch (e) { tried.push(`${host} ${e.message}`); }
    }
  }
  yAuth = { cookie: [...jar.values()].join('; '), crumb: null, t: Date.now(), how: 'none', tried: tried.join(',') };
  return yAuth;
}

async function quoteSummary(symbol, modules) {
  const ys = encodeURIComponent(toYahoo(symbol));
  const errors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await yahooAuth(attempt > 0);
    // crumb이 있으면 crumb과 함께, 없으면 쿠키만으로 두 서버에 시도
    const urls = a.crumb
      ? [`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ys}?modules=${modules}&crumb=${encodeURIComponent(a.crumb)}`]
      : [`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ys}?modules=${modules}`, `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ys}?modules=${modules}`];
    for (const url of urls) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA['User-Agent'], Cookie: a.cookie, Accept: 'application/json' }, signal: ctrl.signal });
        if (!res.ok) { errors.push(`${a.how}:${res.status}`); continue; }
        const j = await res.json();
        const q = j?.quoteSummary?.result?.[0];
        if (q) return q;
        errors.push(`${a.how}:empty`);
      } catch (e) {
        errors.push(`${a.how}:${e.message}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new Error(`yahoo (${errors.join(', ')}${yAuth?.tried ? '; crumb ' + yAuth.tried : ''})`);
}

const rv = (o) => (o && typeof o === 'object' ? (o.raw ?? null) : (Number.isFinite(o) ? o : null));
const ymd = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : null);

function insiderSummary(list) {
  const since = Date.now() / 1000 - 182 * 86400;
  const out = { buyN: 0, buyV: 0, sellN: 0, sellV: 0 };
  for (const t of list || []) {
    if ((rv(t.startDate) || 0) < since) continue;
    const text = String(t.transactionText || '');
    const val = rv(t.value) || 0;
    if (/purchase|buy/i.test(text)) { out.buyN++; out.buyV += val; } else if (/sale|sell/i.test(text)) { out.sellN++; out.sellV += val; }
  }
  return out;
}

function compact(q) {
  const sd = q.summaryDetail || {}, ks = q.defaultKeyStatistics || {}, fd = q.financialData || {}, pr = q.price || {};
  const ce = q.calendarEvents || {}, hb = q.majorHoldersBreakdown || {};
  const ins = insiderSummary(q.insiderTransactions?.transactions);
  return {
    name: pr.longName || pr.shortName || null,
    cur: pr.currency || null,
    price: rv(fd.currentPrice) ?? rv(pr.regularMarketPrice),
    mc: rv(pr.marketCap) ?? rv(sd.marketCap),
    pe: rv(sd.trailingPE), fpe: rv(sd.forwardPE) ?? rv(ks.forwardPE), pb: rv(ks.priceToBook),
    ps: rv(sd.priceToSalesTrailing12Months), evEbitda: rv(ks.enterpriseToEbitda), peg: rv(ks.pegRatio),
    div: rv(sd.dividendYield), beta: rv(sd.beta), hi52: rv(sd.fiftyTwoWeekHigh), lo52: rv(sd.fiftyTwoWeekLow),
    rev: rv(fd.totalRevenue), revG: rv(fd.revenueGrowth), earnG: rv(fd.earningsGrowth),
    gm: rv(fd.grossMargins), om: rv(fd.operatingMargins), nm: rv(fd.profitMargins), roe: rv(fd.returnOnEquity),
    de: rv(fd.debtToEquity), fcf: rv(fd.freeCashflow), cash: rv(fd.totalCash), debt: rv(fd.totalDebt),
    tgt: rv(fd.targetMeanPrice), tgtHi: rv(fd.targetHighPrice), tgtLo: rv(fd.targetLowPrice),
    nAnalyst: rv(fd.numberOfAnalystOpinions), rec: rv(fd.recommendationMean), recKey: fd.recommendationKey || null,
    nextEarn: ymd(rv(ce.earnings?.earningsDate?.[0])), epsEst: rv(ce.earnings?.earningsAverage),
    insiderPct: rv(hb.insidersPercentHeld) ?? rv(ks.heldPercentInsiders),
    instPct: rv(hb.institutionsPercentHeld) ?? rv(ks.heldPercentInstitutions),
    ins6m: ins,
  };
}

const BASIC_MODULES = 'price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,insiderTransactions,majorHoldersBreakdown';

// Yahoo가 이 서버를 막으면(클라우드 IP 등) 한동안 Nasdaq 자료로 바로 넘어감
let yahooDownUntil = process.env.FORCE_NASDAQ === '1' ? Infinity : 0;

async function withFallback(symbol, yahooFn, nasdaqFn) {
  if (Date.now() >= yahooDownUntil) {
    try {
      return await yahooFn();
    } catch (err) {
      if (/^yahoo/.test(err.message) && /401|403|429|crumb/.test(err.message)) {
        yahooDownUntil = Date.now() + 30 * 60e3;
        console.warn('Yahoo 재무 자료 차단 → Nasdaq 대체 사용:', err.message);
      } else if (!/^yahoo/.test(err.message)) throw err;
    }
  }
  let price = null;
  try { price = (await quote(symbol)).p; } catch { /* 가격 없이 */ }
  const r = await nasdaqFn(symbol, price);
  if (!r) throw new Error('no fundamentals');
  return r;
}

function fundamentals(symbol) {
  return cached(`f:${symbol}`, 12 * 3600e3, () => withFallback(symbol,
    async () => compact(await quoteSummary(symbol, BASIC_MODULES)), nasdaq.fundamentals));
}

async function fundamentalsMany(symbols) {
  const list = await mapLimit(symbols, 6, (s) => fundamentals(s));
  const out = {};
  symbols.forEach((s, i) => { if (list[i]) out[s] = list[i]; });
  return out;
}

function profile(symbol) {
  return cached(`p:${symbol}`, 12 * 3600e3, () => withFallback(symbol, () => yahooProfile(symbol), nasdaq.profile));
}

async function yahooProfile(symbol) {
  {
    const q = await quoteSummary(symbol, `${BASIC_MODULES},assetProfile,recommendationTrend,earningsHistory,earnings,earningsTrend`);
    const ap = q.assetProfile || {};
    const fc = q.earnings?.financialsChart || {};
    // 다음 분기·연도 컨센서스 (실적 대비 차트용)
    const est = {};
    for (const t of q.earningsTrend?.trend || []) {
      const k = { '0q': 'q0', '+1q': 'q1', '0y': 'y0', '+1y': 'y1' }[t.period];
      if (k) est[k] = { end: t.endDate, eps: rv(t.earningsEstimate?.avg), epsYA: rv(t.earningsEstimate?.yearAgoEps), rev: rv(t.revenueEstimate?.avg), revYA: rv(t.revenueEstimate?.yearAgoRevenue) };
    }
    const qeps = (q.earnings?.earningsChart?.quarterly || []).map((x) => ({
      p: x.date, end: ymd(rv(x.periodEndDate)), act: rv(x.actual), est: rv(x.estimate), rep: ymd(rv(x.reportedDate)),
    }));
    return {
      ...compact(q),
      est,
      qeps,
      summary: ap.longBusinessSummary || '',
      sector: ap.sector || '', industry: ap.industry || '', website: ap.website || '',
      employees: ap.fullTimeEmployees || null, country: ap.country || '',
      recTrend: (q.recommendationTrend?.trend || [])[0] || null,
      epsHist: (q.earningsHistory?.history || []).map((h) => ({
        q: ymd(rv(h.quarter)), act: rv(h.epsActual), est: rv(h.epsEstimate), surprise: rv(h.surprisePercent),
      })),
      quarterly: (fc.quarterly || []).map((x) => ({ p: x.date, rev: rv(x.revenue), earn: rv(x.earnings) })),
      yearly: (fc.yearly || []).map((x) => ({ p: String(x.date), rev: rv(x.revenue), earn: rv(x.earnings) })),
      insiders: (q.insiderTransactions?.transactions || []).slice(0, 15).map((t) => ({
        date: ymd(rv(t.startDate)), name: t.filerName || '', rel: t.filerRelation || '', text: t.transactionText || '',
        shares: rv(t.shares), value: rv(t.value),
      })),
    };
  }
}

module.exports = { screener, history, histories, quote, quotes, earningsMonth, fundamentalsMany, profile, mapLimit, yahooChart, quoteSummary };
