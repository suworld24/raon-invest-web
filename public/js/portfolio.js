// 포트폴리오: 계좌(제외·복원) · 매매/입출금/이체/시작 잔고/직접 수정 기록 · 평가 · 업종·테마 비중
//           · 월별 보정 수익률(Modified Dietz) / 자산 증감 · 과거 잔고 · 매매 미리보기
import { state, update, updateQuiet, market, esc, uid, today, fmtNum, fmtMoney, fmtPct, cls, isKrx, openModal, confirmModal, toast, valueAt, download, toCsv } from './core.js';
import { donut, color } from './charts.js';
import { openStockModal } from './stock.js';

let asOf = null;          // 과거 잔고 조회 날짜 (null = 오늘)
let recordTab = 'trades';
let renderSeq = 0;
let weightBy = 'sector';  // sector: 업종 · theme: 내 섹터 바스켓(테마)
let retMode = 'dietz';    // dietz: 입출금 보정 · simple: 자산 증감
let retSum = 'ytd';       // ytd · mom(전월대비)
const tf = { period: 'all', side: 'all', acc: 'all', q: '' }; // 매매기록 필터

const P = () => state.portfolio;
const disp = () => state.prefs.currency || 'KRW';
const hide = () => !!state.prefs.hideAmounts;
const curOf = (sym) => (isKrx(sym) ? 'KRW' : 'USD');
const FLOW_LABEL = {
  deposit: '입금', withdraw: '출금', transfer: '계좌 간 이체', income: '현금 수입 · 배당·이자 등', expense: '현금 지출 · 별도 비용 등',
  dividend: '배당', interest: '이자', fee: '수수료·세금', opening: '시작 잔고', adjust: '현금 직접 수정',
};
const FLOW_NEW = ['deposit', 'withdraw', 'transfer', 'income', 'expense'];
const OUT_TYPES = new Set(['withdraw', 'fee', 'expense']);
const EXT_TYPES = new Set(['deposit', 'withdraw', 'opening', 'adjust']);

const visibleAccounts = () => P().accounts.filter((a) => !a.hidden);
function selectedAccounts() {
  const ids = new Set(visibleAccounts().map((a) => a.id));
  const sel = (P().selected || []).filter((id) => ids.has(id));
  return sel.length ? sel : [...ids];
}
const positionsOf = () => P().positions || [];

// 기록을 날짜순으로 처리해 보유 수량·원가·현금·외부 입출금을 계산
// opts.includeRecordOnly: '기록만 저장' 항목도 포함
export function computeBook(accountIds, until = '9999-12-31') {
  const accSet = new Set(accountIds);
  const pos = new Map();
  const cash = { KRW: 0, USD: 0 };
  const ext = []; // 외부 입출금 {date, amount, cur, fx} (+입금 / -출금)
  const realized = { KRW: 0, USD: 0 };
  const inSel = (f) => accSet.has(f.accountId) || (f.type === 'transfer' && accSet.has(f.toAccountId));
  const events = [
    ...P().flows.filter((f) => !f.recordOnly && inSel(f) && f.date <= until).map((f) => ({ ...f, kind: 'flow', o: 0 })),
    ...positionsOf().filter((x) => accSet.has(x.accountId) && x.date <= until).map((x) => ({ ...x, kind: 'pos', o: 1 })),
    ...P().trades.filter((t) => !t.recordOnly && accSet.has(t.accountId) && t.date <= until).map((t) => ({ ...t, kind: 'trade', o: 2 })),
  ].sort((a, b) => (a.date === b.date ? a.o - b.o : a.date < b.date ? -1 : 1));

  const getPos = (sym, name, cur) => pos.get(sym) || { symbol: sym, name: name || sym, cur, qty: 0, cost: 0 };
  for (const e of events) {
    if (e.kind === 'flow') {
      const amt = +e.amount || 0, cur = e.currency;
      if (e.type === 'transfer') {
        const fromIn = accSet.has(e.accountId), toIn = accSet.has(e.toAccountId);
        if (fromIn) cash[cur] -= amt;
        if (toIn) cash[cur] += amt;
        if (fromIn !== toIn) ext.push({ date: e.date, amount: toIn ? amt : -amt, cur, fx: e.fx });
        continue;
      }
      const signed = e.type === 'adjust' ? amt : OUT_TYPES.has(e.type) ? -amt : amt;
      cash[cur] = (cash[cur] || 0) + signed;
      if (EXT_TYPES.has(e.type)) ext.push({ date: e.date, amount: signed, cur, fx: e.fx });
      continue;
    }
    if (e.kind === 'pos') { // 시작 잔고 · 수량 직접 수정 (현금 변동 없이 보유분만 바뀜 → 외부 유입으로 간주)
      const cur = e.currency || curOf(e.symbol);
      const p = getPos(e.symbol, e.name, cur);
      const qty = +e.qty || 0, unit = +e.cost || 0;
      if (qty >= 0) { p.qty += qty; p.cost += qty * unit; ext.push({ date: e.date, amount: qty * unit, cur }); } else {
        const avg = p.qty ? p.cost / p.qty : unit;
        const q = Math.min(-qty, p.qty);
        p.qty -= q; p.cost -= avg * q;
        ext.push({ date: e.date, amount: -q * (unit || avg), cur });
      }
      pos.set(e.symbol, p);
      continue;
    }
    const cur = e.currency || curOf(e.symbol);
    const qty = +e.qty || 0, price = +e.price || 0, fee = (+e.fee || 0) + (+e.tax || 0);
    const p = getPos(e.symbol, e.name, cur);
    if (e.side === 'buy') {
      p.qty += qty;
      p.cost += qty * price + fee;
      cash[cur] = (cash[cur] || 0) - (qty * price + fee);
      // 입금 기록 없이 산 경우: 부족분을 같은 날 입금으로 간주
      if (P().autoFund !== false && cash[cur] < -1e-9) {
        ext.push({ date: e.date, amount: -cash[cur], cur, auto: true, fx: e.fx });
        cash[cur] = 0;
      }
    } else {
      // 기록 이전부터 보유한 수량을 판 경우: 입력한 기존 평단으로 시작 보유분을 보충
      if (qty > p.qty + 1e-9 && e.priorCost) {
        const gap = qty - p.qty;
        p.qty += gap; p.cost += gap * +e.priorCost;
        ext.push({ date: e.date, amount: gap * +e.priorCost, cur });
      }
      const sellQty = Math.min(qty, p.qty);
      const avg = p.qty ? p.cost / p.qty : 0;
      realized[cur] += sellQty * (price - avg) - fee;
      p.cost -= avg * sellQty;
      p.qty -= sellQty;
      cash[cur] = (cash[cur] || 0) + qty * price - fee;
    }
    if (e.name) p.name = e.name;
    pos.set(e.symbol, p);
  }
  return { positions: [...pos.values()].filter((p) => p.qty > 1e-9), allSymbols: [...pos.keys()], cash, ext, realized };
}

const conv = (amt, from, to, fx) => (amt == null ? null : from === to ? amt : from === 'USD' ? amt * fx : amt / fx);

function sectorOf(sym) {
  if (isKrx(sym)) return '한국주식';
  const r = market.lookup(sym);
  return r?.sec || 'ETF·기타';
}
// 내 섹터 바스켓(섹터 퍼포먼스)에 포함된 테마
function themesOf(sym) {
  return (state.sectors.list || []).filter((s) => s.tickers.includes(sym)).map((s) => s.name);
}

