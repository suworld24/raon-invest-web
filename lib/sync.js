// 시장 자료 수집 작업
// - tech: 2년 일봉으로 수익률·RSI·이동평균·주봉 정배열·52주 고저·거래량·월말/주말 종가
// - fund: 컨센서스(올해·내년·분기 EPS/매출과 30~90일 전 EPS), 밸류에이션, 재무, 실적일, 내부자 매매
// 결과는 store(market_kv)에 저장하고, 관심·보유 종목은 전망·일정·실적 변화를 change_log에 남긴다.
const store = require('./store');
const market = require('./market');
const rank = require('./rank');

const UNIVERSE_MIN_CAP = 2e9;            // 시총 20억 달러 이상 미국 종목
const TECH_MAX_AGE = 10 * 3600e3;
const FUND_MAX_AGE = 20 * 3600e3;
const EXTRA = [
  'SPY', 'QQQ', 'DIA', 'IWM',
  // SPDR S&P 산업 ETF (랭킹)
  'XAR', 'KBE', 'XBI', 'KCE', 'XHE', 'XHS', 'XHB', 'KIE', 'XME', 'XES', 'XOP', 'XPH', 'KRE', 'XRT', 'XSD', 'XSW', 'XTL', 'XTN',
];

const S = {
  tech: { updatedAt: null, rows: {} },
  fund: { updatedAt: null, rows: {} },
  extraSyms: new Set(),   // 다른 모듈이 요청한 추가 종목(한국 ETF 등)
  running: false,
  progress: null,
  log: [],
};
const note = (msg) => { S.log.push(`${new Date().toISOString()} ${msg}`); S.log = S.log.slice(-30); console.log('[sync]', msg); };

async function load() {
  S.tech = (await store.getKV('tech')) || S.tech;
  S.fund = (await store.getKV('fund')) || S.fund;
  note(`불러옴: tech ${Object.keys(S.tech.rows).length} · fund ${Object.keys(S.fund.rows).length}`);
}

// ---------- 계산 도우미 ----------
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function sma(c, n) { return c.length >= n ? avg(c.slice(-n)) : null; }
function rsi(c, n = 14) {
  if (c.length < n + 2) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (l === 0) return 100;
  return +(100 - 100 / (1 + g / l)).toFixed(2);
}
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(2));
const dayMs = 864e5;
function mondayKey(d) {
  const t = Date.parse(d);
  const wd = (new Date(t).getUTCDay() + 6) % 7; // 월=0
  return new Date(t - wd * dayMs).toISOString().slice(0, 10);
}

