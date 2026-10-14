// 랭킹 테이블: 날짜(월말·주말)별 직전 12개월 상승률 순위
const store = require('./store');

const US_ETF = [
  ['XAR', '항공우주·방산'], ['KBE', '은행'], ['XBI', '바이오'], ['KCE', '자본시장'], ['XHE', '헬스케어 장비'], ['XHS', '헬스케어 서비스'],
  ['XHB', '주택건설'], ['KIE', '보험'], ['XME', '금속·광업'], ['XES', '석유·가스 장비'], ['XOP', '석유·가스 탐사'], ['XPH', '제약'],
  ['KRE', '지역은행'], ['XRT', '소매'], ['XSD', '반도체'], ['XSW', '소프트웨어'], ['XTL', '통신'], ['XTN', '운송'],
];
const KR_ETF = [
  ['091160.KS', '반도체 · KODEX'], ['091170.KS', '은행 · KODEX'], ['091180.KS', '자동차 · KODEX'], ['117460.KS', '에너지화학 · KODEX'],
  ['117700.KS', '건설 · KODEX'], ['140700.KS', '보험 · KODEX'], ['102970.KS', '증권 · KODEX'], ['244580.KS', '바이오 · KODEX'],
  ['305720.KS', '2차전지 · KODEX'], ['266390.KS', '경기소비재 · KODEX'], ['266410.KS', '필수소비재 · KODEX'], ['266370.KS', 'IT 하드웨어 · KODEX'],
  ['117680.KS', '철강 · KODEX'], ['140710.KS', '운송 · KODEX'], ['102960.KS', '조선 · KODEX'], ['266360.KS', 'IT 소프트웨어 · KODEX'],
  ['228790.KS', '화장품 · TIGER'], ['228810.KS', '미디어컨텐츠 · TIGER'],
];
const US_GROUPS = { mega: [200e9, Infinity], large: [10e9, 200e9], mid: [2e9, 10e9] };
const KR_GROUPS = { mega: [50e12, Infinity], large: [10e12, 50e12], mid: [1e12, 10e12] };

// ---------- 한국 시가총액 목록 (네이버) ----------
let krList = null; // { at, rows: [{ s, n, mc }] }

async function fetchKrList() {
  const rows = [];
  for (const [mk, suf] of [['KOSPI', '.KS'], ['KOSDAQ', '.KQ']]) {
    for (let page = 1; page <= 6; page++) {
      const r = await fetch(`https://m.stock.naver.com/api/stocks/marketValue/${mk}?page=${page}&pageSize=100`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36' },
      });
      if (!r.ok) break;
      const j = await r.json();
      let stop = false;
      for (const x of j.stocks || []) {
        if (x.stockEndType !== 'stock') continue;
        const mc = parseFloat(String(x.marketValue).replace(/,/g, '')) * 1e8; // 억원 → 원
        if (!(mc >= KR_GROUPS.mid[0])) { stop = true; break; }
        rows.push({ s: x.itemCode + suf, n: x.stockName, mc });
      }
      if (stop || !(j.stocks || []).length) break;
    }
  }
  return rows;
}

async function krCompanies() {
  if (krList && Date.now() - krList.at < 20 * 3600e3) return krList.rows;
  try {
    const rows = await fetchKrList();
    if (rows.length) {
      krList = { at: Date.now(), rows };
      await store.putKV('krlist', krList).catch(() => {});
      return rows;
    }
  } catch { /* 아래 저장본 사용 */ }
  krList = krList || (await store.getKV('krlist').catch(() => null));
  return krList?.rows || [];
}

// ---------- 순위 계산 ----------
const shiftYear = (ym) => `${+ym.slice(0, 4) - 1}${ym.slice(4)}`;
function baseBefore(wk, date) {
  const target = new Date(Date.parse(date) - 365 * 864e5).toISOString().slice(0, 10);
  let hit = null;
  for (const [d, c] of wk) { if (d <= target) hit = [d, c]; else break; }
  return hit;
}

// 열(기준 날짜) 목록
function columns(mode, sampleRows) {
  const ref = sampleRows.find((t) => t?.wk?.length > 60);
  if (!ref) return [];
  if (mode === 'week') return ref.wk.slice(-12).map(([d]) => ({ key: d, label: d.slice(5).replace('-', '/') }));
  const mons = ref.mon.slice(-13).map(([ym, d]) => ({ key: ym, label: `${+ym.slice(5)}월`, d }));
  const cur = mons[mons.length - 1];
  if (cur) cur.label = `${cur.label} (현재)`;
  return mons;
}

function returnAt(t, mode, col) {
  if (!t?.wk?.length) return null;
  if (mode === 'week') {
    const i = t.wk.findIndex(([d]) => d === col.key);
    const pt = i >= 0 ? t.wk[i] : [...t.wk].reverse().find(([d]) => d <= col.key);
    if (!pt) return null;
    const b = baseBefore(t.wk, pt[0]);
    return b && b[1] ? { ret: (pt[1] / b[1] - 1) * 100, d1: pt[0], c1: pt[1], d0: b[0], c0: b[1] } : null;
  }
  const m = t.mon.find(([ym]) => ym === col.key);
  if (!m) return null;
  const isCurrent = m[1] === t.at && col.label.includes('현재');
  let b = null;
  if (isCurrent) b = baseBefore(t.wk, m[1]);
  else { const pm = t.mon.find(([ym]) => ym === shiftYear(col.key)); if (pm) b = [pm[1], pm[2]]; }
  return b && b[1] ? { ret: (m[2] / b[1] - 1) * 100, d1: m[1], c1: m[2], d0: b[0], c0: b[1] } : null;
}

function rankMatrix(items, techRows, mode) {
  const cols = columns(mode, items.map((x) => techRows[x.s]));
  const out = cols.map((col) => {
    const list = items.map((x) => {
      const r = returnAt(techRows[x.s], mode, col);
      return r ? { s: x.s, n: x.n, ...r, ret: +r.ret.toFixed(2) } : null;
    }).filter(Boolean).sort((a, b) => b.ret - a.ret || a.s.localeCompare(b.s));
    list.forEach((x, i) => { x.rank = i + 1; });
    return { ...col, list };
  });
  // 직전 열 대비 순위 변화
  for (let i = 1; i < out.length; i++) {
    const prev = new Map(out[i - 1].list.map((x) => [x.s, x.rank]));
    for (const x of out[i].list) x.ch = prev.has(x.s) ? prev.get(x.s) - x.rank : null;
  }
  return out;
}

module.exports = { US_ETF, KR_ETF, US_GROUPS, KR_GROUPS, krCompanies, rankMatrix };