export async function render(root) {
  const seq = ++renderSeq;
  const accIds = selectedAccounts();
  const date = asOf || today();
  root.innerHTML = toolbarHtml() + `<div class="card"><div class="empty">시세를 불러오는 중입니다…</div></div>`;
  bindToolbar(root);

  const book = computeBook(accIds, date);
  const syms = book.positions.map((p) => p.symbol);
  let prices = {}, prevPrices = {}, fx = 1350;
  const missing = [];
  try {
    await market.screener().catch(() => null);
    if (asOf) {
      const h = await market.history([...syms, 'KRW=X'], '5y');
      syms.forEach((s) => { prices[s] = valueAt(h[s], asOf); });
      fx = valueAt(h['KRW=X'], asOf) || fx;
    } else {
      const q = await market.quotes([...syms, 'KRW=X']);
      syms.forEach((s) => { prices[s] = q[s]?.p ?? null; prevPrices[s] = q[s]?.prev ?? null; });
      fx = q['KRW=X']?.p || fx;
    }
  } catch {
    toast('시세를 불러오지 못했습니다.');
  }
  if (seq !== renderSeq) return;

  const D = disp();
  const rows = book.positions.map((p) => {
    const price = prices[p.symbol];
    if (price == null) missing.push(p.symbol);
    const valueLocal = price != null ? price * p.qty : p.cost; // 시세 없으면 원가로 대체
    const value = conv(valueLocal, p.cur, D, fx);
    const cost = conv(p.cost, p.cur, D, fx);
    const prev = prevPrices[p.symbol];
    const day = prev != null && price != null ? conv((price - prev) * p.qty, p.cur, D, fx) : null;
    const themes = themesOf(p.symbol);
    return { ...p, price, value, costD: cost, pnl: value - cost, ret: cost ? (value / cost - 1) * 100 : null, day, sector: sectorOf(p.symbol), themes };
  }).sort((a, b) => b.value - a.value);
  const cashRows = Object.entries(book.cash).filter(([, v]) => Math.abs(v) > 1e-6).map(([cur, v]) => ({ cur, local: v, value: conv(v, cur, D, fx) }));
  const invested = rows.reduce((a, r) => a + r.value, 0);
  const cashTotal = cashRows.reduce((a, r) => a + r.value, 0);
  const total = invested + cashTotal;
  const unreal = rows.reduce((a, r) => a + r.pnl, 0);
  const costTotal = rows.reduce((a, r) => a + r.costD, 0);
  const realized = conv(book.realized.KRW, 'KRW', D, fx) + conv(book.realized.USD, 'USD', D, fx);
  const dayTotal = rows.reduce((a, r) => a + (r.day || 0), 0);
  const m = (v) => (hide() ? '••••' : fmtMoney(v, D));
  const q = (v) => (hide() ? '••••' : fmtNum(v, v % 1 ? 4 : 0));

  const donutItems = [
    ...rows.filter((r) => r.value > 0).map((r, i) => ({ label: r.name || r.symbol, value: r.value, color: color(i) })),
    ...cashRows.filter((c) => c.value > 0).map((c) => ({ label: `현금 (${c.cur})`, value: c.value, color: c.cur === 'KRW' ? 'var(--c9)' : 'var(--c10)' })),
  ];
  const weights = {};
  for (const r of rows) {
    if (weightBy === 'theme') {
      const ts = r.themes.length ? r.themes : ['테마 미분류'];
      ts.forEach((t) => { weights[t] = (weights[t] || 0) + r.value / ts.length; }); // 여러 테마면 나눠서 반영
    } else weights[r.sector] = (weights[r.sector] || 0) + r.value;
  }
  if (cashTotal > 0) weights['현금'] = cashTotal;
  const weightList = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  const acctNames = P().accounts.filter((a) => accIds.includes(a.id)).map((a) => a.name);
  const nTrades = P().trades.filter((t) => accIds.includes(t.accountId)).length;
  const nFlows = P().flows.filter((t) => accIds.includes(t.accountId) || accIds.includes(t.toAccountId)).length;
  const nPos = positionsOf().filter((t) => accIds.includes(t.accountId)).length;

  root.innerHTML = toolbarHtml() + `
  <div class="stats">
    <div class="stat"><div class="k">${asOf ? esc(asOf) + ' 기준 ' : ''}순자산</div><div class="v">${m(total)}</div><div class="s muted">${acctNames.length}개 계좌 · ${esc(acctNames.join(', '))}</div></div>
    <div class="stat"><div class="k">평가손익 (보유 중)</div><div class="v ${cls(unreal)}">${m(unreal)}</div><div class="s ${cls(unreal)}">${fmtPct(costTotal ? unreal / costTotal * 100 : null)}</div></div>
    <div class="stat"><div class="k">실현손익 (매도 누적)</div><div class="v ${cls(realized)}">${m(realized)}</div><div class="s muted">수수료·세금 반영</div></div>
    <div class="stat"><div class="k">${asOf ? '기준일 환율' : '오늘 변동'}</div>${asOf ? `<div class="v">${fmtNum(fx, 2)}</div><div class="s muted">USD/KRW</div>` : `<div class="v ${cls(dayTotal)}">${m(dayTotal)}</div><div class="s ${cls(dayTotal)}">${fmtPct(total - dayTotal ? dayTotal / (total - dayTotal) * 100 : null)} · 환율 ${fmtNum(fx, 2)}</div>`}</div>
  </div>

  <div class="card">
    <div class="card-head"><h2>자산 구성</h2>${missing.length ? `<span class="small muted">시세 없음(원가 표시): ${esc(missing.join(', '))}</span>` : ''}</div>
    <div class="donut-wrap">
      ${donut(donutItems, { top: '선택 계좌 순자산', value: hide() ? '••••' : fmtMoney(total, D), sub: `${acctNames.length}개 계좌 선택` })}
      <div class="legend">${donutItems.length ? donutItems.slice(0, 12).map((d) => `<div><span class="dot" style="background:${d.color}"></span>${esc(d.label)}<span class="lv">${fmtPct(total ? d.value / total * 100 : 0, 1, false)}</span></div>`).join('') : '<div class="muted">표시할 양수 자산이 없습니다. 입금·매매를 기록하거나 “+ 보유종목”으로 지금 가진 종목을 입력해 보세요.</div>'}</div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table class="tbl">
        <thead><tr><th>자산 / 계좌</th><th>테마</th><th class="num">수량</th><th class="num">평균단가</th><th class="num">${asOf ? '기준일가' : '현재가'}</th><th class="num">평가금액</th><th class="num">평가손익</th><th class="num">수익률</th><th class="num">비중</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>
            <td data-open="${esc(r.symbol)}" style="cursor:pointer" title="종목 상세 보기"><div class="sym">${esc(r.symbol)}</div><div class="sub">${esc(r.name)} · ${esc(r.sector)}</div></td>
            <td class="small">${r.themes.length ? r.themes.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ') : '<span class="muted">—</span>'}</td>
            <td class="num">${q(r.qty)}</td>
            <td class="num">${hide() ? '••••' : fmtMoney(r.cost / r.qty, r.cur)}</td>
            <td class="num">${r.price != null ? fmtMoney(r.price, r.cur) : '—'}</td>
            <td class="num">${m(r.value)}</td>
            <td class="num ${cls(r.pnl)}">${m(r.pnl)}</td>
            <td class="num ${cls(r.ret)}">${fmtPct(r.ret)}</td>
            <td class="num">${fmtPct(total ? r.value / total * 100 : null, 1, false)}</td>
          </tr>`).join('')}
          ${cashRows.map((c) => `<tr><td><div class="sym"><span class="dot" style="background:var(--c9)"></span> 현금 ${c.cur}</div><div class="sub">선택 계좌 합산${c.cur === 'USD' && !hide() ? ` · $${fmtNum(c.local, 2)}` : ''}</div></td><td></td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">${m(c.value)}</td><td class="num">—</td><td class="num">—</td><td class="num">${fmtPct(total ? c.value / total * 100 : null, 1, false)}</td></tr>`).join('')}
          ${!rows.length && !cashRows.length ? '<tr><td colspan="9" class="empty">보유 자산이 없습니다.</td></tr>' : ''}
        </tbody>
        ${rows.length || cashRows.length ? `<tfoot><tr><td>합계</td><td></td><td></td><td></td><td></td><td class="num">${m(total)}</td><td class="num ${cls(unreal)}">${m(unreal)}</td><td class="num ${cls(unreal)}">${fmtPct(costTotal ? unreal / costTotal * 100 : null)}</td><td class="num">100%</td></tr></tfoot>` : ''}
      </table>
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h2>${weightBy === 'theme' ? '테마별' : '섹터별'} 보유 비중</h2><div class="seg" id="w-seg"><button data-w="sector" class="${weightBy === 'sector' ? 'on' : ''}">업종</button><button data-w="theme" class="${weightBy === 'theme' ? 'on' : ''}">테마</button></div></div>
      ${weightList.length ? weightList.map(([name, v], i) => `<div class="bar-row"><span>${esc(name)}</span><div class="bar"><span style="width:${total ? (v / total * 100).toFixed(1) : 0}%;background:${name === '현금' ? 'var(--c9)' : color(i)}"></span></div><span class="num">${m(v)}</span><span class="num">${fmtPct(total ? v / total * 100 : 0, 1, false)}</span></div>`).join('') : '<div class="empty">보유 자산이 없습니다.</div>'}
      ${weightBy === 'theme' ? '<p class="small muted">테마는 섹터 퍼포먼스의 바스켓을 기준으로 판단합니다. 여러 테마에 속한 종목은 비중을 나눠 반영합니다.</p>' : ''}
    </div>
    <div class="card" id="dietz-card">
      <div class="card-head"><h2>보정 수익률</h2></div>
      <div class="empty">월별 수익률 계산 중…</div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>기록</h2>
      <div class="seg" id="rec-seg"><button data-t="trades" class="${recordTab === 'trades' ? 'on' : ''}">매매기록 ${nTrades}건</button><button data-t="flows" class="${recordTab === 'flows' ? 'on' : ''}">입출금 · 수익률 보정 ${nFlows}건</button><button data-t="pos" class="${recordTab === 'pos' ? 'on' : ''}">시작 잔고 · 직접 수정 ${nPos}건</button></div>
      <button class="btn btn-sm" id="rec-csv">CSV 저장</button>
    </div>
    <div id="records"></div>
  </div>
  <details class="card small muted"><summary>자료 출처 및 확인할 차이</summary>
    <p><b>평가·자산 구성 기준</b> — 미국·한국 종목은 Yahoo Finance 지연 시세, 원/달러 환율은 USD/KRW 시세로 평가합니다. 시세가 없으면 매입 원가로 표시합니다. 테마는 섹터 퍼포먼스의 바스켓 편입 여부로 판단합니다.</p>
    <p><b>수익률·자료 기준</b> — 입출금 보정 수익률은 기간 중 입출금 날짜를 가중한 Modified Dietz 추정치이고, 자산 증감은 입출금을 빼지 않은 총자산 변화율입니다. 기록되지 않은 입출금은 보정할 수 없습니다. 시작 잔고·직접 수정·기존 보유분 보충은 외부 유입으로 처리해 수익률을 부풀리지 않습니다.</p>
    <p><b>수량·현금 수정 및 매매기록</b> — '기록만 저장 · 과거 내역'으로 저장한 항목은 목록에만 남고 잔고·수익률 계산에는 쓰이지 않습니다. 매도 수량이 기록된 보유분보다 많으면 '기존 보유분 평단'을 입력해 기록 이전 보유분을 보충합니다.</p>
  </details>`;
  bindToolbar(root);
  drawRecords(root, accIds);
  root.querySelectorAll('[data-open]').forEach((td) => { td.onclick = () => openStockModal(td.dataset.open); });
  root.querySelectorAll('#w-seg button').forEach((b) => { b.onclick = () => { weightBy = b.dataset.w; rerender(); }; });
  renderDietz(root.querySelector('#dietz-card'), accIds, seq);
}

function toolbarHtml() {
  const accIds = selectedAccounts();
  return `<div class="toolbar">
    <span class="small muted">잔고 기준일 ${esc(asOf || today())}<br>${hide() ? '금액·수량 숨김 · 수익률·비중 표시' : '금액 표시 중'}</span>
    <span style="flex:1"></span>
    <button class="btn ${hide() ? 'active' : ''}" data-act="hide">${hide() ? '금액 보기' : '금액 숨기기'}</button>
    <button class="btn ${asOf ? 'active' : ''}" data-act="asof">${asOf ? '오늘로 돌아가기' : '과거 잔고 조회'}</button>
    <button class="btn" data-act="accounts">포트폴리오 관리</button>
    <button class="btn" data-act="edit">수량·현금 수정</button>
    <button class="btn" data-act="pos">+ 보유종목</button>
    <button class="btn" data-act="flow">+ 입출금</button>
    <button class="btn btn-primary" data-act="trade">+ 매매 기록</button>
    <select data-act="currency" aria-label="표시 통화"><option value="KRW" ${disp() === 'KRW' ? 'selected' : ''}>KRW · 원화</option><option value="USD" ${disp() === 'USD' ? 'selected' : ''}>USD · 달러</option></select>
  </div>
  <div class="toolbar">${visibleAccounts().map((a) => `<label class="chip ${accIds.includes(a.id) ? 'on' : ''}"><input type="checkbox" data-acc="${esc(a.id)}" ${accIds.includes(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</div>`;
}

function rerender() { render(document.getElementById('view')); }

function bindToolbar(root) {
  root.querySelector('[data-act=hide]').onclick = () => { updateQuiet('prefs', (p) => { p.hideAmounts = !p.hideAmounts; }); rerender(); };
  root.querySelector('[data-act=currency]').onchange = (e) => { updateQuiet('prefs', (p) => { p.currency = e.target.value; }); rerender(); };
  root.querySelector('[data-act=asof]').onclick = () => {
    if (asOf) { asOf = null; return rerender(); }
    openModal({
      title: '과거 잔고 조회',
      body: `<label class="field">기준일<input type="date" name="date" max="${today()}" value="${today()}" required></label><p class="small muted">그날까지의 기록과 그날 종가·환율로 잔고를 다시 계산합니다.</p>`,
      submitText: '조회',
      onSubmit: (d) => { if (!d.date) throw new Error('날짜를 선택하세요.'); asOf = d.date; rerender(); },
    });
  };
  root.querySelector('[data-act=accounts]').onclick = accountsModal;
  root.querySelector('[data-act=trade]').onclick = () => tradeModal();
  root.querySelector('[data-act=flow]').onclick = () => flowModal();
  root.querySelector('[data-act=pos]').onclick = () => positionModal();
  root.querySelector('[data-act=edit]').onclick = () => directEditModal();
  root.querySelectorAll('[data-acc]').forEach((cb) => {
    cb.onchange = () => {
      const ids = [...root.querySelectorAll('[data-acc]:checked')].map((x) => x.dataset.acc);
      updateQuiet('portfolio', (p) => { p.selected = ids; });
      rerender();
    };
  });
}

const accName = (id) => P().accounts.find((a) => a.id === id)?.name || '?';

// ---------- 기록 목록 ----------
function drawRecords(root, accIds) {
  const box = root.querySelector('#records');
  const h = hide();
  root.querySelectorAll('#rec-seg button').forEach((b) => { b.onclick = () => { recordTab = b.dataset.t; root.querySelectorAll('#rec-seg button').forEach((x) => x.classList.toggle('on', x === b)); drawRecords(root, accIds); }; });
  const ro = (x) => (x.recordOnly ? ' <span class="tag" title="잔고·수익률 계산에서 제외">기록만</span>' : '');
  if (recordTab === 'trades') {
    const since = { all: '', m1: daysAgo(31), m3: daysAgo(92), ytd: today().slice(0, 4) + '-01-01', y1: daysAgo(366) }[tf.period];
    const ql = tf.q.trim().toLowerCase();
    const list = P().trades.filter((t) => accIds.includes(t.accountId)
      && (!since || t.date >= since) && (tf.side === 'all' || t.side === tf.side) && (tf.acc === 'all' || t.accountId === tf.acc)
      && (!ql || `${t.symbol} ${t.name || ''} ${t.memo || ''}`.toLowerCase().includes(ql)))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    box.innerHTML = `<div class="toolbar" style="margin-bottom:8px">
        <select data-tf="period">${[['all', '전체 기간'], ['m1', '최근 1개월'], ['m3', '최근 3개월'], ['ytd', '올해'], ['y1', '최근 1년']].map(([v, l]) => `<option value="${v}" ${tf.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select data-tf="side">${[['all', '매수 + 매도'], ['buy', '매수'], ['sell', '매도']].map(([v, l]) => `<option value="${v}" ${tf.side === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select data-tf="acc"><option value="all">모든 포트폴리오</option>${P().accounts.filter((a) => accIds.includes(a.id)).map((a) => `<option value="${a.id}" ${tf.acc === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
        <input data-tf="q" placeholder="티커 / 종목명 검색" value="${esc(tf.q)}" style="width:170px"><span class="small muted">${list.length}건</span></div>
      ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>거래일</th><th>계좌</th><th>구분</th><th>티커</th><th class="num">수량</th><th class="num">단가</th><th class="num">거래금액</th><th class="num">수수료·세금</th><th></th></tr></thead><tbody>
        ${list.map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(accName(t.accountId))}</td><td class="${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? '매수' : '매도'}${ro(t)}</td>
          <td><span class="sym">${esc(t.symbol)}</span> <span class="sub">${esc(t.name || '')}</span>${t.memo ? `<div class="sub">${esc(t.memo)}</div>` : ''}</td>
          <td class="num">${h ? '••••' : fmtNum(+t.qty, t.qty % 1 ? 4 : 0)}</td><td class="num">${fmtMoney(+t.price, t.currency)}</td>
          <td class="num">${h ? '••••' : fmtMoney(t.qty * t.price, t.currency)}${t.fx ? `<div class="sub">환율 ${fmtNum(+t.fx, 2)}</div>` : ''}</td>
          <td class="num">${h ? '••••' : fmtMoney((+t.fee || 0) + (+t.tax || 0), t.currency)}</td>
          <td class="num" style="white-space:nowrap"><button class="btn btn-sm" data-edit-trade="${t.id}">수정</button> <button class="btn btn-sm btn-danger" data-del-trade="${t.id}">삭제</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">조건에 맞는 매매 기록이 없습니다.</div>'}`;
    box.querySelectorAll('[data-tf]').forEach((el) => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        tf[el.dataset.tf] = el.value; drawRecords(root, accIds);
        if (el.dataset.tf === 'q') { const n = root.querySelector('[data-tf=q]'); n.focus(); n.setSelectionRange(tf.q.length, tf.q.length); }
      });
    });
  } else if (recordTab === 'flows') {
    const list = P().flows.filter((t) => accIds.includes(t.accountId) || accIds.includes(t.toAccountId)).sort((a, b) => (a.date < b.date ? 1 : -1));
    box.innerHTML = list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>날짜</th><th>계좌</th><th>종류</th><th class="num">금액</th><th>메모</th><th></th></tr></thead><tbody>
      ${list.map((f) => `<tr><td>${esc(f.date)}</td><td>${f.type === 'transfer' ? `${esc(accName(f.accountId))} → ${esc(accName(f.toAccountId))}` : esc(accName(f.accountId))}</td><td>${FLOW_LABEL[f.type] || f.type}${ro(f)}</td>
        <td class="num ${OUT_TYPES.has(f.type) || (f.type === 'adjust' && f.amount < 0) ? 'down' : 'up'}">${h ? '••••' : fmtMoney(+f.amount, f.currency)}${f.fx ? `<div class="sub">환율 ${fmtNum(+f.fx, 2)}</div>` : ''}</td><td>${esc(f.memo || '')}</td>
        <td class="num" style="white-space:nowrap">${['opening', 'adjust'].includes(f.type) ? '' : `<button class="btn btn-sm" data-edit-flow="${f.id}">수정</button> `}<button class="btn btn-sm btn-danger" data-del-flow="${f.id}">삭제</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">입출금 기록이 없습니다. 입출금을 기록하면 수익률을 정확하게 보정합니다.</div>';
  } else {
    const list = positionsOf().filter((x) => accIds.includes(x.accountId)).sort((a, b) => (a.date < b.date ? 1 : -1));
    box.innerHTML = list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>기준일</th><th>계좌</th><th>구분</th><th>종목</th><th class="num">수량</th><th class="num">평단 · 기준가</th><th></th></tr></thead><tbody>
      ${list.map((x) => `<tr><td>${esc(x.date)}</td><td>${esc(accName(x.accountId))}</td><td>${x.kind === 'adjust' ? '수량 직접 수정' : '시작 잔고'}</td><td><span class="sym">${esc(x.symbol)}</span> <span class="sub">${esc(x.name || '')}</span></td>
        <td class="num ${x.qty < 0 ? 'down' : ''}">${h ? '••••' : fmtNum(+x.qty, x.qty % 1 ? 4 : 0)}</td><td class="num">${fmtMoney(+x.cost, x.currency)}</td>
        <td class="num"><button class="btn btn-sm btn-danger" data-del-pos="${x.id}">삭제</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">시작 잔고나 직접 수정 기록이 없습니다. “+ 보유종목” 또는 “수량·현금 수정”으로 입력할 수 있습니다.</div>';
  }
  box.querySelectorAll('[data-edit-trade]').forEach((b) => { b.onclick = () => tradeModal(P().trades.find((t) => t.id === b.dataset.editTrade)); });
  box.querySelectorAll('[data-edit-flow]').forEach((b) => { b.onclick = () => flowModal(P().flows.find((t) => t.id === b.dataset.editFlow)); });
  const del = (attr, key, label) => box.querySelectorAll(`[${attr}]`).forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmModal(`이 ${label}을 삭제할까요? (최근 변경 되돌리기로 복구할 수 있습니다)`))) return;
      const id = b.getAttribute(attr);
      update('portfolio', (p) => { p[key] = (p[key] || []).filter((t) => t.id !== id); }, `${label} 삭제`);
      rerender();
    };
  });
  del('data-del-trade', 'trades', '매매 기록');
  del('data-del-flow', 'flows', '입출금 기록');
  del('data-del-pos', 'positions', '보유 기록');
  root.querySelector('#rec-csv').onclick = () => {
    if (recordTab === 'trades') {
      download(`매매기록-${today()}.csv`, toCsv([['날짜', '계좌', '구분', '종목', '이름', '수량', '단가', '수수료', '세금', '통화', '환율', '저장 방식', '메모'],
        ...P().trades.filter((t) => accIds.includes(t.accountId)).map((t) => [t.date, accName(t.accountId), t.side === 'buy' ? '매수' : '매도', t.symbol, t.name, t.qty, t.price, t.fee || 0, t.tax || 0, t.currency, t.fx || '', t.recordOnly ? '기록만' : '잔고 반영', t.memo || ''])]), 'text/csv');
    } else if (recordTab === 'flows') {
      download(`입출금-${today()}.csv`, toCsv([['날짜', '계좌', '받는 계좌', '종류', '금액', '통화', '환율', '저장 방식', '메모'],
        ...P().flows.filter((t) => accIds.includes(t.accountId) || accIds.includes(t.toAccountId)).map((f) => [f.date, accName(f.accountId), f.toAccountId ? accName(f.toAccountId) : '', FLOW_LABEL[f.type], f.amount, f.currency, f.fx || '', f.recordOnly ? '기록만' : '현금 반영', f.memo || ''])]), 'text/csv');
    } else {
      download(`시작잔고-${today()}.csv`, toCsv([['기준일', '계좌', '구분', '종목', '수량', '평단', '통화'],
        ...positionsOf().filter((x) => accIds.includes(x.accountId)).map((x) => [x.date, accName(x.accountId), x.kind === 'adjust' ? '직접 수정' : '시작 잔고', x.symbol, x.qty, x.cost, x.currency])]), 'text/csv');
    }
  };
}
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