function computeTech(r) {
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const off = r.meta?.gmtoffset || 0;
  const d = [], c = [], v = [];
  ts.forEach((sec, i) => {
    const cl = q.close?.[i];
    if (cl == null || !Number.isFinite(cl)) return;
    d.push(new Date((sec + off) * 1000).toISOString().slice(0, 10));
    c.push(cl);
    v.push(q.volume?.[i] || 0);
  });
  const n = c.length;
  if (n < 30) return null;
  const p = c[n - 1], last = d[n - 1];
  const back = (days) => {
    const target = new Date(Date.parse(last) - days * dayMs).toISOString().slice(0, 10);
    for (let i = n - 1; i >= 0; i--) if (d[i] <= target) return (p / c[i] - 1) * 100;
    return null;
  };
  let ytd = null;
  const y0 = last.slice(0, 4) + '-01-01';
  for (let i = n - 1; i >= 0; i--) if (d[i] < y0) { ytd = (p / c[i] - 1) * 100; break; }

  // 주봉 (진행 중인 주 제외)
  const weeks = [];
  for (let i = 0; i < n; i++) {
    const k = mondayKey(d[i]);
    if (weeks.length && weeks[weeks.length - 1].k === k) { weeks[weeks.length - 1].d = d[i]; weeks[weeks.length - 1].c = c[i]; } else weeks.push({ k, d: d[i], c: c[i] });
  }
  const thisWeek = mondayKey(new Date().toISOString().slice(0, 10));
  const lastWd = new Date(Date.parse(last)).getUTCDay();
  const done = weeks.length && weeks[weeks.length - 1].k === thisWeek && lastWd !== 5 ? weeks.slice(0, -1) : weeks;
  const wc = done.map((w) => w.c);
  const aligned = (end) => {
    const s = (m) => (end >= m ? avg(wc.slice(end - m, end)) : null);
    const a = s(4), b = s(13), cc = s(26), e = s(52);
    if (a == null || b == null || cc == null || e == null) return null;
    return a > b && b > cc && cc > e;
  };
  const alNow = aligned(wc.length);
  let alDays = null;
  if (alNow) {
    let k = wc.length;
    while (k - 1 >= 52 && aligned(k - 1)) k--;
    alDays = Math.round((Date.parse(last) - Date.parse(done[k - 1].d)) / dayMs);
  }
  const s20 = sma(c, 20), s60 = sma(c, 60), s120 = sma(c, 120);
  let st = null;
  if (s120 != null) {
    if (p < s120) st = '위험';
    else if (s60 != null && p < s60) st = '경계';
    else if ((s20 != null && p < s20) || alNow === false) st = '주의';
    else st = '양호';
  }
  const y1c = c.slice(-252);
  const hi52 = Math.max(...y1c), lo52 = Math.min(...y1c);
  const mon = [];
  for (let i = 0; i < n; i++) {
    const ym = d[i].slice(0, 7);
    if (mon.length && mon[mon.length - 1][0] === ym) { mon[mon.length - 1][1] = d[i]; mon[mon.length - 1][2] = r2(c[i]); } else mon.push([ym, d[i], r2(c[i])]);
  }
  const avgV = (k) => Math.round(avg(v.slice(-k)) || 0);
  return {
    at: last, p: r2(p), d1: n > 1 ? r2((p / c[n - 2] - 1) * 100) : null,
    w1: r2(back(7)), m1: r2(back(30)), m3: r2(back(91)), m6: r2(back(182)), y1: r2(back(365)), ytd: r2(ytd),
    vol: v[n - 1], av10: avgV(10), av30: avgV(30), av60: avgV(60), av90: avgV(90),
    rsiD: rsi(c.slice(-300)), rsiW: rsi(wc),
    al: alNow == null ? null : alNow ? 1 : 0, alDays,
    s20: r2(s20), s60: r2(s60), s120: r2(s120), st,
    hi52: r2(hi52), lo52: r2(lo52), fromHi: r2((p / hi52 - 1) * 100), fromLo: r2((p / lo52 - 1) * 100),
    cur: r.meta?.currency || null,
    mon: mon.slice(-26),
    wk: weeks.slice(-110).map((w) => [w.d, r2(w.c)]),
  };
}

const rv = (o) => (o && typeof o === 'object' ? (o.raw ?? null) : (Number.isFinite(o) ? o : null));
const ymd = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : null);

function insiderWindows(list) {
  const now = Date.now() / 1000;
  const out = {};
  for (const w of [7, 30, 91, 182, 365]) out[w] = { bN: 0, bV: 0, sN: 0, sV: 0, lb: null, ls: null };
  for (const t of list || []) {
    const sec = rv(t.startDate);
    if (!sec) continue;
    const text = String(t.transactionText || '');
    const buy = /purchase|buy/i.test(text), sell = /sale|sell/i.test(text);
    if (!buy && !sell) continue;
    const val = rv(t.value) || 0, date = ymd(sec);
    for (const w of [7, 30, 91, 182, 365]) {
      if (now - sec > w * 86400) continue;
      const o = out[w];
      if (buy) { o.bN++; o.bV += val; if (!o.lb || date > o.lb) o.lb = date; } else { o.sN++; o.sV += val; if (!o.ls || date > o.ls) o.ls = date; }
    }
  }
  return out;
}

