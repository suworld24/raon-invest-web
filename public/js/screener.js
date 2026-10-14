// 기업 스크리너: 미국 상장 종목 · 기본/세부 필터 · 6개 보기 · 정렬 · CSV · 조건 저장 · 기업 비교
import { state, update, market, watchAll, toggleWatch, esc, fmtNum, fmtPct, fmtCap, cls, download, toCsv, today, openModal, toast } from './core.js';
import { loadMetrics, row, derive, statusBadge, maCell, alignCell } from './metrics.js';
import { openStockModal } from './stock.js';

const PAGE = 100;
const CAPS = [
  ['mega', '메가캡 · $200B 이상', 200e9, Infinity], ['large', '라지캡 · $10B–200B', 10e9, 200e9], ['mid', '미드캡 · $2B–10B', 2e9, 10e9],
  ['small', '스몰캡 · $300M–2B', 300e6, 2e9], ['micro', '마이크로 이하 · $300M 미만', 1, 300e6], ['none', '시가총액 미확보', 0, 0],
];
const RET_KEYS = [['d1', '일간'], ['w1', '주간'], ['m1', '1개월'], ['m3', '3개월'], ['m6', '6개월'], ['y1', '12개월'], ['ytd', 'YTD']];
const VOL_KEYS = [['vol', '일간 거래량'], ['av10', '10일 평균'], ['av30', '30일 평균'], ['av60', '60일 평균'], ['av90', '90일 평균']];
const VIEWS = { overview: '개요', performance: 'Performance', valuation: 'Valuation', financial: 'Financial', consensus: 'Consensus', insider: 'Insider' };
const STATES = ['흑자 유지', '흑자전환', '적자축소', '적자확대', '적자전환'];

const blank = () => ({
  q: '', sec: '', ex: '', cap: '', ctry: '', watchOnly: false,
  retK: 'm3', retMin: '', retMax: '', align: '', rsiK: 'rsiD', rsiMin: '', rsiMax: '', volA: 'av10', volB: 'av90', volPct: '', st: '', hiMin: '',
  perK: 'perTTM', perMin: '', perMax: '', pegK: 'pegNTM', pegMin: '', pegMax: '', pbrMin: '', pbrMax: '',
  rg0Min: '', rg0Max: '', rg1Min: '', rg1Max: '', eg0Min: '', eg0Max: '', eg1Min: '', eg1Max: '', st0: [], st1: [],
  c0On: false, c0Min: '', c1On: false, c1Min: '', cWin: '30',
  insWin: '91', insSide: '', insMin: '',
});

let f = blank();
let sort = { key: 'mc', dir: -1 };
let page = 0;
let view = 'overview';
let retCol = 'm3', volCol = 'av30', rsiCol = 'rsiD';
let filtersOpen = false;
const compare = new Set();
let M = { rows: {} };

const num = (v) => (v === '' || v == null ? null : +v);
const inRange = (v, a, b) => { const lo = num(a), hi = num(b); if (lo == null && hi == null) return true; if (v == null) return false; return (lo == null || v >= lo) && (hi == null || v <= hi); };

function ext(r) { // 기본 행 + 지표
  if (r._x) return r._x;
  const m = row(M, r.s);
  const d = derive(m);
  r._x = { t: m.t || {}, f: m.f || {}, d, has: !!m.t };
  return r._x;
}
function insW(r) { return ext(r).f.ins?.[f.insWin] || null; }

function value(r, key) {
  const { t, f: fu, d } = ext(r);
  switch (key) {
    case 's': case 'n': case 'sec': case 'ind': case 'ex': return r[key];
    case 'mc': return r.mc; case 'p': return t.p ?? r.p; case 'chg': return t.d1 ?? r.chg;
    case 'ret': return t[retCol]; case 'volc': return t[volCol] ?? (volCol === 'vol' ? r.vol : null);
    case 'rsi': return t[rsiCol]; case 'al': return t.al; case 'st': return ['위험', '경계', '주의', '양호'].indexOf(t.st);
    case 'fromLo': case 'fromHi': return t[key];
    case 'insBuyD': return insW(r)?.lb || null; case 'insSellD': return insW(r)?.ls || null;
    case 'insBuyV': return insW(r)?.bV ?? null; case 'insSellV': return insW(r)?.sV ?? null;
    case 'nA': return fu.y0?.nA ?? fu.nAnalyst ?? null;
    default: if (key in d) return d[key]; if (key in t) return t[key]; return fu[key] ?? null;
  }
}