function accountOptions(sel, { exclude } = {}) {
  return visibleAccounts().filter((a) => a.id !== exclude).map((a) => `<option value="${esc(a.id)}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

async function symbolOptions() {
  try { return (await market.screener()).rows.slice(0, 3000).map((r) => `<option value="${esc(r.s)}">${esc(r.n)}</option>`).join(''); } catch { return ''; }
}
async function fxOn(date) {
  try { const h = await market.history(['KRW=X'], '5y'); return valueAt(h['KRW=X'], date); } catch { return null; }
}

// ---------- 매매 기록 (미리보기 후 저장) ----------
async function tradeModal(t) {
  const isEdit = !!t;
  t = t || { accountId: selectedAccounts()[0], date: today(), side: 'buy', symbol: '', qty: '', price: '', fee: '', tax: '', memo: '' };
  const suggestions = await symbolOptions();
  openModal({
    title: isEdit ? '매매 기록 수정' : '매매 기록 추가',
    body: `<div class="form-grid">
      <label class="field">포트폴리오<select name="accountId">${accountOptions(t.accountId)}</select></label>
      <label class="field">거래일<input type="date" name="date" value="${esc(t.date)}" max="${today()}" required></label>
      <label class="field">매수 / 매도<select name="side"><option value="buy" ${t.side === 'buy' ? 'selected' : ''}>매수</option><option value="sell" ${t.side === 'sell' ? 'selected' : ''}>매도</option></select></label>
      <label class="field">종목 검색 (티커)<input name="symbol" list="sym-list" value="${esc(t.symbol)}" placeholder="예: NVDA, 005930.KS" autocomplete="off" required></label>
      <datalist id="sym-list">${suggestions}</datalist>
      <label class="field">수량<input name="qty" type="number" step="any" min="0" value="${esc(t.qty)}" required></label>
      <label class="field">체결 단가 <span data-cur></span><input name="price" type="number" step="any" min="0" value="${esc(t.price)}" required></label>
      <label class="field">수수료 · 거래 통화<input name="fee" type="number" step="any" min="0" value="${esc(t.fee || '')}"></label>
      <label class="field">세금 · 거래 통화<input name="tax" type="number" step="any" min="0" value="${esc(t.tax || '')}"></label>
      <label class="field" data-fxwrap>거래일 원/달러 환율<input name="fx" type="number" step="any" min="0" value="${esc(t.fx || '')}" placeholder="비우면 그날 시세로 자동"></label>
      <label class="field" data-priorwrap>기존 보유분 평단 · 원가 미확인 시<input name="priorCost" type="number" step="any" min="0" value="${esc(t.priorCost || '')}" placeholder="기록 전부터 가진 수량을 팔 때"></label>
      <label class="field">저장 방식<select name="mode"><option value="live" ${t.recordOnly ? '' : 'selected'}>잔고에 반영</option><option value="record" ${t.recordOnly ? 'selected' : ''}>기록만 저장 · 과거 내역</option></select></label>
      <div class="field" style="justify-content:flex-end"><button type="button" class="btn" data-fill>그날 종가 채우기</button></div>
      <label class="field full">메모 · 선택<input name="memo" value="${esc(t.memo || '')}"></label>
      <p class="small muted full">한국 주식은 코스피 <b>.KS</b>, 코스닥 <b>.KQ</b>를 붙여 입력하세요. 미국 주식은 달러, 한국 주식은 원화로 기록됩니다. '변경 내용 확인'을 누르면 저장 전에 매입 평단과 실현손익을 미리 보여줍니다.</p>
    </div>`,
    submitText: '변경 내용 확인',
    onOpen(form) {
      const symEl = form.symbol, curEl = form.querySelector('[data-cur]');
      const sync = () => {
        const s = symEl.value.trim().toUpperCase();
        curEl.textContent = s ? `(${curOf(s)})` : '';
        form.querySelector('[data-fxwrap]').style.display = s && curOf(s) === 'USD' ? '' : 'none';
        form.querySelector('[data-priorwrap]').style.display = form.side.value === 'sell' ? '' : 'none';
      };
      symEl.addEventListener('input', sync); form.side.addEventListener('change', sync); sync();
      form.querySelector('[data-fill]').onclick = async () => {
        const s = symEl.value.trim().toUpperCase();
        if (!s) return toast('종목을 먼저 입력하세요.');
        const h = await market.history([s], '5y');
        const v = valueAt(h[s], form.date.value || today());
        if (v == null) return toast('시세를 찾지 못했습니다. 티커를 확인하세요.');
        form.price.value = +v.toFixed(isKrx(s) ? 0 : 2);
      };
    },
    async onSubmit(d) {
      const symbol = d.symbol.trim().toUpperCase();
      const qty = +d.qty, price = +d.price;
      if (!symbol) throw new Error('종목을 입력하세요.');
      if (!(qty > 0) || !(price >= 0)) throw new Error('수량과 단가를 확인하세요.');
      const cur = curOf(symbol);
      let fx = d.fx ? +d.fx : null;
      if (cur === 'USD' && !fx) fx = await fxOn(d.date);
      // 그 거래 직전 보유 상태
      const others = { ...P(), trades: P().trades.filter((x) => x.id !== t.id) };
      const before = withPortfolio(others, () => computeBook([d.accountId], d.date)).positions.find((p) => p.symbol === symbol) || { qty: 0, cost: 0 };
      const fee = (+d.fee || 0) + (+d.tax || 0);
      const priorCost = d.priorCost ? +d.priorCost : null;
      if (d.side === 'sell' && qty > before.qty + 1e-9 && !priorCost && d.mode === 'live') {
        throw new Error(`그 날짜 기준 기록된 보유 수량은 ${fmtNum(before.qty, 4)}주입니다. 기록 이전부터 보유한 수량이면 '기존 보유분 평단'을 입력하세요.`);
      }
      let q0 = before.qty, c0 = before.cost;
      if (d.side === 'sell' && qty > q0 && priorCost) { c0 += (qty - q0) * priorCost; q0 = qty; }
      const avgBefore = q0 ? c0 / q0 : 0;
      const after = d.side === 'buy'
        ? { qty: q0 + qty, avg: (c0 + qty * price + fee) / (q0 + qty), realized: null }
        : { qty: q0 - qty, avg: avgBefore, realized: qty * (price - avgBefore) - fee };
      let name = market.lookup(symbol)?.n;
      if (!name) { try { name = (await market.quotes([symbol]))[symbol]?.name; } catch { /* 이름 없음 */ } }
      const rec = { id: t.id || uid(), accountId: d.accountId, date: d.date, side: d.side, symbol, name: name || symbol, qty, price, fee: +d.fee || 0, tax: +d.tax || 0, fx: fx || null, priorCost, currency: cur, memo: d.memo || '', recordOnly: d.mode === 'record' };
      previewTrade(rec, after, isEdit);
    },
  });
}

// 다른 포트폴리오 상태로 잠시 계산
function withPortfolio(p, fn) {
  const saved = state.portfolio;
  state.portfolio = p;
  try { return fn(); } finally { state.portfolio = saved; }
}

function previewTrade(rec, after, isEdit) {
  const money = (v) => fmtMoney(v, rec.currency);
  openModal({
    title: '거래 변경 미리보기',
    wide: true,
    body: `<div class="table-wrap"><table class="tbl"><thead><tr><th>거래일</th><th>구분</th><th>티커</th><th class="num">수량</th><th class="num">단가</th><th class="num">거래금액</th><th class="num">수수료·세금</th><th class="num">매입 평단</th><th class="num">실현손익</th></tr></thead><tbody>
      <tr><td>${esc(rec.date)}</td><td class="${rec.side === 'buy' ? 'up' : 'down'}">${rec.side === 'buy' ? '매수' : '매도'}</td><td><b>${esc(rec.symbol)}</b> <span class="sub">${esc(rec.name)}</span></td>
        <td class="num">${fmtNum(rec.qty, rec.qty % 1 ? 4 : 0)}</td><td class="num">${money(rec.price)}</td><td class="num">${money(rec.qty * rec.price)}</td><td class="num">${money(rec.fee + rec.tax)}</td>
        <td class="num">${money(after.avg)}</td><td class="num ${cls(after.realized)}">${after.realized == null ? '—' : money(after.realized)}</td></tr></tbody></table></div>
      <p class="small">거래 후 보유 수량 <b>${fmtNum(after.qty, after.qty % 1 ? 4 : 0)}</b>주 · ${rec.recordOnly ? '<span class="tag">기록만 저장 · 잔고·수익률에 반영하지 않음</span>' : '잔고에 반영'}${rec.fx ? ` · 적용 환율 ${fmtNum(rec.fx, 2)}원` : ''}</p>`,
    submitText: '확인하고 저장',
    onSubmit() {
      update('portfolio', (p) => {
        if (isEdit) p.trades = p.trades.map((x) => (x.id === rec.id ? rec : x));
        else p.trades.push(rec);
      }, isEdit ? '매매 기록 수정' : '매매 기록 추가');
      recordTab = 'trades';
      rerender();
    },
  });
}

// ---------- 입출금 · 이체 · 현금 수입/지출 ----------
function flowModal(f) {
  const isEdit = !!f;
  f = f || { accountId: selectedAccounts()[0], date: today(), type: 'deposit', amount: '', currency: 'KRW', memo: '' };
  const types = FLOW_NEW.includes(f.type) ? FLOW_NEW : [...FLOW_NEW, f.type];
  openModal({
    title: isEdit ? '입출금 수정' : '입출금 기록 · 수익률 보정',
    body: `<div class="form-grid">
      <label class="field">입출금 날짜<input type="date" name="date" value="${esc(f.date)}" max="${today()}" required></label>
      <label class="field">계좌<select name="accountId">${accountOptions(f.accountId)}</select></label>
      <label class="field">종류<select name="type">${types.map((k) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${FLOW_LABEL[k]}</option>`).join('')}</select></label>
      <label class="field" data-towrap>이체 받을 계좌<select name="toAccountId">${accountOptions(f.toAccountId)}</select></label>
      <label class="field">통화<select name="currency"><option ${f.currency === 'KRW' ? 'selected' : ''}>KRW</option><option ${f.currency === 'USD' ? 'selected' : ''}>USD</option></select></label>
      <label class="field">금액 (양수)<input type="number" step="any" min="0" name="amount" value="${esc(f.amount)}" required></label>
      <label class="field" data-fxwrap>당시 원/달러 환율<input type="number" step="any" min="0" name="fx" value="${esc(f.fx || '')}" placeholder="비우면 그날 시세로 자동"></label>
      <label class="field">저장 방식<select name="mode"><option value="live" ${f.recordOnly ? '' : 'selected'}>현금에도 반영</option><option value="record" ${f.recordOnly ? 'selected' : ''}>기록만 저장 · 과거 내역</option></select></label>
      <label class="field full">메모<input name="memo" value="${esc(f.memo || '')}" placeholder="예: 추가 투자금"></label>
      <p class="small muted full">입금·출금은 수익률 계산에서 원금 변동으로 보정되고, 현금 수입(배당·이자)과 지출(별도 비용)은 수익으로 계산합니다. 계좌 간 이체는 두 계좌를 함께 볼 때는 수익률에 영향이 없습니다. 환전은 원화 출금 + 달러 입금으로 기록하세요.</p>
    </div>`,
    onOpen(form) {
      const sync = () => {
        form.querySelector('[data-towrap]').style.display = form.type.value === 'transfer' ? '' : 'none';
        form.querySelector('[data-fxwrap]').style.display = form.currency.value === 'USD' ? '' : 'none';
      };
      form.type.addEventListener('change', sync); form.currency.addEventListener('change', sync); sync();
    },
    async onSubmit(d) {
      const amount = +d.amount;
      if (!(amount > 0)) throw new Error('금액을 입력하세요.');
      if (d.type === 'transfer' && d.toAccountId === d.accountId) throw new Error('이체 받을 계좌를 다른 계좌로 고르세요.');
      let fx = d.fx ? +d.fx : null;
      if (d.currency === 'USD' && !fx) fx = await fxOn(d.date);
      const rec = { id: f.id || uid(), accountId: d.accountId, date: d.date, type: d.type, amount, currency: d.currency, fx: fx || null, memo: d.memo || '', recordOnly: d.mode === 'record' };
      if (d.type === 'transfer') rec.toAccountId = d.toAccountId;
      update('portfolio', (p) => {
        if (isEdit) p.flows = p.flows.map((x) => (x.id === rec.id ? rec : x));
        else p.flows.push(rec);
      }, isEdit ? '입출금 수정' : '입출금 추가');
      recordTab = 'flows';
      rerender();
    },
  });
}

// ---------- 새 보유종목 (시작 잔고) ----------
async function positionModal() {
  const suggestions = await symbolOptions();
  openModal({
    title: '새 보유종목 추가',
    body: `<div class="form-grid">
      <label class="field">계좌<select name="accountId">${accountOptions(selectedAccounts()[0])}</select></label>
      <label class="field">기준일<input type="date" name="date" value="${today()}" max="${today()}" required></label>
      <label class="field">티커<input name="symbol" list="pos-list" placeholder="예: AAPL / 005930.KS" autocomplete="off" required></label>
      <datalist id="pos-list">${suggestions}</datalist>
      <label class="field">수량<input name="qty" type="number" step="any" min="0" required></label>
      <label class="field">참고 현재가<input name="ref" readonly placeholder="티커를 입력하면 표시"></label>
      <label class="field">시작 매입 평단 · 선택<input name="cost" type="number" step="any" min="0" placeholder="비우면 기준일 종가"></label>
      <p class="small muted full">매매 기록 없이 지금 가진 종목을 시작 잔고로 넣습니다. 평단을 모르면 비워 두세요(기준일 종가로 저장). 수익률 계산에서는 외부 유입으로 처리합니다.</p>
    </div>`,
    onOpen(form) {
      let t;
      form.symbol.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const s = form.symbol.value.trim().toUpperCase();
          if (!s) return;
          const q = (await market.quotes([s]).catch(() => ({})))[s];
          form.ref.value = q?.p != null ? `${fmtMoney(q.p, curOf(s))}` : '시세 없음';
        }, 400);
      });
    },
    async onSubmit(d) {
      const symbol = d.symbol.trim().toUpperCase();
      const qty = +d.qty;
      if (!symbol || !(qty > 0)) throw new Error('티커와 수량을 확인하세요.');
      let cost = d.cost ? +d.cost : null;
      if (cost == null) { const h = await market.history([symbol], '5y'); cost = valueAt(h[symbol], d.date); }
      if (cost == null) throw new Error('기준일 시세를 찾지 못했습니다. 평단을 직접 입력하세요.');
      let name = market.lookup(symbol)?.n;
      if (!name) { try { name = (await market.quotes([symbol]))[symbol]?.name; } catch { /* 이름 없음 */ } }
      update('portfolio', (p) => { (p.positions ||= []).push({ id: uid(), accountId: d.accountId, date: d.date, symbol, name: name || symbol, qty, cost, currency: curOf(symbol), kind: 'opening' }); }, '보유종목 추가');
      recordTab = 'pos';
      rerender();
    },
  });
}

