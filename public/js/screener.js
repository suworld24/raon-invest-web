// 기업 스크리너: 미국 상장 종목 필터 · 정렬 · CSV · 조건 저장 · 기업 비교
import { state, update, updateQuiet, market, watchAll, toggleWatch, esc, fmtNum, fmtPct, fmtCap, cls, download, toCsv, today, openModal, toast } from './core.js';
import { sparkline } from './charts.js';
import { openStockModal } from './stock.js';

const PAGE = 100;
const CAPS = [
  ['mega', '메가캡 · $200B 이상', 200e9, Infinity],
  ['large', '라지캡 · $10B–200B', 10e9, 200e9],
  ['mid', '미드캡 · $2B–10B', 2e9, 10e9],
  ['small', '스몰캡 · $300M–2B', 300e6, 2e9],
  ['micro', '마이크로 이하 · $300M 미만', 1, 300e6],
  ['none', '시가총액 미확보', 0, 0],
];
const blankFilter = () => ({ q: '', sec: '', ex: '', cap: '', ctry: '', pmin: '', pmax: '', chgMin: '', chgMax: '', watchOnly: false, perfPeriod: '3mo', perfMin: '' });

let f = blankFilter();
let sort = { key: 'mc', dir: -1 };
let page = 0;
let view = 'overview';
const compare = new Set();
const perf = new Map(); // sym -> {m1,m3,m6,ytd,y1,spark}

function perfOf(h) {
  if (!h || h.c.length < 2) return null;
  const last = h.c[h.c.length - 1];
  const lastDate = h.t[h.t.length - 1];
  const back = (days) => {
    const target = new Date(Date.parse(lastDate) - days * 864e5).toISOString().slice(0, 10);
    let i = h.t.findIndex((d) => d >= target);
    if (i < 0) return null;
    if (i > 0 && h.t[i] > target) i--;
    return h.c[i] ? (last / h.c[i] - 1) * 100 : null;
  };
  const y0 = lastDate.slice(0, 4) + '-01-01';
  const yi = h.t.findIndex((d) => d >= y0);
  const ytd = yi > 0 ? (last / h.c[yi - 1] - 1) * 100 : yi === 0 ? (last / h.c[0] - 1) * 100 : null;
  return { m1: back(30), m3: back(91), m6: back(182), ytd, y1: back(365), spark: h.c.slice(-90) };
}

function applyFilter(rows) {
  const q = f.q.trim().toLowerCase();
  const cap = CAPS.find((c) => c[0] === f.cap);
  const watch = new Set(watchAll());
  const num = (v) => (v === '' || v == null ? null : +v);
  const pmin = num(f.pmin), pmax = num(f.pmax), cmin = num(f.chgMin), cmax = num(f.chgMax), perfMin = num(f.perfMin);
  return rows.filter((r) => {
    if (q && !r.s.toLowerCase().startsWith(q) && !r.n.toLowerCase().includes(q) && !r.ind.toLowerCase().includes(q)) return false;
    if (f.sec && r.sec !== f.sec) return false;
    if (f.ex && r.ex !== f.ex) return false;
    if (f.ctry === 'US' && r.ctry !== 'United States') return false;
    if (f.ctry === 'NONUS' && r.ctry === 'United States') return false;
    if (cap) {
      if (cap[0] === 'none') { if (r.mc) return false; } else if (!(r.mc >= cap[2] && r.mc < cap[3])) return false;
    }
    if (pmin != null && !(r.p >= pmin)) return false;
    if (pmax != null && !(r.p <= pmax)) return false;
    if (cmin != null && !(r.chg >= cmin)) return false;
    if (cmax != null && !(r.chg <= cmax)) return false;
    if (f.watchOnly && !watch.has(r.s)) return false;
    if (perfMin != null && view === 'performance') {
      const p = perf.get(r.s);
      const key = { '1mo': 'm1', '3mo': 'm3', '6mo': 'm6', ytd: 'ytd', '1y': 'y1' }[f.perfPeriod];
      if (p && !(p[key] >= perfMin)) return false;
    }
    return true;
  });
}

