// Nasdaq 공개 API로 만드는 기업 펀더멘털 (Yahoo가 막힐 때 미국 종목용 대체 자료)
// Yahoo compact()/profile()과 같은 모양의 객체를 돌려준다.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function get(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch('https://api.nasdaq.com' + path, { headers: HEADERS, signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// "$96,222,000" · "-$102,000" · "66.2%" · "--" → 숫자
function num(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === '--' || s === 'N/A') return null;
  const n = parseFloat(s.replace(/[$,%\s]/g, '').replace(/\(m\)$/, ''));
  return Number.isFinite(n) ? n : null;
}

// 재무제표 표 → { 항목명: [최근분기, 이전분기, ...] } (금액은 천 달러 단위라 1000배)
function table(tb, scale = 1000) {
  const out = {};
  for (const r of tb?.rows || []) {
    const vals = ['value2', 'value3', 'value4', 'value5'].map((k) => num(r[k]));
    out[r.value1] = vals.map((v) => (v == null ? null : v * scale));
  }
  return out;
}
const sum4 = (a) => (a && a.slice(0, 4).every((v) => v != null) ? a.slice(0, 4).reduce((x, y) => x + y, 0) : null);
const first = (a) => (a ? a[0] : null);
const div = (a, b) => (a != null && b ? a / b : null);