function applyFilter(rows) {
  const q = f.q.trim().toLowerCase();
  const cap = CAPS.find((c) => c[0] === f.cap);
  const watch = new Set(watchAll());
  return rows.filter((r) => {
    if (q && !r.s.toLowerCase().startsWith(q) && !r.n.toLowerCase().includes(q) && !r.ind.toLowerCase().includes(q) && !r.sec.toLowerCase().includes(q)) return false;
    if (f.sec && r.sec !== f.sec) return false;
    if (f.ex && r.ex !== f.ex) return false;
    if (f.ctry === 'US' && r.ctry !== 'United States') return false;
    if (f.ctry === 'NONUS' && r.ctry === 'United States') return false;
    if (cap) { if (cap[0] === 'none') { if (r.mc) return false; } else if (!(r.mc >= cap[2] && r.mc < cap[3])) return false; }
    if (f.watchOnly && !watch.has(r.s)) return false;
    const { t, d } = ext(r);
    // Performance
    if (!inRange(t[f.retK], f.retMin, f.retMax)) return false;
    if (f.align === 'O' && t.al !== 1) return false;
    if (f.align === 'X' && t.al !== 0) return false;
    if (!inRange(t[f.rsiK], f.rsiMin, f.rsiMax)) return false;
    if (num(f.volPct) != null) { const a = t[f.volA], b = t[f.volB]; if (!a || !b || (a / b - 1) * 100 < +f.volPct) return false; }
    if (f.st && t.st !== f.st) return false;
    if (num(f.hiMin) != null && !(t.fromHi != null && t.fromHi >= +f.hiMin)) return false;
    // Valuation
    if (!inRange(d[f.perK], f.perMin, f.perMax)) return false;
    if (!inRange(d[f.pegK], f.pegMin, f.pegMax)) return false;
    if (!inRange(d.pbr, f.pbrMin, f.pbrMax)) return false;
    // Financial
    if (!inRange(d.revG0, f.rg0Min, f.rg0Max) || !inRange(d.revG1, f.rg1Min, f.rg1Max)) return false;
    if (!inRange(d.epsG0, f.eg0Min, f.eg0Max) || !inRange(d.epsG1, f.eg1Min, f.eg1Max)) return false;
    if (f.st0.length && !f.st0.includes(d.st0)) return false;
    if (f.st1.length && !f.st1.includes(d.st1)) return false;
    // Consensus
    if (f.c0On && !(d[`rev${f.cWin}_0`] != null && d[`rev${f.cWin}_0`] >= (num(f.c0Min) ?? 0.0001))) return false;
    if (f.c1On && !(d[`rev${f.cWin}_1`] != null && d[`rev${f.cWin}_1`] >= (num(f.c1Min) ?? 0.0001))) return false;
    // Insider
    if (f.insSide || num(f.insMin) != null) {
      const w = insW(r);
      if (!w) return false;
      const minV = num(f.insMin) || 0;
      const buy = w.bN > 0 && w.bV >= minV, sell = w.sN > 0 && w.sV >= minV;
      if (f.insSide === 'buy' && !buy) return false;
      if (f.insSide === 'sell' && !sell) return false;
      if ((f.insSide === 'any' || (!f.insSide && minV)) && !buy && !sell) return false;
    }
    return true;
  });
}

function activeFilterCount() {
  const b = blank();
  return Object.keys(b).filter((k) => !['q', 'sec', 'ex', 'cap', 'ctry', 'watchOnly', 'retK', 'rsiK', 'volA', 'volB', 'perK', 'pegK', 'cWin', 'insWin'].includes(k))
    .filter((k) => (Array.isArray(b[k]) ? f[k].length : f[k] !== b[k])).length;
}

const opt = (list, val) => list.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
const rng = (a, b, ph = ['최소', '최대']) => `<input type="number" step="any" data-f="${a}" value="${esc(f[a])}" placeholder="${ph[0]}" style="width:80px"> ~ <input type="number" step="any" data-f="${b}" value="${esc(f[b])}" placeholder="${ph[1]}" style="width:80px">`;
const chk = (key, list) => list.map((s) => `<label class="chip ${f[key].includes(s) ? 'on' : ''}"><input type="checkbox" data-arr="${key}" value="${s}" ${f[key].includes(s) ? 'checked' : ''}> ${s}</label>`).join('');