function computeFund(q) {
  const pr = q.price || {}, sd = q.summaryDetail || {}, ks = q.defaultKeyStatistics || {}, fd = q.financialData || {};
  const ce = q.calendarEvents?.earnings || {}, hb = q.majorHoldersBreakdown || {};
  const per = {};
  for (const t of q.earningsTrend?.trend || []) {
    if (!['0q', '+1q', '0y', '+1y'].includes(t.period)) continue;
    const et = t.epsTrend || {};
    per[{ '0q': 'q0', '+1q': 'q1', '0y': 'y0', '+1y': 'y1' }[t.period]] = {
      end: t.endDate || null,
      eps: rv(t.earningsEstimate?.avg), epsYA: rv(t.earningsEstimate?.yearAgoEps), epsG: rv(t.earningsEstimate?.growth),
      rev: rv(t.revenueEstimate?.avg), revYA: rv(t.revenueEstimate?.yearAgoRevenue), revG: rv(t.revenueEstimate?.growth),
      nA: rv(t.earningsEstimate?.numberOfAnalysts),
      tr: [rv(et.current), rv(et['7daysAgo']), rv(et['30daysAgo']), rv(et['60daysAgo']), rv(et['90daysAgo'])],
    };
  }
  const hist = q.earningsHistory?.history || [];
  const lastH = hist[hist.length - 1];
  return {
    name: pr.longName || pr.shortName || null,
    cur: pr.currency || null,
    mc: rv(pr.marketCap) ?? rv(sd.marketCap),
    price: rv(fd.currentPrice) ?? rv(pr.regularMarketPrice),
    teps: rv(ks.trailingEps), bvps: rv(ks.bookValue), pb: rv(ks.priceToBook),
    div: rv(sd.dividendYield), beta: rv(sd.beta), ps: rv(sd.priceToSalesTrailing12Months), evEbitda: rv(ks.enterpriseToEbitda),
    rev: rv(fd.totalRevenue), revG: rv(fd.revenueGrowth), earnG: rv(fd.earningsGrowth),
    gm: rv(fd.grossMargins), om: rv(fd.operatingMargins), nm: rv(fd.profitMargins), roe: rv(fd.returnOnEquity), de: rv(fd.debtToEquity), fcf: rv(fd.freeCashflow),
    tgt: rv(fd.targetMeanPrice), tgtHi: rv(fd.targetHighPrice), tgtLo: rv(fd.targetLowPrice), nAnalyst: rv(fd.numberOfAnalystOpinions), rec: rv(fd.recommendationMean), recKey: fd.recommendationKey || null,
    nextEarn: ymd(rv(ce.earningsDate?.[0])), nextEst: ce.isEarningsDateEstimate ?? null,
    lastRep: lastH ? { q: ymd(rv(lastH.quarter)), act: rv(lastH.epsActual), est: rv(lastH.epsEstimate), sp: rv(lastH.surprisePercent) } : null,
    insPct: rv(hb.insidersPercentHeld) ?? rv(ks.heldPercentInsiders), instPct: rv(hb.institutionsPercentHeld) ?? rv(ks.heldPercentInstitutions),
    ins: insiderWindows(q.insiderTransactions?.transactions),
    ...per,
  };
}

const FUND_MODULES = 'price,summaryDetail,defaultKeyStatistics,financialData,earningsTrend,calendarEvents,earningsHistory,insiderTransactions,majorHoldersBreakdown';

// ---------- 대상 종목 ----------
async function trackedSymbols() {
  const out = new Set();
  try {
    for (const w of await store.allDocs('watch')) for (const g of w.groups || []) for (const s of g.symbols || []) out.add(s);
    for (const w of await store.allDocs('watch')) for (const s of Object.keys(w.alerts || {})) out.add(s);
    for (const w of await store.allDocs('watch')) for (const s of w.bells || []) out.add(s);
    for (const p of await store.allDocs('portfolio')) for (const t of p.trades || []) out.add(t.symbol);
    for (const p of await store.allDocs('portfolio')) for (const t of p.positions || []) out.add(t.symbol);
  } catch (e) { note('관심 종목 수집 실패 ' + e.message); }
  return out;
}