const COLS_OVERVIEW = [
  ['s', '티커'], ['n', '기업명'], ['sec', '업종'], ['ind', '산업'], ['mc', '시총 ($)', 1], ['p', '가격 ($)', 1], ['chg', '일간 (%)', 1], ['vol', '거래량', 1],
];
const COLS_PERF = [
  ['s', '티커'], ['n', '기업명'], ['p', '가격 ($)', 1], ['chg', '1일', 1], ['m1', '1개월', 1], ['m3', '3개월', 1], ['m6', '6개월', 1], ['ytd', 'YTD', 1], ['y1', '12개월', 1], ['spark', '최근 3개월'],
];

// 밸류에이션 · 재무 · 컨센서스 · 내부자 보기 (현재 페이지 종목만 불러옴)
const FVIEWS = {
  valuation: [['pe', 'PER'], ['fpe', '선행 PER'], ['pb', 'PBR'], ['ps', 'PSR'], ['evEbitda', 'EV/EBITDA'], ['peg', 'PEG'], ['div', '배당수익률']],
  financial: [['rev', '매출 (TTM)'], ['revG', '매출성장'], ['earnG', '이익성장'], ['gm', '매출총이익률'], ['om', '영업이익률'], ['nm', '순이익률'], ['roe', 'ROE'], ['de', '부채비율']],
  consensus: [['tgt', '목표가 ($)'], ['upside', '괴리율'], ['nAnalyst', '애널리스트'], ['rec', '의견 (1=강력매수)'], ['epsEst', '다음 EPS 예상'], ['nextEarn', '다음 실적일']],
  insider: [['insBuy', '6개월 매수'], ['insSell', '6개월 매도'], ['insNet', '순매수 금액'], ['insiderPct', '내부자 지분'], ['instPct', '기관 지분']],
};
const VIEW_LABEL = { overview: '개요', performance: '수익률', valuation: '밸류에이션', financial: '재무', consensus: '컨센서스', insider: '내부자' };
const PCT_KEYS = new Set(['div', 'revG', 'earnG', 'gm', 'om', 'nm', 'roe', 'insiderPct', 'instPct']);
const FKEYS = new Set(Object.values(FVIEWS).flat().map((c) => c[0]));
const fund = new Map(); // sym -> fundamentals | null

function fval(sym, key) {
  const f = fund.get(sym);
  if (!f) return null;
  if (key === 'upside') return f.tgt && f.price ? (f.tgt / f.price - 1) * 100 : null;
  if (key === 'insBuy') return f.ins6m?.buyN ?? null;
  if (key === 'insSell') return f.ins6m?.sellN ?? null;
  if (key === 'insNet') return f.ins6m ? f.ins6m.buyV - f.ins6m.sellV : null;
  return f[key] ?? null;
}
function fcell(sym, key) {
  const v = fval(sym, key);
  if (v == null || v === '') return '<td class="num muted">—</td>';
  if (PCT_KEYS.has(key)) return `<td class="num ${['revG', 'earnG'].includes(key) ? cls(v) : ''}">${fmtPct(v * 100, 1, ['revG', 'earnG'].includes(key))}</td>`;
  if (key === 'upside') return `<td class="num ${cls(v)}">${fmtPct(v, 1)}</td>`;
  if (key === 'rev' || key === 'insNet') return `<td class="num ${key === 'insNet' ? cls(v) : ''}">${v < 0 ? '-' : ''}$${fmtCap(Math.abs(v)) === '—' ? '0' : fmtCap(Math.abs(v))}</td>`;
  if (key === 'de') return `<td class="num">${v.toFixed(0)}%</td>`;
  if (key === 'nextEarn') return `<td class="num">${esc(v)}</td>`;
  if (['nAnalyst', 'insBuy', 'insSell'].includes(key)) return `<td class="num">${v}</td>`;
  return `<td class="num">${v.toFixed(key === 'tgt' || key === 'epsEst' || key === 'rec' || key === 'peg' ? 2 : 1)}</td>`;
}

