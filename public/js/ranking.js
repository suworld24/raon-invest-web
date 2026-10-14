// 랭킹 테이블: 산업 ETF / 기업의 주간·월간 수익률 순위와 순위 변동, 색상 표시
import { state, updateQuiet, market, esc, fmtPct, fmtNum, fmtMoney, cls, download, toCsv, today } from './core.js';
import { periodReturns } from './analytics.js';
import { sparkline } from './charts.js';

const US_ETF = [
  ['XLK', '기술'], ['XLF', '금융'], ['XLE', '에너지'], ['XLV', '헬스케어'], ['XLI', '산업재'], ['XLY', '경기소비재'], ['XLP', '필수소비재'],
  ['XLU', '유틸리티'], ['XLB', '소재'], ['XLRE', '부동산'], ['XLC', '커뮤니케이션'], ['SMH', '반도체'], ['IGV', '소프트웨어'], ['CIBR', '사이버보안'],
  ['SKYY', '클라우드'], ['BOTZ', '로봇·AI'], ['XBI', '바이오'], ['IHI', '의료기기'], ['ITA', '항공우주·방산'], ['KRE', '지역은행'], ['KBE', '은행'],
  ['IAI', '증권·거래소'], ['XHB', '주택건설'], ['XRT', '소매'], ['JETS', '항공사'], ['IYT', '운송'], ['TAN', '태양광'], ['ICLN', '클린에너지'],
  ['URA', '우라늄·원자력'], ['LIT', '리튬·배터리'], ['GDX', '금광'], ['SIL', '은광'], ['COPX', '구리광산'], ['XME', '금속·광업'], ['XOP', '석유 탐사·생산'],
  ['OIH', '석유 서비스'], ['PAVE', '인프라'], ['MOO', '농업'], ['BLOK', '블록체인'], ['ARKK', '혁신성장'],
];
const KR_ETF = [
  ['069500.KS', 'KODEX 200'], ['229200.KS', 'KODEX 코스닥150'], ['091160.KS', 'KODEX 반도체'], ['091170.KS', 'KODEX 은행'], ['091180.KS', 'KODEX 자동차'],
  ['117460.KS', 'KODEX 에너지화학'], ['117700.KS', 'KODEX 건설'], ['140700.KS', 'KODEX 보험'], ['102970.KS', 'KODEX 증권'], ['244580.KS', 'KODEX 바이오'],
  ['305720.KS', 'KODEX 2차전지산업'], ['266390.KS', 'KODEX 경기소비재'], ['266410.KS', 'KODEX 필수소비재'], ['266370.KS', 'KODEX IT'], ['117680.KS', 'KODEX 철강'],
  ['140710.KS', 'KODEX 운송'],
];
const KR_STOCKS = [
  ['005930.KS', '삼성전자'], ['000660.KS', 'SK하이닉스'], ['373220.KS', 'LG에너지솔루션'], ['207940.KS', '삼성바이오로직스'], ['005380.KS', '현대차'],
  ['000270.KS', '기아'], ['068270.KS', '셀트리온'], ['035420.KS', 'NAVER'], ['105560.KS', 'KB금융'], ['055550.KS', '신한지주'], ['012330.KS', '현대모비스'],
  ['005490.KS', 'POSCO홀딩스'], ['035720.KS', '카카오'], ['051910.KS', 'LG화학'], ['006400.KS', '삼성SDI'], ['028260.KS', '삼성물산'], ['012450.KS', '한화에어로스페이스'],
  ['329180.KS', 'HD현대중공업'], ['034020.KS', '두산에너빌리티'], ['086790.KS', '하나금융지주'], ['066570.KS', 'LG전자'], ['003550.KS', 'LG'], ['015760.KS', '한국전력'],
  ['032830.KS', '삼성생명'], ['009150.KS', '삼성전기'], ['010130.KS', '고려아연'], ['011200.KS', 'HMM'], ['042660.KS', '한화오션'], ['096770.KS', 'SK이노베이션'],
  ['017670.KS', 'SK텔레콤'], ['030200.KS', 'KT'], ['247540.KQ', '에코프로비엠'], ['086520.KQ', '에코프로'], ['196170.KQ', '알테오젠'],
];
const COLORS = [['', '색상 없음'], ['red', '빨강', '#e0383e'], ['orange', '주황', '#f0883e'], ['yellow', '노랑', '#d4a106'], ['green', '초록', '#1f9d63'], ['blue', '파랑', '#2f6fed']];
const colorHex = (c) => COLORS.find((x) => x[0] === c)?.[2] || 'transparent';