async function universe() {
  const set = new Set(EXTRA);
  const noFund = new Set(EXTRA);
  try {
    const d = await market.screener();
    for (const r of d.rows) if (r.mc >= UNIVERSE_MIN_CAP) set.add(r.s);
  } catch (e) { note('종목 목록 실패 ' + e.message); }
  // 한국 랭킹용: 산업 ETF + 시총 1조원 이상 기업 (기술 지표만)
  for (const [s] of rank.KR_ETF) { set.add(s); noFund.add(s); }
  try { for (const r of await rank.krCompanies()) { set.add(r.s); noFund.add(r.s); } } catch (e) { note('한국 종목 목록 실패 ' + e.message); }
  for (const s of S.extraSyms) set.add(s);
  const tracked = await trackedSymbols();
  for (const s of tracked) { set.add(s); noFund.delete(s); }
  return { all: [...set], tracked, fundSyms: [...set].filter((s) => !noFund.has(s)) };
}

// ---------- 작업 ----------
async function runTech(syms) {
  const now = Date.now();
  const need = syms.filter((s) => !S.tech.rows[s] || now - (S.tech.rows[s]._t || 0) > TECH_MAX_AGE);
  if (!need.length) return;
  note(`기술 지표 ${need.length}개 계산 시작`);
  let done = 0, fail = 0;
  for (let i = 0; i < need.length; i += 300) {
    const chunk = need.slice(i, i + 300);
    await market.mapLimit(chunk, 6, async (s) => {
      try {
        const r = await market.yahooChart(s, '2y', '1d');
        const t = computeTech(r);
        if (t) S.tech.rows[s] = { ...t, _t: Date.now() };
      } catch { fail++; }
      done++;
      S.progress = { stage: 'tech', done, total: need.length };
    });
    S.tech.updatedAt = new Date().toISOString();
    await store.putKV('tech', S.tech).catch((e) => note('저장 실패 ' + e.message));
  }
  note(`기술 지표 완료 (실패 ${fail})`);
}

function diffFund(sym, a, b) {
  const out = [];
  if (!a || !b) return out;
  for (const k of ['q0', 'q1', 'y0', 'y1']) {
    const x = a[k], y = b[k];
    if (!x || !y || x.end !== y.end) continue;
    for (const f of ['eps', 'rev']) {
      if (x[f] == null || y[f] == null || x[f] === y[f]) continue;
      const pct = x[f] ? ((y[f] - x[f]) / Math.abs(x[f])) * 100 : null;
      if (pct != null && Math.abs(pct) < 0.05) continue;
      out.push({ sym, kind: 'consensus', data: { period: k, end: y.end, field: f, from: x[f], to: y[f], pct } });
    }
  }
  if (a.nextEarn !== b.nextEarn && b.nextEarn) out.push({ sym, kind: 'schedule', data: { from: a.nextEarn, to: b.nextEarn, est: b.nextEst } });
  else if (a.nextEst === true && b.nextEst === false && b.nextEarn) out.push({ sym, kind: 'schedule', data: { from: a.nextEarn, to: b.nextEarn, est: false, confirmed: true } });
  if (b.lastRep?.q && b.lastRep.q !== a.lastRep?.q) out.push({ sym, kind: 'result', data: b.lastRep });
  return out;
}