function sortVal(r, key) {
  if (['m1', 'm3', 'm6', 'ytd', 'y1'].includes(key)) return perf.get(r.s)?.[key] ?? null;
  if (FKEYS.has(key)) return fval(r.s, key);
  return r[key];
}

export async function render(root) {
  root.innerHTML = '<div class="card"><div class="empty">미국 상장 종목 목록을 불러오는 중입니다… (처음 한 번은 10초 정도 걸릴 수 있어요)</div></div>';
  let data;
  try { data = await market.screener(); } catch {
    root.innerHTML = '<div class="card"><div class="empty">종목 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</div></div>';
    return;
  }
  const rows = data.rows;
  const sectors = [...new Set(rows.map((r) => r.sec).filter(Boolean))].sort();
  const exes = [...new Set(rows.map((r) => r.ex))];
  const presets = state.screener.presets || {};
  root.innerHTML = `
  <div class="card">
    <div class="card-head"><h2>조건</h2>
      <select id="sc-preset"><option value="">저장한 조건</option>${Object.keys(presets).map((k) => `<option>${esc(k)}</option>`).join('')}</select>
      <button class="btn btn-sm" id="sc-save">현재 조건 저장</button>
      <button class="btn btn-sm btn-danger" id="sc-del">조건 삭제</button>
      <button class="btn btn-sm" id="sc-reset">조건 초기화</button>
    </div>
    <div class="toolbar">
      <input id="f-q" placeholder="티커·기업명·산업 검색" value="${esc(f.q)}" style="width:220px">
      <select id="f-sec"><option value="">모든 업종</option>${sectors.map((s) => `<option ${f.sec === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="f-ex"><option value="">모든 거래소</option>${exes.map((s) => `<option ${f.ex === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="f-cap"><option value="">모든 시가총액</option>${CAPS.map((c) => `<option value="${c[0]}" ${f.cap === c[0] ? 'selected' : ''}>${c[1]}</option>`).join('')}</select>
      <select id="f-ctry"><option value="">모든 국가</option><option value="US" ${f.ctry === 'US' ? 'selected' : ''}>미국 기업</option><option value="NONUS" ${f.ctry === 'NONUS' ? 'selected' : ''}>해외 기업(ADR 등)</option></select>
    </div>
    <div class="toolbar" style="margin-top:8px">
      <span class="small muted">가격 $</span><input id="f-pmin" type="number" placeholder="최소" value="${esc(f.pmin)}" style="width:80px">~<input id="f-pmax" type="number" placeholder="최대" value="${esc(f.pmax)}" style="width:80px">
      <span class="small muted">일간 %</span><input id="f-cmin" type="number" placeholder="최소" value="${esc(f.chgMin)}" style="width:80px">~<input id="f-cmax" type="number" placeholder="최대" value="${esc(f.chgMax)}" style="width:80px">
      <label class="chip ${f.watchOnly ? 'on' : ''}"><input type="checkbox" id="f-watch" ${f.watchOnly ? 'checked' : ''}> ★ 관심종목만 (${watchAll().length})</label>
      <span id="perf-filter" ${view === 'performance' ? '' : 'hidden'} class="toolbar"><span class="small muted">상승률</span>
        <select id="f-pp">${[['1mo', '1개월'], ['3mo', '3개월'], ['6mo', '6개월'], ['ytd', 'YTD'], ['1y', '12개월']].map(([v, l]) => `<option value="${v}" ${f.perfPeriod === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input id="f-pmin2" type="number" placeholder="% 이상" value="${esc(f.perfMin)}" style="width:80px"></span>
    </div>
  </div>
  <div class="card">
    <div class="card-head">
      <div class="seg" id="sc-view" style="flex-wrap:wrap">${Object.entries(VIEW_LABEL).map(([v, l]) => `<button data-v="${v}" class="${view === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="small muted" id="sc-count"></span>
      <span style="flex:1"></span>
      <button class="btn btn-sm" id="sc-compare">나란히 비교 (<span id="cmp-n">${compare.size}</span>/5)</button>
      <button class="btn btn-sm" id="sc-csv">조회 결과 CSV 저장</button>
    </div>
    <div id="sc-table"></div>
    <p class="small muted">자료: Nasdaq 상장 종목 목록 (갱신 ${esc(new Date(data.updatedAt).toLocaleString('ko-KR'))}) · 수익률·밸류에이션·재무·컨센서스·내부자 보기는 현재 페이지 종목의 자료를 Yahoo Finance에서 불러오며, 정렬은 불러온 종목 기준입니다. 티커를 누르면 종목 상세가 열립니다.</p>
  </div>`;

  const bindInput = (id, key, ev = 'input') => {
    const el = root.querySelector(id);
    el.addEventListener(ev, () => { f[key] = el.type === 'checkbox' ? el.checked : el.value; page = 0; if (el.type === 'checkbox') el.parentElement.classList.toggle('on', el.checked); drawTable(root, rows); });
  };
  bindInput('#f-q', 'q'); bindInput('#f-sec', 'sec', 'change'); bindInput('#f-ex', 'ex', 'change'); bindInput('#f-cap', 'cap', 'change'); bindInput('#f-ctry', 'ctry', 'change');
  bindInput('#f-pmin', 'pmin'); bindInput('#f-pmax', 'pmax'); bindInput('#f-cmin', 'chgMin'); bindInput('#f-cmax', 'chgMax'); bindInput('#f-watch', 'watchOnly', 'change');
  bindInput('#f-pp', 'perfPeriod', 'change'); bindInput('#f-pmin2', 'perfMin');
  root.querySelectorAll('#sc-view button').forEach((b) => {
    b.onclick = () => { view = b.dataset.v; root.querySelectorAll('#sc-view button').forEach((x) => x.classList.toggle('on', x === b)); root.querySelector('#perf-filter').hidden = view !== 'performance'; drawTable(root, rows); };
  });
  root.querySelector('#sc-reset').onclick = () => { f = blankFilter(); page = 0; render(root); };
  root.querySelector('#sc-preset').onchange = (e) => { const p = presets[e.target.value]; if (p) { f = { ...blankFilter(), ...p }; page = 0; render(root); } };
  root.querySelector('#sc-save').onclick = () => openModal({
    title: '현재 조건 저장',
    body: '<label class="field">조건 이름<input name="name" required placeholder="예: 대형 기술주"></label>',
    onSubmit(d) {
      const name = d.name.trim();
      if (!name) throw new Error('이름을 입력하세요.');
      update('screener', (s) => { s.presets = { ...(s.presets || {}), [name]: { ...f } }; }, '스크리너 조건 저장');
      render(root);
    },
  });
  root.querySelector('#sc-del').onclick = () => {
    const name = root.querySelector('#sc-preset').value;
    if (!name) return toast('삭제할 저장 조건을 먼저 고르세요.');
    update('screener', (s) => { const p = { ...(s.presets || {}) }; delete p[name]; s.presets = p; }, '스크리너 조건 삭제');
    render(root);
  };
  root.querySelector('#sc-csv').onclick = () => {
    const list = sorted(applyFilter(rows));
    const out = [['티커', '기업명', '거래소', '업종', '산업', '국가', '시가총액($)', '가격($)', '일간(%)', '거래량', '1개월(%)', '3개월(%)', '6개월(%)', 'YTD(%)', '12개월(%)'],
      ...list.map((r) => { const p = perf.get(r.s) || {}; return [r.s, r.n, r.ex, r.sec, r.ind, r.ctry, r.mc, r.p, r.chg, r.vol, p.m1?.toFixed(2), p.m3?.toFixed(2), p.m6?.toFixed(2), p.ytd?.toFixed(2), p.y1?.toFixed(2)]; })];
    download(`스크리너-${today()}.csv`, toCsv(out), 'text/csv');
  };
  root.querySelector('#sc-compare').onclick = () => compareModal();
  drawTable(root, rows);
}

function sorted(list) {
  const { key, dir } = sort;
  return list.slice().sort((a, b) => {
    const va = sortVal(a, key), vb = sortVal(b, key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir;
  });
}

async function drawTable(root, rows) {
  const el = root.querySelector('#sc-table');
  const list = sorted(applyFilter(rows));
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  page = Math.min(page, pages - 1);
  const slice = list.slice(page * PAGE, page * PAGE + PAGE);
  root.querySelector('#sc-count').textContent = `${fmtNum(list.length)}개 종목 · 열 제목을 눌러 정렬`;
  const watch = new Set(watchAll());
  const fv = FVIEWS[view];
  const cols = view === 'overview' ? COLS_OVERVIEW : view === 'performance' ? COLS_PERF : [['s', '티커'], ['n', '기업명'], ['p', '가격 ($)', 1], ...fv.map(([k, l]) => [k, l, 1])];
  const pc = (v) => `<td class="num ${cls(v)}">${fmtPct(v)}</td>`;
  el.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th></th>${cols.map(([k, l, n]) => `<th class="sortable ${n ? 'num' : ''}" data-k="${k}">${l} ${sort.key === k ? (sort.dir > 0 ? '▲' : '▼') : ''}</th>`).join('')}</tr></thead><tbody>
    ${slice.map((r) => {
      const p = perf.get(r.s);
      const first = `<td style="white-space:nowrap"><input type="checkbox" data-cmp="${esc(r.s)}" ${compare.has(r.s) ? 'checked' : ''} title="비교에 추가"></td>`;
      if (view === 'overview') {
        return `<tr>${first}<td class="sym"><button class="star ${watch.has(r.s) ? 'on' : ''}" data-star="${esc(r.s)}" title="관심종목">${watch.has(r.s) ? '★' : '☆'}</button>${esc(r.s)}</td>
          <td><div>${esc(r.n)}</div><div class="sub">${esc(r.ctry)} · ${esc(r.ex)}</div></td><td>${esc(r.sec || '—')}</td><td class="sub">${esc(r.ind || '—')}</td>
          <td class="num">${fmtCap(r.mc)}</td><td class="num">${fmtNum(r.p, 2)}</td><td class="num ${cls(r.chg)}">${fmtPct(r.chg)}</td><td class="num">${fmtCap(r.vol)}</td></tr>`;
      }
      if (fv) {
        return `<tr>${first}<td class="sym"><button class="star ${watch.has(r.s) ? 'on' : ''}" data-star="${esc(r.s)}">${watch.has(r.s) ? '★' : '☆'}</button>${esc(r.s)}</td><td>${esc(r.n)}</td>
          <td class="num">${fmtNum(r.p, 2)}</td>${fund.has(r.s) ? fv.map(([k]) => fcell(r.s, k)).join('') : `<td colspan="${fv.length}" class="muted small">불러오는 중…</td>`}</tr>`;
      }
      return `<tr>${first}<td class="sym"><button class="star ${watch.has(r.s) ? 'on' : ''}" data-star="${esc(r.s)}">${watch.has(r.s) ? '★' : '☆'}</button>${esc(r.s)}</td><td>${esc(r.n)}</td>
        <td class="num">${fmtNum(r.p, 2)}</td>${pc(r.chg)}${p ? pc(p.m1) + pc(p.m3) + pc(p.m6) + pc(p.ytd) + pc(p.y1) + `<td>${sparkline(p.spark)}</td>` : '<td colspan="6" class="muted small">불러오는 중…</td>'}</tr>`;
    }).join('') || `<tr><td colspan="${cols.length + 1}" class="empty">조건에 맞는 종목이 없습니다.</td></tr>`}
  </tbody></table></div>
  <div class="pager"><button class="btn btn-sm" data-pg="-1" ${page === 0 ? 'disabled' : ''}>이전</button><span>${page + 1} / ${pages}</span><button class="btn btn-sm" data-pg="1" ${page >= pages - 1 ? 'disabled' : ''}>다음</button></div>`;

  el.querySelectorAll('th.sortable').forEach((th) => {
    th.onclick = () => { const k = th.dataset.k; if (k === 'spark') return; sort = sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: ['s', 'n', 'sec', 'ind'].includes(k) ? 1 : -1 }; drawTable(root, rows); };
  });
  el.querySelectorAll('[data-pg]').forEach((b) => { b.onclick = () => { page += +b.dataset.pg; drawTable(root, rows); root.querySelector('#sc-table').scrollIntoView({ block: 'start' }); }; });
  el.querySelectorAll('[data-star]').forEach((b) => {
    b.onclick = () => {
      const s = b.dataset.star;
      const on = toggleWatch(s);
      b.classList.toggle('on', on); b.textContent = on ? '★' : '☆';
    };
  });
  el.querySelectorAll('[data-cmp]').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) { if (compare.size >= 5) { cb.checked = false; return toast('최대 5개까지 비교할 수 있습니다.'); } compare.add(cb.dataset.cmp); } else compare.delete(cb.dataset.cmp);
      root.querySelector('#cmp-n').textContent = compare.size;
    };
  });

  el.querySelectorAll('td.sym').forEach((td) => {
    td.style.cursor = 'pointer';
    td.title = '종목 상세 보기';
    td.addEventListener('click', (e) => { if (!e.target.closest('[data-star]')) openStockModal(td.closest('tr').querySelector('[data-cmp]').dataset.cmp); });
  });

  if (fv) {
    const need = slice.map((r) => r.s).filter((s) => !fund.has(s));
    if (need.length) {
      const d = await market.fundamentals(need);
      need.forEach((s) => fund.set(s, d[s]));
      if (root.isConnected && FVIEWS[view]) drawTable(root, rows);
    }
  }

  if (view === 'performance') {
    const need = slice.map((r) => r.s).filter((s) => !perf.has(s));
    if (need.length) {
      const h = await market.history(need, '1y');
      need.forEach((s) => perf.set(s, perfOf(h[s]) || { m1: null, m3: null, m6: null, ytd: null, y1: null, spark: [] }));
      if (root.isConnected && view === 'performance') drawTable(root, rows);
    }
  }
}

async function compareModal() {
  if (compare.size < 2) return toast('목록에서 2~5개 기업을 체크하세요.');
  const syms = [...compare];
  const h = await market.history(syms, '1y');
  syms.forEach((s) => { if (!perf.has(s)) perf.set(s, perfOf(h[s]) || {}); });
  const rows = syms.map((s) => market.lookup(s) || { s, n: s });
  const line = (label, fn) => `<tr><td>${label}</td>${rows.map((r) => `<td class="num">${fn(r)}</td>`).join('')}</tr>`;
  const pc = (v) => `<span class="${cls(v)}">${fmtPct(v)}</span>`;
  openModal({
    title: '기업 비교',
    wide: true,
    body: `<div class="table-wrap"><table class="tbl compare"><thead><tr><th></th>${rows.map((r) => `<th class="num">${esc(r.s)}</th>`).join('')}</tr></thead><tbody>
      ${line('기업명', (r) => esc(r.n))}${line('업종', (r) => esc(r.sec || '—'))}${line('산업', (r) => `<span class="sub">${esc(r.ind || '—')}</span>`)}
      ${line('시가총액', (r) => fmtCap(r.mc))}${line('가격 ($)', (r) => fmtNum(r.p, 2))}${line('일간', (r) => pc(r.chg))}
      ${line('1개월', (r) => pc(perf.get(r.s)?.m1))}${line('3개월', (r) => pc(perf.get(r.s)?.m3))}${line('6개월', (r) => pc(perf.get(r.s)?.m6))}
      ${line('YTD', (r) => pc(perf.get(r.s)?.ytd))}${line('12개월', (r) => pc(perf.get(r.s)?.y1))}
      ${line('최근 3개월', (r) => sparkline(perf.get(r.s)?.spark || []))}
    </tbody></table></div>`,
    extraButtons: '<button type="button" class="btn" data-clear>선택 비우기</button>',
    onOpen(form, close) { form.querySelector('[data-clear]').onclick = () => { compare.clear(); close(); document.querySelectorAll('[data-cmp]').forEach((c) => { c.checked = false; }); const n = document.getElementById('cmp-n'); if (n) n.textContent = 0; }; },
  });
}