function filtersHtml() {
  return `
  <details ${filtersOpen ? 'open' : ''} id="sc-adv" style="margin-top:10px"><summary class="small"><b>세부 필터조건</b> <span class="muted" id="adv-count">${activeFilterCount() ? activeFilterCount() + '개 적용' : '없음'}</span></summary>
  <div class="grid-2" style="margin-top:10px">
    <fieldset class="card" style="padding:12px"><legend class="small"><b>Performance</b></legend>
      <div class="toolbar"><span class="small muted">상승률 %</span><select data-f="retK">${opt(RET_KEYS.slice(1), f.retK)}</select>${rng('retMin', 'retMax')}</div>
      <div class="toolbar" style="margin-top:6px"><span class="small muted">주봉 정배열</span><select data-f="align">${opt([['', '전체'], ['O', '정배열 O'], ['X', '정배열 X']], f.align)}</select>
        <span class="small muted">이평선 상태</span><select data-f="st">${opt([['', '전체'], ['양호', '양호'], ['주의', '주의'], ['경계', '경계'], ['위험', '이탈위험']], f.st)}</select></div>
      <div class="toolbar" style="margin-top:6px"><span class="small muted">RSI(14)</span><select data-f="rsiK">${opt([['rsiD', '일봉'], ['rsiW', '주봉']], f.rsiK)}</select>${rng('rsiMin', 'rsiMax')}</div>
      <div class="toolbar" style="margin-top:6px"><span class="small muted">평균 거래량 증가</span><select data-f="volA">${opt(VOL_KEYS.slice(1), f.volA)}</select>이 <select data-f="volB">${opt(VOL_KEYS.slice(1), f.volB)}</select> 대비 <input type="number" data-f="volPct" value="${esc(f.volPct)}" placeholder="%" style="width:70px">% 이상</div>
      <div class="toolbar" style="margin-top:6px"><span class="small muted">52주 신고가 대비</span><input type="number" data-f="hiMin" value="${esc(f.hiMin)}" placeholder="예: -10" style="width:80px">% 이상</div>
    </fieldset>
    <fieldset class="card" style="padding:12px"><legend class="small"><b>Valuation</b></legend>
      <div class="toolbar"><span class="small muted">PER</span><select data-f="perK">${opt([['perTTM', 'TTM'], ['perNTM', 'NTM'], ['perFY', 'FY'], ['perFY1', 'FY+1']], f.perK)}</select>${rng('perMin', 'perMax')}</div>
      <div class="toolbar" style="margin-top:6px"><span class="small muted">PEG</span><select data-f="pegK">${opt([['pegTTM', 'TTM'], ['pegNTM', 'NTM'], ['pegFY', 'FY'], ['pegFY1', 'FY+1']], f.pegK)}</select>${rng('pegMin', 'pegMax')}</div>
      <div class="toolbar" style="margin-top:6px"><span class="small muted">PBR</span>${rng('pbrMin', 'pbrMax')}</div>
    </fieldset>
    <fieldset class="card" style="padding:12px"><legend class="small"><b>Financial</b></legend>
      <div class="toolbar"><span class="small muted">올해 매출 성장률 %</span>${rng('rg0Min', 'rg0Max')}</div>
      <div class="toolbar" style="margin-top:6px"><span class="small muted">내년 매출 성장률 %</span>${rng('rg1Min', 'rg1Max')}</div>
      <div class="toolbar" style="margin-top:6px"><span class="small muted">올해 EPS 성장률 %</span>${rng('eg0Min', 'eg0Max')}</div>
      <div class="toolbar" style="margin-top:4px">${chk('st0', STATES)}</div>
      <div class="toolbar" style="margin-top:6px"><span class="small muted">내년 EPS 성장률 %</span>${rng('eg1Min', 'eg1Max')}</div>
      <div class="toolbar" style="margin-top:4px">${chk('st1', STATES)}</div>
    </fieldset>
    <fieldset class="card" style="padding:12px"><legend class="small"><b>Consensus</b></legend>
      <div class="toolbar"><span class="small muted">비교 기간</span><select data-f="cWin">${opt([['30', '30일 전 대비'], ['90', '90일 전 대비']], f.cWin)}</select></div>
      <div class="toolbar" style="margin-top:6px"><label class="chip ${f.c0On ? 'on' : ''}"><input type="checkbox" data-f="c0On" ${f.c0On ? 'checked' : ''}> FY (올해) EPS 상향된 기업</label><input type="number" step="any" data-f="c0Min" value="${esc(f.c0Min)}" placeholder="최소 %" style="width:80px">% 이상</div>
      <div class="toolbar" style="margin-top:6px"><label class="chip ${f.c1On ? 'on' : ''}"><input type="checkbox" data-f="c1On" ${f.c1On ? 'checked' : ''}> FY+1 (내년) EPS 상향된 기업</label><input type="number" step="any" data-f="c1Min" value="${esc(f.c1Min)}" placeholder="최소 %" style="width:80px">% 이상</div>
      <p class="small muted">두 연도를 체크하면 모두 충족한 기업만 찾습니다. 애널리스트 평균 EPS 추정치의 변화율입니다.</p>
    </fieldset>
    <fieldset class="card" style="padding:12px"><legend class="small"><b>Insider</b></legend>
      <div class="toolbar"><span class="small muted">거래 기간</span><select data-f="insWin">${opt([['7', '1주 이내'], ['30', '1개월 이내'], ['91', '3개월 이내'], ['182', '6개월 이내'], ['365', '12개월 이내']], f.insWin)}</select>
        <span class="small muted">매수·매도</span><select data-f="insSide">${opt([['', '전체'], ['buy', '매수 있음'], ['sell', '매도 있음'], ['any', '매수 또는 매도 있음']], f.insSide)}</select></div>
      <div class="toolbar" style="margin-top:6px"><span class="small muted">최소 거래금액 (USD)</span><input type="number" data-f="insMin" value="${esc(f.insMin)}" placeholder="예: 100000" style="width:120px"> 이상</div>
      <p class="small muted">SEC 공시(Form 4) 기준 장내 매수·매도만 셉니다. 스톡옵션 행사·증여는 제외합니다.</p>
    </fieldset>
  </div></details>`;
}