async function runFund(syms, tracked) {
  const now = Date.now();
  // 관심·보유 종목을 먼저
  const need = syms.filter((s) => !/=/.test(s) && (!S.fund.rows[s] || now - (S.fund.rows[s]._t || 0) > FUND_MAX_AGE))
    .sort((a, b) => (tracked.has(b) ? 1 : 0) - (tracked.has(a) ? 1 : 0));
  if (!need.length) return;
  note(`컨센서스 ${need.length}개 수집 시작`);
  let done = 0, fail = 0, authFail = 0;
  const changes = [];
  for (let i = 0; i < need.length && authFail < 25; i += 200) {
    const chunk = need.slice(i, i + 200);
    await market.mapLimit(chunk, 3, async (s) => {
      if (authFail >= 25) return;
      try {
        const q = await market.quoteSummary(s, FUND_MODULES);
        const f = computeFund(q);
        const prev = S.fund.rows[s];
        if (tracked.has(s)) changes.push(...diffFund(s, prev, f));
        S.fund.rows[s] = { ...f, _t: Date.now() };
        authFail = 0;
      } catch (e) {
        fail++;
        if (/401|403|429|crumb/.test(e.message)) authFail++;
      }
      done++;
      S.progress = { stage: 'fund', done, total: need.length };
    });
    S.fund.updatedAt = new Date().toISOString();
    await store.putKV('fund', S.fund).catch((e) => note('저장 실패 ' + e.message));
    if (changes.length) { await store.addChanges(changes.splice(0)).catch((e) => note('변화 기록 실패 ' + e.message)); }
  }
  note(`컨센서스 완료 (실패 ${fail}${authFail >= 25 ? ', Yahoo 차단으로 중단' : ''})`);
}

async function runAll() {
  if (S.running) return;
  S.running = true;
  try {
    const { all, tracked, fundSyms } = await universe();
    await runTech(all);
    await runFund(fundSyms, tracked);
  } catch (e) {
    note('작업 오류 ' + e.message);
  } finally {
    S.running = false;
    S.progress = null;
  }
}

function start() {
  load().then(() => setTimeout(runAll, 20e3)).catch((e) => note('불러오기 실패 ' + e.message));
  setInterval(runAll, 2 * 3600e3);
}

// 수집 대상 밖 종목(소형주·한국 종목 등)을 즉석 계산
async function ensureTech(syms) {
  const now = Date.now();
  const need = syms.filter((s) => !S.tech.rows[s] || now - (S.tech.rows[s]._t || 0) > TECH_MAX_AGE).slice(0, 80);
  await market.mapLimit(need, 6, async (s) => {
    try { const t = computeTech(await market.yahooChart(s, '2y', '1d')); if (t) S.tech.rows[s] = { ...t, _t: Date.now() }; } catch { /* 없음 */ }
  });
}
async function ensureFund(syms) {
  const now = Date.now();
  const need = syms.filter((s) => !/=/.test(s) && (!S.fund.rows[s] || now - (S.fund.rows[s]._t || 0) > FUND_MAX_AGE)).slice(0, 30);
  await market.mapLimit(need, 3, async (s) => {
    try { S.fund.rows[s] = { ...computeFund(await market.quoteSummary(s, FUND_MODULES)), _t: Date.now() }; } catch { /* 없음 */ }
  });
}

// 화면용 요약 (월말·주말 종가 시계열 제외)
function compactTech(t) {
  if (!t) return null;
  const { mon, wk, _t, ...rest } = t;
  return rest;
}
function compactFund(f) {
  if (!f) return null;
  const { _t, ...rest } = f;
  return rest;
}
function metrics(syms) {
  const keys = syms || [...new Set([...Object.keys(S.tech.rows), ...Object.keys(S.fund.rows)])];
  const rows = {};
  for (const s of keys) {
    const t = S.tech.rows[s], f = S.fund.rows[s];
    if (t || f) rows[s] = { t: compactTech(t), f: compactFund(f) };
  }
  return { techAt: S.tech.updatedAt, fundAt: S.fund.updatedAt, rows };
}

function status() {
  return { running: S.running, progress: S.progress, tech: Object.keys(S.tech.rows).length, fund: Object.keys(S.fund.rows).length, techAt: S.tech.updatedAt, fundAt: S.fund.updatedAt, log: S.log.slice(-10) };
}

module.exports = { start, runAll, metrics, status, ensureTech, ensureFund, techRow: (s) => S.tech.rows[s], fundRow: (s) => S.fund.rows[s], allTech: () => S.tech.rows, addExtra: (syms) => syms.forEach((s) => S.extraSyms.add(s)), computeTech, computeFund };