let country = 'US';
let mode = 'industry';
let period = 'w1';
let topN = 20;
let colorFilter = 'all';

async function universe() {
  if (country === 'KR') return (mode === 'industry' ? KR_ETF : KR_STOCKS).map(([s, n]) => ({ s, n }));
  if (mode === 'industry') return US_ETF.map(([s, n]) => ({ s, n: `${n} · ${s}` }));
  const d = await market.screener();
  return d.rows.filter((r) => r.ctry === 'United States' || r.mc > 50e9).slice(0, 200).map((r) => ({ s: r.s, n: r.n }));
}

export async function render(root) {
  const colors = state.ranking.colors || {};
  root.innerHTML = `
  <div class="toolbar">
    <div class="seg" id="rk-country"><button data-v="US" class="${country === 'US' ? 'on' : ''}">🇺🇸 미국</button><button data-v="KR" class="${country === 'KR' ? 'on' : ''}">🇰🇷 한국</button></div>
    <div class="seg" id="rk-mode"><button data-v="industry" class="${mode === 'industry' ? 'on' : ''}">산업</button><button data-v="company" class="${mode === 'company' ? 'on' : ''}">기업</button></div>
    <select id="rk-period"><option value="w1" ${period === 'w1' ? 'selected' : ''}>주간 기록</option><option value="m1" ${period === 'm1' ? 'selected' : ''}>월간 기록</option><option value="m3" ${period === 'm3' ? 'selected' : ''}>3개월</option><option value="ytd" ${period === 'ytd' ? 'selected' : ''}>연초 이후</option></select>
    <select id="rk-top"><option value="20" ${topN === 20 ? 'selected' : ''}>상위 20위</option><option value="50" ${topN === 50 ? 'selected' : ''}>상위 50위</option><option value="0" ${topN === 0 ? 'selected' : ''}>전체 순위</option></select>
    <select id="rk-color"><option value="all">모든 색상</option>${COLORS.map(([v, l]) => `<option value="${v || 'none'}" ${colorFilter === (v || 'none') ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <span style="flex:1"></span>
    <button class="btn" id="rk-csv">CSV 저장</button>
  </div>
  <div class="card"><div id="rk-body"><div class="empty" id="rk-progress">순위 계산에 필요한 시세를 불러오는 중입니다…</div></div>
  <details class="small muted" style="margin-top:12px"><summary>자료 출처 및 순위 기준</summary>
    <p>Yahoo Finance 일간 종가 기준 가격 수익률입니다. 주간은 최근 5거래일, 월간은 최근 약 1개월 수익률로 순위를 매기고, 순위 변동은 직전 같은 길이 기간의 순위와 비교합니다. 미국 기업은 시가총액 상위 200개, 한국 기업은 주요 대형주 기준입니다. 색상은 종목을 직접 표시해 두는 용도로 내 계정에 저장됩니다.</p>
  </details></div>`;

  const seg = (id, set) => root.querySelectorAll(`${id} button`).forEach((b) => { b.onclick = () => { set(b.dataset.v); render(root); }; });
  seg('#rk-country', (v) => { country = v; });
  seg('#rk-mode', (v) => { mode = v; });
  root.querySelector('#rk-period').onchange = (e) => { period = e.target.value; render(root); };
  root.querySelector('#rk-top').onchange = (e) => { topN = +e.target.value; render(root); };
  root.querySelector('#rk-color').onchange = (e) => { colorFilter = e.target.value; render(root); };

  const items = await universe().catch(() => []);
  const hist = await market.history(items.map((i) => i.s), '1y', (d, n) => {
    const el = root.querySelector('#rk-progress');
    if (el) el.textContent = `시세 불러오는 중 · ${d}/${n}`;
  });
  if (!root.isConnected) return;
  const lag = { w1: 5, m1: 21, m3: 63, ytd: 0 }[period];
  const rows = items.filter((i) => hist[i.s]?.c.length > 30).map((i) => {
    const h = hist[i.s];
    const cur = periodReturns(h.c, h.t)[period];
    const prev = lag ? periodReturns(h.c, h.t, lag)[period] : null;
    return { ...i, ret: cur, prev, price: h.c[h.c.length - 1], cur: h.cur, spark: h.c.slice(-60), color: colors[i.s] || '' };
  }).filter((r) => r.ret != null);
  const prevRank = new Map(rows.slice().filter((r) => r.prev != null).sort((a, b) => b.prev - a.prev).map((r, i) => [r.s, i + 1]));
  rows.sort((a, b) => b.ret - a.ret).forEach((r, i) => { r.rank = i + 1; r.prevRank = prevRank.get(r.s) || null; });
  let list = rows;
  if (colorFilter !== 'all') list = list.filter((r) => (colorFilter === 'none' ? !r.color : r.color === colorFilter));
  if (topN) list = list.slice(0, topN);
  const label = { w1: '주간', m1: '월간', m3: '3개월', ytd: 'YTD' }[period];

  root.querySelector('#rk-body').innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th class="num">순위</th><th class="num">변동</th><th></th><th>${mode === 'industry' ? '산업 (대표 ETF)' : '기업'}</th><th class="num">${label} 수익률</th>${lag ? `<th class="num">직전 ${label}</th>` : ''}<th class="num">가격</th><th>최근 3개월</th></tr></thead><tbody>
    ${list.map((r) => {
      const ch = r.prevRank ? r.prevRank - r.rank : null;
      return `<tr><td class="num"><b>${r.rank}</b></td><td class="num ${ch > 0 ? 'up' : ch < 0 ? 'down' : 'muted'}">${ch == null ? 'NEW' : ch > 0 ? '▲' + ch : ch < 0 ? '▼' + -ch : '–'}</td>
        <td><button class="star" data-color="${esc(r.s)}" title="색상 표시"><span class="dot" style="background:${colorHex(r.color)};border:1px solid var(--border)"></span></button></td>
        <td><div class="sym">${esc(r.n)}</div><div class="sub">${esc(r.s)}</div></td>
        <td class="num ${cls(r.ret)}"><b>${fmtPct(r.ret)}</b></td>${lag ? `<td class="num ${cls(r.prev)}">${fmtPct(r.prev)}</td>` : ''}
        <td class="num">${r.cur === 'KRW' ? fmtMoney(r.price, 'KRW') : fmtNum(r.price, 2)}</td><td>${sparkline(r.spark, { w: 100, h: 26 })}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="empty">해당 색상으로 표시한 항목이 없습니다.</td></tr>'}
  </tbody></table></div><p class="small muted">색상 점을 누르면 빨강→주황→노랑→초록→파랑→없음 순서로 바뀝니다.</p>` : '<div class="empty">시세를 불러오지 못했습니다.</div>';

  root.querySelectorAll('[data-color]').forEach((b) => {
    b.onclick = () => {
      const s = b.dataset.color;
      const order = COLORS.map((c) => c[0]);
      const next = order[(order.indexOf(colors[s] || '') + 1) % order.length];
      updateQuiet('ranking', (r) => { r.colors = { ...(r.colors || {}) }; if (next) r.colors[s] = next; else delete r.colors[s]; });
      b.querySelector('.dot').style.background = colorHex(next);
      colors[s] = next;
    };
  });
  root.querySelector('#rk-csv').onclick = () => {
    download(`랭킹-${country}-${mode}-${period}-${today()}.csv`, toCsv([['순위', '직전순위', '티커', '이름', `${label}(%)`, `직전${label}(%)`, '가격', '색상'],
      ...rows.map((r) => [r.rank, r.prevRank || '', r.s, r.n, r.ret?.toFixed(2), r.prev?.toFixed(2) ?? '', r.price, r.color])]), 'text/csv');
  };
}