export async function render(root) {
  root.innerHTML = '<div class="card"><div class="empty">종목 목록과 지표를 불러오는 중입니다…</div></div>';
  let data;
  try { [data, M] = await Promise.all([market.screener(), loadMetrics().catch(() => ({ rows: {} }))]); } catch {
    root.innerHTML = '<div class="card"><div class="empty">종목 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</div></div>';
    return;
  }
  data.rows.forEach((r) => { delete r._x; });
  const rows = data.rows;
  const sectors = [...new Set(rows.map((r) => r.sec).filter(Boolean))].sort();
  const exes = [...new Set(rows.map((r) => r.ex))];
  const presets = state.screener.presets || {};
  const covered = rows.filter((r) => M.rows[r.s]?.t).length;
  root.innerHTML = `
  <div class="card">
    <div class="card-head"><h2>조건</h2>
      <select id="sc-preset"><option value="">저장한 조건</option>${Object.keys(presets).map((k) => `<option>${esc(k)}</option>`).join('')}</select>
      <button class="btn btn-sm" id="sc-save">현재 조건 저장</button>
      <button class="btn btn-sm btn-danger" id="sc-del">조건 삭제</button>
      <button class="btn btn-sm" id="sc-reset">조건 초기화</button>
    </div>
    <div class="toolbar">
      <input data-f="q" placeholder="티커, 기업명, 업종, 산업 검색" value="${esc(f.q)}" style="width:230px">
      <select data-f="sec"><option value="">모든 업종</option>${sectors.map((s) => `<option ${f.sec === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select data-f="ex"><option value="">모든 거래소</option>${exes.map((s) => `<option ${f.ex === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select data-f="cap"><option value="">모든 시가총액</option>${CAPS.map((c) => `<option value="${c[0]}" ${f.cap === c[0] ? 'selected' : ''}>${c[1]}</option>`).join('')}</select>
      <select data-f="ctry"><option value="">모든 국가</option><option value="US" ${f.ctry === 'US' ? 'selected' : ''}>미국 기업</option><option value="NONUS" ${f.ctry === 'NONUS' ? 'selected' : ''}>해외 기업(ADR 등)</option></select>
      <label class="chip ${f.watchOnly ? 'on' : ''}"><input type="checkbox" data-f="watchOnly" ${f.watchOnly ? 'checked' : ''}> ★ 관심종목만</label>
    </div>
    ${filtersHtml()}
  </div>
  <div class="card">
    <div class="card-head">
      <div class="seg" id="sc-view" style="flex-wrap:wrap">${Object.entries(VIEWS).map(([v, l]) => `<button data-v="${v}" class="${view === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="small muted" id="sc-count"></span>
      <span style="flex:1"></span>
      <button class="btn btn-sm" id="sc-compare">나란히 비교 (<span id="cmp-n">${compare.size}</span>/5)</button>
      <button class="btn btn-sm" id="sc-clear-cmp">선택 해제</button>
      <button class="btn btn-sm" id="sc-csv">조회 결과 CSV 저장</button>
    </div>
    <div id="sc-table"></div>
    <details class="small muted" style="margin-top:10px"><summary>종목 요약 · 데이터 안내</summary>
      <p>종목 목록: Nasdaq 상장 종목 ${fmtNum(rows.length)}개 (갱신 ${esc(new Date(data.updatedAt).toLocaleString('ko-KR'))}). 수익률·RSI·이동평균·컨센서스 지표는 시가총액 20억 달러 이상과 관심·보유 종목 ${fmtNum(covered)}개를 서버가 매일 미리 계산합니다(기술 지표 ${M.techAt ? new Date(M.techAt).toLocaleString('ko-KR') : '수집 중'} · 컨센서스 ${M.fundAt ? new Date(M.fundAt).toLocaleString('ko-KR') : '수집 중'}). 그보다 작은 종목은 —로 표시하며 티커를 누르면 개별 자료를 볼 수 있습니다.</p>
      <p>이동평균 상태: 120일선 아래는 이탈위험, 그 외 60일선 아래는 경계, 20일선 아래이거나 주봉 정배열(4·13·26·52주)이 아니면 주의, 나머지는 양호입니다. RSI는 14기간 Wilder 방식, 주봉은 진행 중인 주를 제외합니다.</p>
      <p>NTM EPS는 올해·내년 추정 EPS를 남은 기간 비율로 섞어 근사합니다. PEG는 성장률이 양수일 때만 계산합니다. 자료: Yahoo Finance, Nasdaq.</p>
    </details>
  </div>`;

  const redraw = () => { page = 0; drawTable(root, rows); const c = root.querySelector('#adv-count'); if (c) c.textContent = activeFilterCount() ? activeFilterCount() + '개 적용' : '없음'; };
  root.querySelectorAll('[data-f]').forEach((el) => {
    const ev = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      f[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'checkbox') el.parentElement.classList.toggle('on', el.checked);
      redraw();
    });
  });
  root.querySelectorAll('[data-arr]').forEach((el) => {
    el.addEventListener('change', () => {
      const k = el.dataset.arr;
      f[k] = el.checked ? [...f[k], el.value] : f[k].filter((x) => x !== el.value);
      el.parentElement.classList.toggle('on', el.checked);
      redraw();
    });
  });
  root.querySelector('#sc-adv').addEventListener('toggle', (e) => { filtersOpen = e.target.open; });
  root.querySelectorAll('#sc-view button').forEach((b) => {
    b.onclick = () => { view = b.dataset.v; root.querySelectorAll('#sc-view button').forEach((x) => x.classList.toggle('on', x === b)); drawTable(root, rows); };
  });
  root.querySelector('#sc-reset').onclick = () => { f = blank(); page = 0; render(root); };
  root.querySelector('#sc-preset').onchange = (e) => { const p = presets[e.target.value]; if (p) { f = { ...blank(), ...p }; page = 0; render(root); } };
  root.querySelector('#sc-save').onclick = () => openModal({
    title: '현재 조건 저장',
    body: '<label class="field">조건 이름<input name="name" required placeholder="예: 정배열 + EPS 상향"></label>',
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
  root.querySelector('#sc-csv').onclick = () => exportCsv(rows);
  root.querySelector('#sc-compare').onclick = () => compareModal();
  root.querySelector('#sc-clear-cmp').onclick = () => { compare.clear(); drawTable(root, rows); root.querySelector('#cmp-n').textContent = 0; };
  drawTable(root, rows);
}

function sorted(list) {
  const { key, dir } = sort;
  return list.slice().sort((a, b) => {
    const va = value(a, key), vb = value(b, key);
    if ((va == null || va === -1) && (vb == null || vb === -1)) return 0;
    if (va == null || va === -1) return 1;
    if (vb == null || vb === -1) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir;
  });
}

// 보기별 열 정의: [키, 제목, 셀 함수]
const pc = (v, d = 2) => `<td class="num ${cls(v)}">${fmtPct(v, d)}</td>`;
const nm = (v, d = 1) => `<td class="num">${v == null ? '<span class="muted">—</span>' : fmtNum(v, d)}</td>`;
const usd = (v) => `<td class="num">${v == null ? '<span class="muted">—</span>' : '$' + fmtCap(v)}</td>`;
function colsFor() {
  const sel = (id, list, val) => `<select data-col="${id}" class="small" style="height:24px;padding:0 4px">${opt(list, val)}</select>`;
  switch (view) {
    case 'performance': return [
      ['p', '가격 ($)', (r, x) => nm(x.t.p ?? r.p, 2)],
      ...RET_KEYS.map(([k, l]) => [k, l, (r, x) => pc(k === 'd1' ? x.t.d1 ?? r.chg : x.t[k])]),
      ['volc', sel('vol', VOL_KEYS, volCol), (r, x) => `<td class="num">${fmtCap(x.t[volCol] ?? (volCol === 'vol' ? r.vol : null))}</td>`],
      ['rsi', sel('rsi', [['rsiD', '일봉 RSI(14)'], ['rsiW', '주봉 RSI(14)']], rsiCol), (r, x) => nm(x.t[rsiCol], 1)],
      ['al', '주봉 정배열', (r, x) => `<td class="num">${alignCell(x.has ? x.t : null)}</td>`],
      ['st', '주요 이평선', (r, x) => `<td class="num" style="white-space:nowrap">${x.has ? `20 ${maCell(x.t, 's20')} · 60 ${maCell(x.t, 's60')} · 120 ${maCell(x.t, 's120')}<div>${statusBadge(x.t.st)}</div>` : '<span class="muted">—</span>'}</td>`],
      ['fromLo', '52주 신저가 대비', (r, x) => pc(x.t.fromLo, 1)],
      ['fromHi', '52주 신고가 대비', (r, x) => pc(x.t.fromHi, 1)],
    ];
    case 'valuation': return [
      ['p', '가격 ($)', (r, x) => nm(x.t.p ?? r.p, 2)],
      ['perTTM', 'PER TTM', (r, x) => nm(x.d.perTTM)], ['perNTM', 'PER NTM', (r, x) => nm(x.d.perNTM)], ['perFY', 'PER FY', (r, x) => nm(x.d.perFY)], ['perFY1', 'PER FY+1', (r, x) => nm(x.d.perFY1)],
      ['pegTTM', 'PEG TTM', (r, x) => nm(x.d.pegTTM, 2)], ['pegNTM', 'PEG NTM', (r, x) => nm(x.d.pegNTM, 2)], ['pegFY', 'PEG FY', (r, x) => nm(x.d.pegFY, 2)], ['pegFY1', 'PEG FY+1', (r, x) => nm(x.d.pegFY1, 2)],
      ['pbr', 'PBR', (r, x) => nm(x.d.pbr)],
    ];
    case 'financial': return [
      ['revG0', '올해 매출 성장률', (r, x) => pc(x.d.revG0, 1)],
      ['epsG0', '올해 EPS 성장률', (r, x) => `<td class="num"><span class="${cls(x.d.epsG0)}">${fmtPct(x.d.epsG0, 1)}</span><div class="sub">${esc(x.d.st0 || '')}</div></td>`],
      ['revG1', '내년 매출 성장률', (r, x) => pc(x.d.revG1, 1)],
      ['epsG1', '내년 EPS 성장률', (r, x) => `<td class="num"><span class="${cls(x.d.epsG1)}">${fmtPct(x.d.epsG1, 1)}</span><div class="sub">${esc(x.d.st1 || '')}</div></td>`],
      ['eps0', '올해 EPS', (r, x) => `<td class="num">${x.d.eps0 == null ? '—' : x.d.eps0.toFixed(2)}<div class="sub">${esc(x.d.fy0)}</div></td>`],
      ['eps1', '내년 EPS', (r, x) => `<td class="num">${x.d.eps1 == null ? '—' : x.d.eps1.toFixed(2)}<div class="sub">${esc(x.d.fy1)}</div></td>`],
      ['om', '영업이익률', (r, x) => `<td class="num">${x.f.om == null ? '—' : fmtPct(x.f.om * 100, 1, false)}</td>`],
      ['roe', 'ROE', (r, x) => `<td class="num">${x.f.roe == null ? '—' : fmtPct(x.f.roe * 100, 1, false)}</td>`],
    ];
    case 'consensus': return [
      ['rev30_0', '올해 EPS 30일 변화', (r, x) => pc(x.d.rev30_0)], ['rev90_0', '올해 EPS 90일 변화', (r, x) => pc(x.d.rev90_0)],
      ['rev30_1', '내년 EPS 30일 변화', (r, x) => pc(x.d.rev30_1)], ['rev90_1', '내년 EPS 90일 변화', (r, x) => pc(x.d.rev90_1)],
      ['nA', '애널리스트', (r, x) => nm(x.f.y0?.nA ?? x.f.nAnalyst, 0)],
      ['upside', '목표가 괴리', (r, x) => pc(x.d.upside, 1)],
      ['nextEarn', '다음 실적', (r, x) => `<td class="num">${esc(x.f.nextEarn || '—')}${x.f.nextEarn ? `<div class="sub">${x.f.nextEst === false ? '확정' : '예상'}</div>` : ''}</td>`],
    ];
    case 'insider': return [
      ['insBuyD', '매수 거래일', (r, x) => `<td class="num">${esc(insW(r)?.lb || '—')}</td>`],
      ['insSellD', '매도 거래일', (r, x) => `<td class="num">${esc(insW(r)?.ls || '—')}</td>`],
      ['insBuyV', '매수 합계 (USD)', (r, x) => { const w = insW(r); return w ? `<td class="num up">${w.bN ? '$' + fmtCap(w.bV) + `<div class="sub">${w.bN}건</div>` : '0'}</td>` : '<td class="num muted">—</td>'; }],
      ['insSellV', '매도 합계 (USD)', (r, x) => { const w = insW(r); return w ? `<td class="num down">${w.sN ? '$' + fmtCap(w.sV) + `<div class="sub">${w.sN}건</div>` : '0'}</td>` : '<td class="num muted">—</td>'; }],
      ['insPct', '내부자 지분', (r, x) => `<td class="num">${x.f.insPct == null ? '—' : fmtPct(x.f.insPct * 100, 1, false)}</td>`],
      ['instPct', '기관 지분', (r, x) => `<td class="num">${x.f.instPct == null ? '—' : fmtPct(x.f.instPct * 100, 1, false)}</td>`],
    ];
    default: return [
      ['sec', '업종', (r) => `<td>${esc(r.sec || '—')}</td>`],
      ['ind', '산업', (r) => `<td class="sub">${esc(r.ind || '—')}</td>`],
      ['mc', '시총 ($)', (r) => `<td class="num">${fmtCap(r.mc)}</td>`],
      ['p', '가격 ($)', (r, x) => nm(x.t.p ?? r.p, 2)],
      ['chg', '일간 (%)', (r, x) => pc(x.t.d1 ?? r.chg)],
      ['ret', sel('ret', RET_KEYS.slice(1).map(([k, l]) => [k, l + ' %']), retCol), (r, x) => pc(x.t[retCol])],
      ['volc', sel('vol', VOL_KEYS, volCol), (r, x) => `<td class="num">${fmtCap(x.t[volCol] ?? (volCol === 'vol' ? r.vol : null))}</td>`],
      ['perTTM', 'PER (TTM)', (r, x) => nm(x.d.perTTM)],
    ];
  }
}

function drawTable(root, rows) {
  const el = root.querySelector('#sc-table');
  const list = sorted(applyFilter(rows));
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  page = Math.min(page, pages - 1);
  const slice = list.slice(page * PAGE, page * PAGE + PAGE);
  root.querySelector('#sc-count').textContent = `${fmtNum(list.length)}개 종목 · 열 제목을 눌러 정렬`;
  const watch = new Set(watchAll());
  const cols = colsFor();
  el.innerHTML = `<div class="table-wrap" style="max-height:70vh"><table class="tbl sticky-first"><thead><tr><th></th>
    <th class="sortable" data-k="s">티커 ${sort.key === 's' ? (sort.dir > 0 ? '▲' : '▼') : '↕'}</th><th class="sortable" data-k="n">기업명 ${sort.key === 'n' ? (sort.dir > 0 ? '▲' : '▼') : '↕'}</th>
    ${cols.map(([k, l]) => `<th class="sortable num" data-k="${k}">${l} ${sort.key === k ? (sort.dir > 0 ? '▲' : '▼') : '↕'}</th>`).join('')}</tr></thead><tbody>
    ${slice.map((r) => {
      const x = ext(r);
      return `<tr><td><input type="checkbox" data-cmp="${esc(r.s)}" ${compare.has(r.s) ? 'checked' : ''} title="비교에 추가"></td>
        <td class="sym" data-open="${esc(r.s)}" style="cursor:pointer;white-space:nowrap"><button class="star ${watch.has(r.s) ? 'on' : ''}" data-star="${esc(r.s)}" title="관심종목">${watch.has(r.s) ? '★' : '☆'}</button>${esc(r.s)}</td>
        <td><div>${esc(r.n)}</div><div class="sub">${esc(r.ctry)} · ${esc(r.ex)}</div></td>
        ${cols.map(([, , fn]) => fn(r, x)).join('')}</tr>`;
    }).join('') || `<tr><td colspan="${cols.length + 3}" class="empty">조건에 맞는 종목이 없습니다.</td></tr>`}
  </tbody></table></div>
  <div class="pager"><button class="btn btn-sm" data-pg="-1" ${page === 0 ? 'disabled' : ''}>이전</button><span>${page + 1} / ${pages}</span><button class="btn btn-sm" data-pg="1" ${page >= pages - 1 ? 'disabled' : ''}>다음</button></div>`;

  el.querySelectorAll('th.sortable').forEach((th) => {
    th.onclick = (e) => {
      if (e.target.closest('select')) return;
      const k = th.dataset.k;
      sort = sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: ['s', 'n', 'sec', 'ind', 'nextEarn'].includes(k) ? 1 : -1 };
      drawTable(root, rows);
    };
  });
  el.querySelectorAll('[data-col]').forEach((s) => {
    s.onclick = (e) => e.stopPropagation();
    s.onchange = () => { if (s.dataset.col === 'ret') retCol = s.value; if (s.dataset.col === 'vol') volCol = s.value; if (s.dataset.col === 'rsi') rsiCol = s.value; drawTable(root, rows); };
  });
  el.querySelectorAll('[data-pg]').forEach((b) => { b.onclick = () => { page += +b.dataset.pg; drawTable(root, rows); el.scrollIntoView({ block: 'start' }); }; });
  el.querySelectorAll('[data-star]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); const on = toggleWatch(b.dataset.star); b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; };
  });
  el.querySelectorAll('[data-open]').forEach((td) => { td.onclick = () => openStockModal(td.dataset.open); });
  el.querySelectorAll('[data-cmp]').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) { if (compare.size >= 5) { cb.checked = false; return toast('최대 5개까지 비교할 수 있습니다.'); } compare.add(cb.dataset.cmp); } else compare.delete(cb.dataset.cmp);
      root.querySelector('#cmp-n').textContent = compare.size;
    };
  });
}

function exportCsv(rows) {
  const cols = colsFor();
  const list = sorted(applyFilter(rows));
  const head = ['티커', '기업명', '업종', '산업', '시가총액($)', ...cols.map(([k, l]) => (l.startsWith('<') ? k : l))];
  const body = list.map((r) => [r.s, r.n, r.sec, r.ind, r.mc, ...cols.map(([k]) => { const v = value(r, k); return typeof v === 'number' ? +v.toFixed(4) : v ?? ''; })]);
  download(`스크리너-${VIEWS[view]}-${today()}.csv`, toCsv([head, ...body]), 'text/csv');
}

// ---------- 기업 비교 ----------
const GROUPS = { all: '전체', growth: '성장·실적', valuation: '밸류에이션', tech: '가격·기술적', outlook: '전망 변화·발표' };
async function compareModal() {
  if (compare.size < 2) return toast('목록에서 2~5개 기업을 체크하세요.');
  let group = 'all';
  const syms = [...compare];
  const { metricsFor } = await import('./metrics.js');
  const m = await metricsFor(syms, true);
  const draw = (box) => {
    const rows = syms.map((s) => ({ s, base: market.lookup(s) || { s, n: s }, t: m[s].t || {}, f: m[s].f || {}, d: derive(m[s]) }));
    const line = (label, fn, g) => (group === 'all' || group === g ? `<tr><td>${label}</td>${rows.map((r) => `<td class="num">${fn(r)}</td>`).join('')}</tr>` : '');
    const sec = (g) => (group === 'all' ? `<tr><td colspan="${rows.length + 1}" style="background:var(--primary-weak);color:var(--primary);font-weight:700">${GROUPS[g]}</td></tr>` : '');
    const pcv = (v, d = 2) => `<span class="${cls(v)}">${fmtPct(v, d)}</span>`;
    const n2 = (v, d = 2) => (v == null ? '<span class="muted">—</span>' : fmtNum(v, d));
    box.innerHTML = `<div class="table-wrap" style="max-height:62vh"><table class="tbl compare"><thead><tr><th>비교 항목</th>${rows.map((r) => `<th class="num"><div style="font-size:15px;color:var(--text)">${esc(r.s)} <button type="button" class="star" data-rm="${esc(r.s)}" title="빼기">×</button></div><div class="sub">${esc(r.base.n || r.f.name || '')}</div><div class="sub">${esc(r.base.ctry || '')} · ${esc(r.t.cur || r.f.cur || 'USD')}</div></th>`).join('')}</tr></thead><tbody>
      <tr><td>업종 · 산업</td>${rows.map((r) => `<td class="num">${esc(r.base.sec || '—')}<div class="sub">${esc(r.base.ind || '')}</div></td>`).join('')}</tr>
      <tr><td>가격 기준일</td>${rows.map((r) => `<td class="num">${esc(r.t.at || '—')}</td>`).join('')}</tr>
      ${sec('tech')}
      ${line('가격', (r) => n2(r.d.p), 'tech')}${line('시가총액', (r) => '$' + fmtCap(r.base.mc || r.f.mc), 'tech')}
      ${RET_KEYS.map(([k, l]) => line(`${l} 등락률`, (r) => pcv(k === 'd1' ? r.t.d1 ?? r.base.chg : r.t[k]), 'tech')).join('')}
      ${line('RSI(14) · 일봉', (r) => n2(r.t.rsiD), 'tech')}${line('RSI(14) · 주봉', (r) => n2(r.t.rsiW), 'tech')}
      ${line('주봉 이평선 상태', (r) => (r.t.al == null ? '—' : r.t.al ? `정배열 <span class="sub">${r.t.alDays}일</span>` : '미충족'), 'tech')}
      ${line('20·60·120일선', (r) => `${maCell(r.t, 's20')} · ${maCell(r.t, 's60')} · ${maCell(r.t, 's120')}`, 'tech')}
      ${line('종합 상태', (r) => statusBadge(r.t.st), 'tech')}
      ${line('52주 고점 대비', (r) => pcv(r.t.fromHi, 1), 'tech')}
      ${sec('growth')}
      ${line('올해 매출 성장률', (r) => `${pcv(r.d.revG0)}<div class="sub">${esc(r.d.fy0)} · 추정</div>`, 'growth')}
      ${line('올해 EPS 성장률', (r) => `${pcv(r.d.epsG0)}<div class="sub">${esc(r.d.st0 || '')}</div>`, 'growth')}
      ${line('올해 EPS', (r) => `${n2(r.d.eps0)}<div class="sub">${esc(r.d.fy0)} · 직전 ${n2(r.d.epsPrev)}</div>`, 'growth')}
      ${line('내년 매출 성장률', (r) => `${pcv(r.d.revG1)}<div class="sub">${esc(r.d.fy1)} · 추정</div>`, 'growth')}
      ${line('내년 EPS 성장률', (r) => `${pcv(r.d.epsG1)}<div class="sub">${esc(r.d.st1 || '')}</div>`, 'growth')}
      ${line('내년 EPS', (r) => `${n2(r.d.eps1)}<div class="sub">${esc(r.d.fy1)}</div>`, 'growth')}
      ${line('최근 4분기 EPS (TTM)', (r) => n2(r.d.teps), 'growth')}
      ${line('영업이익률', (r) => (r.f.om == null ? '—' : fmtPct(r.f.om * 100, 1, false)), 'growth')}
      ${sec('valuation')}
      ${line('PER · TTM', (r) => `${n2(r.d.perTTM)}<div class="sub">최근 12개월 EPS 기준</div>`, 'valuation')}
      ${line('PER · NTM', (r) => `${n2(r.d.perNTM)}<div class="sub">향후 12개월 EPS 근사</div>`, 'valuation')}
      ${line('PEG · NTM', (r) => n2(r.d.pegNTM), 'valuation')}
      ${line('PBR', (r) => n2(r.d.pbr), 'valuation')}
      ${line('올해 PER', (r) => `${n2(r.d.perFY)}<div class="sub">${esc(r.d.fy0)}</div>`, 'valuation')}
      ${line('올해 PEG', (r) => n2(r.d.pegFY), 'valuation')}
      ${line('내년 PER', (r) => `${n2(r.d.perFY1)}<div class="sub">${esc(r.d.fy1)}</div>`, 'valuation')}
      ${line('내년 PEG', (r) => n2(r.d.pegFY1), 'valuation')}
      ${sec('outlook')}
      ${line('올해 EPS 전망 변화 (30일)', (r) => pcv(r.d.rev30_0), 'outlook')}${line('올해 EPS 전망 변화 (90일)', (r) => pcv(r.d.rev90_0), 'outlook')}
      ${line('내년 EPS 전망 변화 (30일)', (r) => pcv(r.d.rev30_1), 'outlook')}${line('내년 EPS 전망 변화 (90일)', (r) => pcv(r.d.rev90_1), 'outlook')}
      ${line('목표주가 · 괴리', (r) => `${n2(r.f.tgt)}<div class="sub">${fmtPct(r.d.upside, 1)}</div>`, 'outlook')}
      ${line('다음 실적 발표', (r) => `${esc(r.f.nextEarn || '—')}<div class="sub">${r.f.nextEarn ? (r.f.nextEst === false ? '확정' : '예상') : ''}</div>`, 'outlook')}
    </tbody></table></div>
    <p class="small muted">가격·EPS는 각 기업의 표시 통화 기준입니다. 회계연도(FY)는 기업마다 결산월이 달라 각 기업의 올해·내년 회계연도를 표시합니다. 자료가 없으면 —로 표시하며 0으로 채우지 않습니다.</p>`;
    box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { compare.delete(b.dataset.rm); syms.splice(syms.indexOf(b.dataset.rm), 1); document.querySelectorAll(`[data-cmp="${b.dataset.rm}"]`).forEach((c) => { c.checked = false; }); const n = document.getElementById('cmp-n'); if (n) n.textContent = compare.size; draw(box); }; });
  };
  openModal({
    title: '기업 비교',
    wide: true,
    body: `<div class="toolbar" style="margin-bottom:10px"><span class="small muted">표시 항목</span><select data-group>${Object.entries(GROUPS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div><div data-box></div>`,
    onOpen(form) {
      const box = form.querySelector('[data-box]');
      form.querySelector('[data-group]').onchange = (e) => { group = e.target.value; draw(box); };
      draw(box);
    },
  });
}