function usDate(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

// 분기 매출·EPS 표에서 가장 최근 분기의 전년 대비 성장률
function growthFromRevenue(data) {
  // 표는 "월 이름" 행 다음에 Revenue · EPS · Dividends 행이 오는 묶음의 반복
  const blocks = [];
  for (const r of data?.revenueTable?.rows || []) {
    if (r.value1 === 'Revenue' || r.value1 === 'EPS') {
      if (blocks.length) blocks[blocks.length - 1][r.value1] = r;
    } else if (r.value1 && r.value1 !== 'Dividends') {
      blocks.push({ month: r.value1, total: /^total/i.test(r.value1) });
    }
  }
  let rec = null;
  for (const b of blocks) if (!b.total && b.Revenue && num(b.Revenue.value2) != null) rec = b; // 올해 회계연도에 값이 있는 마지막 분기 (합계 제외)
  if (!rec) return {};
  const r1 = num(rec.Revenue.value2), r0 = num(rec.Revenue.value3);
  const e1 = num(String(rec.EPS?.value2 || '').split(' ')[0]), e0 = num(String(rec.EPS?.value3 || '').split(' ')[0]);
  return {
    revG: r1 != null && r0 ? r1 / r0 - 1 : null,
    earnG: e1 != null && e0 && e0 > 0 ? e1 / e0 - 1 : null,
  };
}

function insiderRows(data) {
  return (data?.transactionTable?.table?.rows || []).map((r) => {
    const shares = num(r.sharesTraded), price = num(r.lastPrice);
    return {
      date: usDate(r.lastDate), name: r.insider || '', rel: r.relation || '', text: r.transactionType || '',
      shares, value: shares != null && price ? shares * price : null,
    };
  });
}

function insiderSummary(rows) {
  const since = new Date(Date.now() - 182 * 864e5).toISOString().slice(0, 10);
  const out = { buyN: 0, buyV: 0, sellN: 0, sellV: 0 };
  for (const t of rows) {
    if (!t.date || t.date < since) continue;
    if (/buy|purchase/i.test(t.text)) { out.buyN++; out.buyV += t.value || 0; } else if (/sell|sale/i.test(t.text)) { out.sellN++; out.sellV += t.value || 0; }
  }
  return out;
}

async function nasdaqData(sym, withProfile) {
  const s = encodeURIComponent(sym); // BRK.B 처럼 점 그대로 사용
  const [summary, fin, rev, tgt, fc, ed, ins, prof, ratings] = await Promise.all([
    get(`/api/quote/${s}/summary?assetclass=stocks`),
    get(`/api/company/${s}/financials?frequency=2`),
    get(`/api/company/${s}/revenue?limit=1`),
    get(`/api/analyst/${s}/targetprice`),
    get(`/api/analyst/${s}/earnings-forecast`),
    get(`/api/analyst/${s}/earnings-date`),
    get(`/api/company/${s}/insider-trades?limit=15&type=ALL&sortColumn=lastDate&sortOrder=DESC`),
    withProfile ? get(`/api/company/${s}/company-profile`) : null,
    withProfile ? get(`/api/analyst/${s}/ratings`) : null,
  ]);
  if (!summary?.summaryData) return null;
  return { summary: summary.summaryData, fin, rev, tgt, fc, ed, ins, prof, ratings };
}

function build(d, price) {
  const sd = d.summary;
  const inc = table(d.fin?.incomeStatementTable);
  const bal = table(d.fin?.balanceSheetTable);
  const cf = table(d.fin?.cashFlowTable);
  const ratio = table(d.fin?.financialRatiosTable, 0.01); // % → 비율
  const mc = num(sd.MarketCap?.value);
  const [hi52, lo52] = String(sd.FiftTwoWeekHighLow?.value || '').split('/').map(num);
  const revTTM = sum4(inc['Total Revenue']);
  const niTTM = sum4(inc['Net Income']);
  const equity = first(bal['Total Equity']);
  const debt = (first(bal['Short-Term Debt / Current Portion of Long-Term Debt']) || 0) + (first(bal['Long-Term Debt']) || 0);
  const cash = (first(bal['Cash and Cash Equivalents']) || 0) + (first(bal['Short-Term Investments']) || 0);
  const opTTM = sum4(inc['Operating Income']);
  const depTTM = sum4(cf['Depreciation']);
  const ebitda = opTTM != null ? opTTM + (depTTM || 0) : null;
  const ocf = sum4(cf['Net Cash Flow-Operating']);
  const capex = sum4(cf['Capital Expenditures']);
  const fcRows = d.fc?.quarterlyForecast?.rows || [];
  const fwdEps = fcRows.length >= 4 ? fcRows.slice(0, 4).reduce((a, r) => a + (r.consensusEPSForecast || 0), 0) : null;
  const co = d.tgt?.consensusOverview || {};
  const nA = (co.buy || 0) + (co.hold || 0) + (co.sell || 0);
  const insiders = insiderRows(d.ins);
  const g = growthFromRevenue(d.rev);
  const pe = mc && niTTM > 0 ? mc / niTTM : null;
  return {
    name: null,
    cur: 'USD',
    price,
    mc,
    pe,
    fpe: price && fwdEps > 0 ? price / fwdEps : null,
    pb: mc && equity > 0 ? mc / equity : null,
    ps: div(mc, revTTM),
    evEbitda: mc && ebitda > 0 ? (mc + debt - cash) / ebitda : null,
    peg: null,
    div: num(sd.Yield?.value) != null ? num(sd.Yield.value) / 100 : null,
    beta: null,
    hi52: hi52 ?? null,
    lo52: lo52 ?? null,
    rev: revTTM,
    revG: g.revG ?? null,
    earnG: g.earnG ?? null,
    gm: first(ratio['Gross Margin']),
    om: first(ratio['Operating Margin']),
    nm: div(niTTM, revTTM),
    roe: equity > 0 && niTTM != null ? niTTM / equity : null,
    de: equity > 0 ? (debt / equity) * 100 : null,
    fcf: ocf != null ? ocf + (capex || 0) : null,
    cash: cash || null,
    debt: debt || null,
    tgt: co.priceTarget ?? num(sd.OneYrTarget?.value),
    tgtHi: co.highPriceTarget ?? null,
    tgtLo: co.lowPriceTarget ?? null,
    nAnalyst: nA || null,
    rec: null,
    recKey: d.ratings?.meanRatingType ? d.ratings.meanRatingType.toLowerCase().replace(/\s+/g, '_') : (nA ? (co.buy >= co.hold ? 'buy' : 'hold') : null),
    nextEarn: usDate(d.ed?.reportText),
    epsEst: fcRows[0]?.consensusEPSForecast ?? null,
    insiderPct: null,
    instPct: null,
    ins6m: insiderSummary(insiders),
    _insiders: insiders,
    _inc: inc,
    _headers: d.fin?.incomeStatementTable?.headers,
    source: 'nasdaq',
  };
}

async function fundamentals(sym, price) {
  if (/\.(KS|KQ)$|=/i.test(sym)) return null; // 미국 상장 종목만
  const d = await nasdaqData(sym, false);
  if (!d) return null;
  const out = build(d, price);
  delete out._insiders; delete out._inc; delete out._headers;
  return out;
}

async function profile(sym, price) {
  if (/\.(KS|KQ)$|=/i.test(sym)) return null;
  const d = await nasdaqData(sym, true);
  if (!d) return null;
  const out = build(d, price);
  const h = out._headers || {};
  const quarters = ['value2', 'value3', 'value4', 'value5'].map((k, i) => ({
    p: (usDate(h[k]) || '').slice(2, 7).replace('-', '.'),
    rev: out._inc['Total Revenue']?.[i] ?? null,
    earn: out._inc['Net Income']?.[i] ?? null,
  })).filter((q) => q.p).reverse();
  const co = d.tgt?.consensusOverview || {};
  const p = d.prof || {};
  const res = {
    ...out,
    name: p.CompanyName?.value || null,
    summary: p.CompanyDescription?.value || '',
    sector: d.summary.Sector?.value || p.Sector?.value || '',
    industry: d.summary.Industry?.value || p.Industry?.value || '',
    website: p.CompanyUrl?.value || '',
    employees: null,
    country: p.Region?.value || '',
    recTrend: co.buy != null ? { strongBuy: 0, buy: co.buy || 0, hold: co.hold || 0, sell: co.sell || 0, strongSell: 0 } : null,
    epsHist: [],
    quarterly: quarters,
    yearly: [],
    insiders: out._insiders.slice(0, 15),
  };
  delete res._insiders; delete res._inc; delete res._headers;
  return res;
}

module.exports = { fundamentals, profile };