// ---------- 수량·현금 직접 수정 (세부 자산 현황) ----------
async function directEditModal() {
  const accId = selectedAccounts()[0];
  const draw = async (form, acc) => {
    const b = computeBook([acc]);
    const q = await market.quotes(b.positions.map((x) => x.symbol)).catch(() => ({}));
    form.querySelector('[data-rows]').innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>자산</th><th class="num">현재 수량 / 현금 잔액</th><th class="num">새 값</th></tr></thead><tbody>
      ${b.positions.map((x) => `<tr><td><b>${esc(x.symbol)}</b> <span class="sub">${esc(x.name)}</span></td><td class="num">${fmtNum(x.qty, x.qty % 1 ? 4 : 0)}</td><td class="num"><input type="number" step="any" min="0" data-q="${esc(x.symbol)}" data-old="${x.qty}" data-px="${q[x.symbol]?.p ?? x.cost / x.qty}" data-cur="${x.cur}" value="${x.qty}" style="width:120px"></td></tr>`).join('')}
      ${['KRW', 'USD'].map((c) => `<tr><td>현금 · ${c}</td><td class="num">${fmtMoney(b.cash[c] || 0, c)}</td><td class="num"><input type="number" step="any" data-cash="${c}" data-old="${b.cash[c] || 0}" value="${+(b.cash[c] || 0).toFixed(c === 'KRW' ? 0 : 2)}" style="width:120px"></td></tr>`).join('')}
    </tbody></table></div>`;
  };
  openModal({
    title: '수량·현금 수정',
    wide: true,
    body: `<div class="toolbar"><span class="small muted">계좌</span><select name="acc">${accountOptions(accId)}</select>
      <label class="chip"><input type="checkbox" name="opening"> 시작 잔고로 저장</label></div>
      <div data-rows style="margin-top:10px"><div class="empty">불러오는 중…</div></div>
      <p class="small muted">증권사 잔고와 다를 때 수량과 현금을 직접 맞춥니다. 차이는 '시작 잔고 · 직접 수정' 기록으로 남고 수익률 계산에서는 외부 입출금으로 처리합니다.</p>`,
    submitText: '변경 저장',
    onOpen(form) { draw(form, accId); form.acc.onchange = () => draw(form, form.acc.value); },
    onSubmit(d, form) {
      const acc = form.acc.value, opening = form.opening.checked;
      const dt = today();
      const posAdds = [], flowAdds = [];
      form.querySelectorAll('[data-q]').forEach((i) => {
        const diff = +i.value - +i.dataset.old;
        if (Math.abs(diff) > 1e-9) posAdds.push({ id: uid(), accountId: acc, date: dt, symbol: i.dataset.q, qty: diff, cost: +i.dataset.px, currency: i.dataset.cur, kind: opening ? 'opening' : 'adjust' });
      });
      form.querySelectorAll('[data-cash]').forEach((i) => {
        const diff = +i.value - +i.dataset.old;
        if (Math.abs(diff) > 1e-6) flowAdds.push({ id: uid(), accountId: acc, date: dt, type: opening ? 'opening' : 'adjust', amount: opening ? Math.abs(diff) : diff, currency: i.dataset.cash, memo: '잔고 직접 수정' });
      });
      if (!posAdds.length && !flowAdds.length) throw new Error('바뀐 값이 없습니다.');
      if (opening && flowAdds.some((x) => x.amount < 0)) throw new Error('시작 잔고는 늘리는 방향만 저장할 수 있습니다.');
      update('portfolio', (p) => { p.positions = [...(p.positions || []), ...posAdds]; p.flows = [...p.flows, ...flowAdds]; }, '수량·현금 직접 수정');
      recordTab = posAdds.length ? 'pos' : 'flows';
      rerender();
    },
  });
}

// ---------- 포트폴리오 관리 (추가 · 이름 · 제외/복원) ----------
function accountsModal() {
  const list = () => P().accounts.map((a) => {
    const n = P().trades.filter((t) => t.accountId === a.id).length + P().flows.filter((t) => t.accountId === a.id).length + positionsOf().filter((t) => t.accountId === a.id).length;
    return `<div class="toolbar" style="margin-bottom:6px;${a.hidden ? 'opacity:.6' : ''}"><input data-name="${esc(a.id)}" value="${esc(a.name)}" style="flex:1"><span class="tag">${a.hidden ? '제외됨' : '사용 중'}</span><span class="small muted">${n}건</span>
      <button type="button" class="btn btn-sm" data-toggle="${esc(a.id)}">${a.hidden ? '복원' : '제외'}</button></div>`;
  }).join('');
  openModal({
    title: '포트폴리오 관리',
    body: `<div class="toolbar"><input name="newName" placeholder="새 포트폴리오 이름" style="flex:1"><button type="button" class="btn" data-add>추가</button></div>
      <p class="small muted">제외하면 현재 합계와 계좌 선택에서 빠집니다. 보유내역·매매·입출금·과거 잔고는 보존되며 언제든 복원할 수 있습니다. 최소 하나는 유지합니다.</p>
      <div data-list>${list()}</div>
      <label class="toolbar small"><input type="checkbox" name="autoFund" ${P().autoFund !== false ? 'checked' : ''}> 입금 기록 없이 매수하면 부족한 금액을 자동 입금으로 간주</label>`,
    submitText: '이름 저장',
    onOpen(form) {
      const bind = () => {
        form.querySelectorAll('[data-toggle]').forEach((b) => {
          b.onclick = () => {
            const id = b.dataset.toggle;
            const a = P().accounts.find((x) => x.id === id);
            if (!a.hidden && visibleAccounts().length <= 1) return toast('최소 하나의 포트폴리오는 사용 중이어야 합니다.');
            update('portfolio', (p) => { const x = p.accounts.find((y) => y.id === id); x.hidden = !x.hidden; if (x.hidden) p.selected = (p.selected || []).filter((s) => s !== id); }, a.hidden ? '포트폴리오 복원' : '포트폴리오 제외');
            form.querySelector('[data-list]').innerHTML = list(); bind();
          };
        });
      };
      bind();
      form.querySelector('[data-add]').onclick = () => {
        const name = form.newName.value.trim();
        if (!name) return;
        update('portfolio', (p) => { const id = uid(); p.accounts.push({ id, name, currency: 'KRW' }); p.selected = [...(p.selected || []), id]; }, '포트폴리오 추가');
        form.newName.value = '';
        form.querySelector('[data-list]').innerHTML = list(); bind();
      };
    },
    onSubmit(d, form) {
      update('portfolio', (p) => {
        form.querySelectorAll('[data-name]').forEach((inp) => {
          const a = p.accounts.find((x) => x.id === inp.dataset.name);
          if (a && inp.value.trim()) a.name = inp.value.trim();
        });
        p.autoFund = !!form.autoFund.checked;
      }, '포트폴리오 이름 변경');
      rerender();
    },
  });
}

// ---------- 월별 보정 수익률 / 자산 증감 ----------
async function renderDietz(card, accIds, seq) {
  const D = disp();
  const allBook = computeBook(accIds);
  const firstDates = [...P().trades.filter((x) => !x.recordOnly), ...P().flows.filter((x) => !x.recordOnly), ...positionsOf()]
    .filter((x) => accIds.includes(x.accountId) || accIds.includes(x.toAccountId)).map((x) => x.date).sort();
  const head = `<div class="card-head"><h2>보정 수익률</h2>
    <select data-rm><option value="dietz" ${retMode === 'dietz' ? 'selected' : ''}>입출금 보정 · 추정</option><option value="simple" ${retMode === 'simple' ? 'selected' : ''}>자산 증감</option></select>
    <select data-rs><option value="ytd" ${retSum === 'ytd' ? 'selected' : ''}>YTD</option><option value="mom" ${retSum === 'mom' ? 'selected' : ''}>전월대비</option></select></div>`;
  const bindHead = () => {
    card.querySelector('[data-rm]').onchange = (e) => { retMode = e.target.value; renderDietz(card, accIds, seq); };
    card.querySelector('[data-rs]').onchange = (e) => { retSum = e.target.value; renderDietz(card, accIds, seq); };
  };
  if (!firstDates.length) {
    card.innerHTML = `${head}<div class="empty">기록이 쌓이면 월별 수익률을 계산합니다.</div>`;
    bindHead();
    return;
  }
  card.innerHTML = `${head}<div class="empty">월별 수익률 계산 중…</div>`;
  bindHead();
  const now = asOf || today();
  const year = now.slice(0, 4);
  const startYm = firstDates[0] > `${year}-01-01` ? firstDates[0].slice(0, 7) : `${year}-01`;
  const months = [];
  let [y, mo] = startYm.split('-').map(Number);
  while (`${y}-${String(mo).padStart(2, '0')}` <= now.slice(0, 7)) {
    const ym = `${y}-${String(mo).padStart(2, '0')}`;
    const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const startPrev = new Date(Date.UTC(y, mo - 1, 0)).toISOString().slice(0, 10);
    months.push({ ym, start: startPrev, end: end > now ? now : end });
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  const range = firstDates[0] >= new Date(Date.now() - 700 * 864e5).toISOString().slice(0, 10) ? '2y' : '5y';
  let hist;
  try {
    hist = await market.history([...allBook.allSymbols, 'KRW=X'], range);
  } catch {
    if (seq === renderSeq) card.querySelector('.empty').textContent = '과거 시세를 불러오지 못했습니다.';
    return;
  }
  if (seq !== renderSeq || !card.isConnected) return;
  const fxAt = (d) => valueAt(hist['KRW=X'], d) || 1350;
  const valueOn = (d) => {
    const b = computeBook(accIds, d);
    const fx = fxAt(d);
    let v = 0;
    for (const p of b.positions) {
      const px = valueAt(hist[p.symbol], d);
      if (px == null) return null;
      v += conv(px * p.qty, p.cur, D, fx);
    }
    v += conv(b.cash.KRW, 'KRW', D, fx) + conv(b.cash.USD, 'USD', D, fx);
    return v;
  };
  const rows = [];
  let cumFactor = 1, cumPnl = 0;
  for (const m of months) {
    const v0 = m.start < firstDates[0] ? 0 : valueOn(m.start);
    const v1 = valueOn(m.end);
    const flows = allBook.ext.filter((f) => f.date > m.start && f.date <= m.end);
    const days = Math.max(1, (Date.parse(m.end) - Date.parse(m.start)) / 864e5);
    let F = 0, W = 0;
    for (const f of flows) {
      const amt = conv(f.amount, f.cur, D, f.fx || fxAt(f.date));
      const w = (Date.parse(m.end) - Date.parse(f.date) + 864e5) / 864e5 / days;
      F += amt; W += Math.min(1, w) * amt;
    }
    let pnl = null, ret = null;
    if (v0 != null && v1 != null) {
      if (retMode === 'simple') {
        pnl = v1 - v0;
        ret = v0 > 0 ? (v1 / v0 - 1) * 100 : null;
      } else {
        pnl = v1 - v0 - F;
        const denom = v0 + W;
        ret = denom > 0 ? (pnl / denom) * 100 : null;
      }
      if (ret != null) cumFactor *= 1 + ret / 100;
      cumPnl += pnl;
    }
    rows.push({ ...m, v1, pnl, ret, cumPnl, cumRet: (cumFactor - 1) * 100 });
  }
  const m = (v) => (hide() ? '••••' : fmtMoney(v, D));
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const ytdRows = rows.filter((r) => r.ym.startsWith(year));
  const ytd = ytdRows.reduce((f, r) => (r.ret != null ? f * (1 + r.ret / 100) : f), 1);
  const ytdPnl = ytdRows.reduce((a, r) => a + (r.pnl || 0), 0);
  const sumStat = retSum === 'ytd'
    ? `<div class="stat"><div class="k">YTD</div><div class="v ${cls(ytd - 1)}">${fmtPct((ytd - 1) * 100)}</div><div class="s ${cls(ytdPnl)}">${m(ytdPnl)}</div></div>`
    : `<div class="stat"><div class="k">전월대비 (${prev ? prev.ym.slice(5) + '월 말 → ' : ''}${last.ym.slice(5)}월)</div><div class="v ${cls(last.ret)}">${fmtPct(last.ret)}</div><div class="s ${cls(last.pnl)}">${m(last.pnl)}</div></div>`;
  card.innerHTML = `${head}
    <div class="stats" style="margin-bottom:12px">${sumStat}
      <div class="stat"><div class="k">이번 달 (${last.ym.slice(5)}월)</div><div class="v ${cls(last.ret)}">${fmtPct(last.ret)}</div><div class="s ${cls(last.pnl)}">${m(last.pnl)}</div></div>
    </div>
    <h4 style="margin:0 0 6px">월별 ${retMode === 'simple' ? '자산 증감' : '보정 수익률'}</h4>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>기준</th><th class="num">총자산</th><th class="num">기간 ${retMode === 'simple' ? '증감' : '보정 손익'}</th><th class="num">기간 수익률</th><th class="num">누적 손익</th><th class="num">누적 수익률</th></tr></thead><tbody>
      ${rows.slice().reverse().map((r) => `<tr><td>${r.end}</td><td class="num">${m(r.v1)}</td><td class="num ${cls(r.pnl)}">${m(r.pnl)}</td><td class="num ${cls(r.ret)}">${fmtPct(r.ret)}</td><td class="num ${cls(r.cumPnl)}">${m(r.cumPnl)}</td><td class="num ${cls(r.cumRet)}">${fmtPct(r.cumRet)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">${retMode === 'simple' ? '자산 증감은 입출금을 빼지 않은 총자산 변화율입니다. 입금이 있으면 수익률이 크게 보일 수 있습니다.' : '입출금 날짜를 가중한 Modified Dietz 추정치입니다. 등록되지 않은 입출금은 보정할 수 없습니다.'} 평가액·현금·필요 환율이 부족한 기간은 —로 표시합니다.</p>`;
  bindHead();
}
