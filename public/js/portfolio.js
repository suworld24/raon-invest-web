// 포트폴리오: 계좌 · 매매/입출금 기록 · 평가 · 섹터 비중 · 월별 보정 수익률(Modified Dietz)
import { state, update, updateQuiet, market, esc, uid, today, fmtNum, fmtMoney, fmtPct, cls, isKrx, openModal, confirmModal, toast, valueAt, download, toCsv } from './core.js';
import { donut, color } from './charts.js';
import { openStockModal } from './stock.js';

let asOf = null;          // 과거 잔고 조회 날짜 (null = 오늘)
let recordTab = 'trades';
let renderSeq = 0;

const P = () => state.portfolio;
const disp = () => state.prefs.currency || 'KRW';
const hide = () => !!state.prefs.hideAmounts;
const curOf = (sym) => (isKrx(sym) ? 'KRW' : 'USD');
const FLOW_LABEL = { deposit: '입금', withdraw: '출금', dividend: '배당', interest: '이자', fee: '수수료·세금' };

function selectedAccounts() {
  const ids = new Set(P().accounts.map((a) => a.id));
  const sel = (P().selected || []).filter((id) => ids.has(id));
  return sel.length ? sel : P().accounts.map((a) => a.id);
}

// 기록을 날짜순으로 처리해 보유 수량·원가·현금·외부 입출금을 계산
export function computeBook(accountIds, until = '9999-12-31') {
  const accSet = new Set(accountIds);
  const pos = new Map();
  const cash = { KRW: 0, USD: 0 };
  const ext = []; // 외부 입출금 {date, amount, cur} (+입금 / -출금)
  const events = [
    ...P().flows.filter((f) => accSet.has(f.accountId) && f.date <= until).map((f) => ({ ...f, kind: 'flow' })),
    ...P().trades.filter((t) => accSet.has(t.accountId) && t.date <= until).map((t) => ({ ...t, kind: 'trade' })),
  ].sort((a, b) => (a.date === b.date ? (a.kind === 'flow' ? -1 : 1) : a.date < b.date ? -1 : 1));

  let realized = { KRW: 0, USD: 0 };
  for (const e of events) {
    if (e.kind === 'flow') {
      const amt = +e.amount || 0;
      const sign = e.type === 'withdraw' || e.type === 'fee' ? -1 : 1;
      cash[e.currency] = (cash[e.currency] || 0) + sign * amt;
      if (e.type === 'deposit' || e.type === 'withdraw') ext.push({ date: e.date, amount: sign * amt, cur: e.currency });
      continue;
    }
    const cur = e.currency || curOf(e.symbol);
    const qty = +e.qty || 0, price = +e.price || 0, fee = +e.fee || 0;
    const p = pos.get(e.symbol) || { symbol: e.symbol, name: e.name || e.symbol, cur, qty: 0, cost: 0 };
    if (e.side === 'buy') {
      p.qty += qty;
      p.cost += qty * price + fee;
      cash[cur] = (cash[cur] || 0) - (qty * price + fee);
      // 입금 기록 없이 산 경우: 부족분을 같은 날 입금으로 간주
      if (P().autoFund !== false && cash[cur] < -1e-9) {
        ext.push({ date: e.date, amount: -cash[cur], cur, auto: true });
        cash[cur] = 0;
      }
    } else {
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

export async function render(root) {
  const seq = ++renderSeq;
  const accIds = selectedAccounts();
  const date = asOf || today();
  root.innerHTML = toolbarHtml() + `<div class="card"><div class="empty">시세를 불러오는 중입니다…</div></div>`;
  bindToolbar(root);

  const book = computeBook(accIds, date);
  const syms = book.positions.map((p) => p.symbol);
  let prices = {}, prevPrices = {}, fx = 1350, missing = [];
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
  } catch (err) {
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
    return { ...p, price, value, costD: cost, pnl: value - cost, ret: cost ? (value / cost - 1) * 100 : null, day, sector: sectorOf(p.symbol) };
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

  // 자산 구성
  const donutItems = [
    ...rows.filter((r) => r.value > 0).map((r, i) => ({ label: r.name || r.symbol, sym: r.symbol, value: r.value, color: color(i) })),
    ...cashRows.filter((c) => c.value > 0).map((c) => ({ label: `현금 (${c.cur})`, sym: '현금', value: c.value, color: c.cur === 'KRW' ? 'var(--c9)' : 'var(--c10)' })),
  ];
  const sectors = {};
  rows.forEach((r) => { sectors[r.sector] = (sectors[r.sector] || 0) + r.value; });
  if (cashTotal > 0) sectors['현금'] = cashTotal;
  const sectorList = Object.entries(sectors).sort((a, b) => b[1] - a[1]);
  const acctNames = P().accounts.filter((a) => accIds.includes(a.id)).map((a) => a.name);

  root.innerHTML = toolbarHtml() + `
  <div class="stats">
    <div class="stat"><div class="k">${asOf ? esc(asOf) + ' 기준 ' : ''}순자산</div><div class="v">${m(total)}</div><div class="s muted">${acctNames.length}개 계좌 · ${esc(acctNames.join(', '))}</div></div>
    <div class="stat"><div class="k">평가손익 (보유 중)</div><div class="v ${cls(unreal)}">${m(unreal)}</div><div class="s ${cls(unreal)}">${fmtPct(costTotal ? unreal / costTotal * 100 : null)}</div></div>
    <div class="stat"><div class="k">실현손익 (매도 누적)</div><div class="v ${cls(realized)}">${m(realized)}</div><div class="s muted">수수료 반영</div></div>
    <div class="stat"><div class="k">${asOf ? '기준일 환율' : '오늘 변동'}</div>${asOf ? `<div class="v">${fmtNum(fx, 2)}</div><div class="s muted">USD/KRW</div>` : `<div class="v ${cls(dayTotal)}">${m(dayTotal)}</div><div class="s ${cls(dayTotal)}">${fmtPct(total - dayTotal ? dayTotal / (total - dayTotal) * 100 : null)} · 환율 ${fmtNum(fx, 2)}</div>`}</div>
  </div>

  <div class="card">
    <div class="card-head"><h2>자산 구성</h2>${missing.length ? `<span class="small muted">시세 없음(원가 표시): ${esc(missing.join(', '))}</span>` : ''}</div>
    <div class="donut-wrap">
      ${donut(donutItems, { top: '선택 계좌 순자산', value: hide() ? '••••' : fmtMoney(total, D), sub: `${acctNames.length}개 계좌 선택` })}
      <div class="legend">${donutItems.length ? donutItems.slice(0, 12).map((d) => `<div><span class="dot" style="background:${d.color}"></span>${esc(d.label)}<span class="lv">${fmtPct(total ? d.value / total * 100 : 0, 1, false)}</span></div>`).join('') : '<div class="muted">표시할 자산이 없습니다. 아래에서 입금이나 매매를 기록해 보세요.</div>'}</div>
    </div>
    <div class="table-wrap" style="margin-top:16px">
      <table class="tbl">
        <thead><tr><th>자산</th><th class="num">수량</th><th class="num">평균단가</th><th class="num">${asOf ? '기준일가' : '현재가'}</th><th class="num">평가금액</th><th class="num">평가손익</th><th class="num">수익률</th><th class="num">비중</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>
            <td data-open="${esc(r.symbol)}" style="cursor:pointer" title="종목 상세 보기"><div class="sym">${esc(r.symbol)}</div><div class="sub">${esc(r.name)} · ${esc(r.sector)}</div></td>
            <td class="num">${q(r.qty)}</td>
            <td class="num">${hide() ? '••••' : fmtMoney(r.cost / r.qty, r.cur)}</td>
            <td class="num">${r.price != null ? fmtMoney(r.price, r.cur) : '—'}</td>
            <td class="num">${m(r.value)}</td>
            <td class="num ${cls(r.pnl)}">${m(r.pnl)}</td>
            <td class="num ${cls(r.ret)}">${fmtPct(r.ret)}</td>
            <td class="num">${fmtPct(total ? r.value / total * 100 : null, 1, false)}</td>
          </tr>`).join('')}
          ${cashRows.map((c) => `<tr><td><div class="sym"><span class="dot" style="background:var(--c9)"></span> 현금 ${c.cur}</div><div class="sub">선택 계좌 합산</div></td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">${m(c.value)}</td><td class="num">—</td><td class="num">—</td><td class="num">${fmtPct(total ? c.value / total * 100 : null, 1, false)}</td></tr>`).join('')}
          ${!rows.length && !cashRows.length ? '<tr><td colspan="8" class="empty">보유 자산이 없습니다.</td></tr>' : ''}
        </tbody>
        ${rows.length || cashRows.length ? `<tfoot><tr><td>합계</td><td></td><td></td><td></td><td class="num">${m(total)}</td><td class="num ${cls(unreal)}">${m(unreal)}</td><td class="num ${cls(unreal)}">${fmtPct(costTotal ? unreal / costTotal * 100 : null)}</td><td class="num">100%</td></tr></tfoot>` : ''}
      </table>
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h2>섹터별 보유 비중</h2></div>
      ${sectorList.length ? sectorList.map(([name, v], i) => `<div class="bar-row"><span>${esc(name)}</span><div class="bar"><span style="width:${total ? (v / total * 100).toFixed(1) : 0}%;background:${name === '현금' ? 'var(--c9)' : color(i)}"></span></div><span class="num">${m(v)}</span><span class="num">${fmtPct(total ? v / total * 100 : 0, 1, false)}</span></div>`).join('') : '<div class="empty">보유 자산이 없습니다.</div>'}
    </div>
    <div class="card" id="dietz-card">
      <div class="card-head"><h2>보정 수익률</h2><span class="tag">입출금 보정 · 추정</span></div>
      <div class="empty">월별 수익률 계산 중…</div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>기록</h2>
      <div class="seg" id="rec-seg"><button data-t="trades" class="${recordTab === 'trades' ? 'on' : ''}">매매기록 ${P().trades.filter((t) => accIds.includes(t.accountId)).length}건</button><button data-t="flows" class="${recordTab === 'flows' ? 'on' : ''}">입출금·배당 ${P().flows.filter((t) => accIds.includes(t.accountId)).length}건</button></div>
      <button class="btn btn-sm" id="rec-csv">CSV 저장</button>
    </div>
    <div id="records">${recordsHtml(accIds)}</div>
  </div>`;
  bindToolbar(root);
  bindRecords(root, accIds);
  root.querySelectorAll('[data-open]').forEach((td) => { td.onclick = () => openStockModal(td.dataset.open); });
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
    <button class="btn" data-act="flow">+ 입출금</button>
    <button class="btn btn-primary" data-act="trade">+ 매매 기록</button>
    <select data-act="currency" aria-label="표시 통화"><option value="KRW" ${disp() === 'KRW' ? 'selected' : ''}>KRW · 원화</option><option value="USD" ${disp() === 'USD' ? 'selected' : ''}>USD · 달러</option></select>
  </div>
  <div class="toolbar">${P().accounts.map((a) => `<label class="chip ${accIds.includes(a.id) ? 'on' : ''}"><input type="checkbox" data-acc="${esc(a.id)}" ${accIds.includes(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</div>`;
}

function rerender() { render(document.getElementById('view')); }

function bindToolbar(root) {
  root.querySelector('[data-act=hide]').onclick = () => { updateQuiet('prefs', (p) => { p.hideAmounts = !p.hideAmounts; }); rerender(); };
  root.querySelector('[data-act=currency]').onchange = (e) => { updateQuiet('prefs', (p) => { p.currency = e.target.value; }); rerender(); };
  root.querySelector('[data-act=asof]').onclick = () => {
    if (asOf) { asOf = null; return rerender(); }
    openModal({
      title: '과거 잔고 조회',
      body: `<label class="field">기준일<input type="date" name="date" max="${today()}" value="${today()}" required></label><p class="small muted">그날까지의 기록과 그날 종가로 잔고를 다시 계산합니다.</p>`,
      submitText: '조회',
      onSubmit: (d) => { if (!d.date) throw new Error('날짜를 선택하세요.'); asOf = d.date; rerender(); },
    });
  };
  root.querySelector('[data-act=accounts]').onclick = accountsModal;
  root.querySelector('[data-act=trade]').onclick = () => tradeModal();
  root.querySelector('[data-act=flow]').onclick = () => flowModal();
  root.querySelectorAll('[data-acc]').forEach((cb) => {
    cb.onchange = () => {
      const ids = [...root.querySelectorAll('[data-acc]:checked')].map((x) => x.dataset.acc);
      updateQuiet('portfolio', (p) => { p.selected = ids; });
      rerender();
    };
  });
}

function accName(id) { return P().accounts.find((a) => a.id === id)?.name || '?'; }

function recordsHtml(accIds) {
  const h = hide();
  if (recordTab === 'trades') {
    const list = P().trades.filter((t) => accIds.includes(t.accountId)).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!list.length) return '<div class="empty">매매 기록이 없습니다. “+ 매매 기록”으로 추가하세요.</div>';
    return `<div class="table-wrap"><table class="tbl"><thead><tr><th>날짜</th><th>계좌</th><th>구분</th><th>종목</th><th class="num">수량</th><th class="num">단가</th><th class="num">수수료</th><th class="num">금액</th><th></th></tr></thead><tbody>
      ${list.map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(accName(t.accountId))}</td><td class="${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? '매수' : '매도'}</td>
        <td><span class="sym">${esc(t.symbol)}</span> <span class="sub">${esc(t.name || '')}</span>${t.memo ? `<div class="sub">${esc(t.memo)}</div>` : ''}</td>
        <td class="num">${h ? '••••' : fmtNum(+t.qty, t.qty % 1 ? 4 : 0)}</td><td class="num">${fmtMoney(+t.price, t.currency)}</td><td class="num">${h ? '••••' : fmtMoney(+t.fee || 0, t.currency)}</td>
        <td class="num">${h ? '••••' : fmtMoney(t.qty * t.price, t.currency)}</td>
        <td class="num"><button class="btn btn-sm" data-edit-trade="${t.id}">수정</button> <button class="btn btn-sm btn-danger" data-del-trade="${t.id}">삭제</button></td></tr>`).join('')}
    </tbody></table></div>`;
  }
  const list = P().flows.filter((t) => accIds.includes(t.accountId)).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!list.length) return '<div class="empty">입출금 기록이 없습니다. 입출금을 기록하면 수익률이 정확해집니다.</div>';
  return `<div class="table-wrap"><table class="tbl"><thead><tr><th>날짜</th><th>계좌</th><th>구분</th><th class="num">금액</th><th>메모</th><th></th></tr></thead><tbody>
    ${list.map((f) => `<tr><td>${esc(f.date)}</td><td>${esc(accName(f.accountId))}</td><td>${FLOW_LABEL[f.type] || f.type}</td>
      <td class="num ${f.type === 'withdraw' || f.type === 'fee' ? 'down' : 'up'}">${h ? '••••' : fmtMoney(+f.amount, f.currency)}</td><td>${esc(f.memo || '')}</td>
      <td class="num"><button class="btn btn-sm" data-edit-flow="${f.id}">수정</button> <button class="btn btn-sm btn-danger" data-del-flow="${f.id}">삭제</button></td></tr>`).join('')}
  </tbody></table></div>`;
}

function bindRecords(root, accIds) {
  root.querySelectorAll('#rec-seg button').forEach((b) => {
    b.onclick = () => { recordTab = b.dataset.t; root.querySelectorAll('#rec-seg button').forEach((x) => x.classList.toggle('on', x === b)); root.querySelector('#records').innerHTML = recordsHtml(accIds); bindRecordRows(root); };
  });
  root.querySelector('#rec-csv').onclick = () => {
    if (recordTab === 'trades') {
      const rows = [['날짜', '계좌', '구분', '종목', '이름', '수량', '단가', '수수료', '통화', '메모'],
        ...P().trades.filter((t) => accIds.includes(t.accountId)).map((t) => [t.date, accName(t.accountId), t.side === 'buy' ? '매수' : '매도', t.symbol, t.name, t.qty, t.price, t.fee || 0, t.currency, t.memo || ''])];
      download(`매매기록-${today()}.csv`, toCsv(rows), 'text/csv');
    } else {
      const rows = [['날짜', '계좌', '구분', '금액', '통화', '메모'],
        ...P().flows.filter((t) => accIds.includes(t.accountId)).map((f) => [f.date, accName(f.accountId), FLOW_LABEL[f.type], f.amount, f.currency, f.memo || ''])];
      download(`입출금-${today()}.csv`, toCsv(rows), 'text/csv');
    }
  };
  bindRecordRows(root);
}

function bindRecordRows(root) {
  root.querySelectorAll('[data-edit-trade]').forEach((b) => { b.onclick = () => tradeModal(P().trades.find((t) => t.id === b.dataset.editTrade)); });
  root.querySelectorAll('[data-edit-flow]').forEach((b) => { b.onclick = () => flowModal(P().flows.find((t) => t.id === b.dataset.editFlow)); });
  root.querySelectorAll('[data-del-trade]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmModal('이 매매 기록을 삭제할까요? (최근 변경 되돌리기로 복구할 수 있습니다)'))) return;
      update('portfolio', (p) => { p.trades = p.trades.filter((t) => t.id !== b.dataset.delTrade); }, '매매 기록 삭제');
      rerender();
    };
  });
  root.querySelectorAll('[data-del-flow]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmModal('이 입출금 기록을 삭제할까요?'))) return;
      update('portfolio', (p) => { p.flows = p.flows.filter((t) => t.id !== b.dataset.delFlow); }, '입출금 기록 삭제');
      rerender();
    };
  });
}

function accountOptions(sel) {
  return P().accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
}

async function tradeModal(t) {
  const isEdit = !!t;
  t = t || { accountId: selectedAccounts()[0], date: today(), side: 'buy', symbol: '', qty: '', price: '', fee: '', memo: '' };
  let suggestions = '';
  try {
    const d = await market.screener();
    suggestions = d.rows.slice(0, 3000).map((r) => `<option value="${esc(r.s)}">${esc(r.n)}</option>`).join('');
  } catch { /* 자동완성 없이 */ }
  openModal({
    title: isEdit ? '매매 기록 수정' : '매매 기록 추가',
    body: `<div class="form-grid">
      <label class="field">계좌<select name="accountId">${accountOptions(t.accountId)}</select></label>
      <label class="field">날짜<input type="date" name="date" value="${esc(t.date)}" max="${today()}" required></label>
      <label class="field">구분<select name="side"><option value="buy" ${t.side === 'buy' ? 'selected' : ''}>매수</option><option value="sell" ${t.side === 'sell' ? 'selected' : ''}>매도</option></select></label>
      <label class="field">종목 (티커)<input name="symbol" list="sym-list" value="${esc(t.symbol)}" placeholder="예: NVDA, 005930.KS" autocomplete="off" required></label>
      <datalist id="sym-list">${suggestions}</datalist>
      <label class="field">수량<input name="qty" type="number" step="any" min="0" value="${esc(t.qty)}" required></label>
      <label class="field">단가 <span data-cur></span><input name="price" type="number" step="any" min="0" value="${esc(t.price)}" required></label>
      <label class="field">수수료·세금<input name="fee" type="number" step="any" min="0" value="${esc(t.fee || '')}"></label>
      <div class="field" style="justify-content:flex-end"><button type="button" class="btn" data-fill>그날 종가 채우기</button></div>
      <label class="field full">메모<input name="memo" value="${esc(t.memo || '')}"></label>
      <p class="small muted full">한국 주식은 코스피 <b>.KS</b>, 코스닥 <b>.KQ</b>를 붙여 입력하세요 (예: 삼성전자 005930.KS). 미국 주식은 달러, 한국 주식은 원화로 기록됩니다.</p>
    </div>`,
    onOpen(form) {
      const symEl = form.symbol, curEl = form.querySelector('[data-cur]');
      const showCur = () => { curEl.textContent = symEl.value ? `(${curOf(symEl.value.trim().toUpperCase())})` : ''; };
      symEl.addEventListener('input', showCur); showCur();
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
      if (d.side === 'sell') {
        const held = computeBook([d.accountId], d.date).positions.find((p) => p.symbol === symbol)?.qty || 0;
        const already = isEdit && t.side === 'sell' && t.symbol === symbol && t.accountId === d.accountId ? +t.qty : 0;
        if (qty > held + already + 1e-9) throw new Error(`그 날짜 기준 보유 수량(${fmtNum(held + already, 4)})보다 많이 팔 수 없습니다.`);
      }
      let name = market.lookup(symbol)?.n;
      if (!name) { try { name = (await market.quotes([symbol]))[symbol]?.name; } catch { /* 이름 없음 */ } }
      const rec = { id: t.id || uid(), accountId: d.accountId, date: d.date, side: d.side, symbol, name: name || symbol, qty, price, fee: +d.fee || 0, currency: curOf(symbol), memo: d.memo || '' };
      update('portfolio', (p) => {
        if (isEdit) p.trades = p.trades.map((x) => (x.id === rec.id ? rec : x));
        else p.trades.push(rec);
      }, isEdit ? '매매 기록 수정' : '매매 기록 추가');
      recordTab = 'trades';
      rerender();
    },
  });
}

function flowModal(f) {
  const isEdit = !!f;
  f = f || { accountId: selectedAccounts()[0], date: today(), type: 'deposit', amount: '', currency: 'KRW', memo: '' };
  openModal({
    title: isEdit ? '입출금 수정' : '입출금 · 배당 기록',
    body: `<div class="form-grid">
      <label class="field">계좌<select name="accountId">${accountOptions(f.accountId)}</select></label>
      <label class="field">날짜<input type="date" name="date" value="${esc(f.date)}" max="${today()}" required></label>
      <label class="field">구분<select name="type">${Object.entries(FLOW_LABEL).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">통화<select name="currency"><option ${f.currency === 'KRW' ? 'selected' : ''}>KRW</option><option ${f.currency === 'USD' ? 'selected' : ''}>USD</option></select></label>
      <label class="field">금액<input type="number" step="any" min="0" name="amount" value="${esc(f.amount)}" required></label>
      <label class="field">메모<input name="memo" value="${esc(f.memo || '')}"></label>
      <p class="small muted full">입금·출금은 수익률 계산에서 원금 변동으로 보정되고, 배당·이자는 수익으로 계산됩니다. 환전은 원화 출금 + 달러 입금으로 기록하세요.</p>
    </div>`,
    onSubmit(d) {
      const amount = +d.amount;
      if (!(amount > 0)) throw new Error('금액을 입력하세요.');
      const rec = { id: f.id || uid(), accountId: d.accountId, date: d.date, type: d.type, amount, currency: d.currency, memo: d.memo || '' };
      update('portfolio', (p) => {
        if (isEdit) p.flows = p.flows.map((x) => (x.id === rec.id ? rec : x));
        else p.flows.push(rec);
      }, isEdit ? '입출금 수정' : '입출금 추가');
      recordTab = 'flows';
      rerender();
    },
  });
}

function accountsModal() {
  const list = () => P().accounts.map((a) => {
    const n = P().trades.filter((t) => t.accountId === a.id).length + P().flows.filter((t) => t.accountId === a.id).length;
    return `<div class="toolbar" style="margin-bottom:6px"><input data-name="${esc(a.id)}" value="${esc(a.name)}" style="flex:1"><span class="small muted">${n}건</span><button type="button" class="btn btn-sm btn-danger" data-del="${esc(a.id)}">삭제</button></div>`;
  }).join('');
  const { form } = openModal({
    title: '포트폴리오 관리',
    body: `<p class="small muted">계좌(포트폴리오)를 여러 개 만들고 위에서 골라 합산해 볼 수 있습니다.</p><div data-list>${list()}</div>
      <label class="toolbar"><input name="newName" placeholder="새 계좌 이름 (예: 연금계좌)" style="flex:1"><button type="button" class="btn" data-add>추가</button></label>
      <label class="toolbar small"><input type="checkbox" name="autoFund" ${P().autoFund !== false ? 'checked' : ''}> 입금 기록 없이 매수하면 부족한 금액을 자동 입금으로 간주</label>`,
    submitText: '저장',
    onOpen(form) {
      const bind = () => {
        form.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = () => {
            const id = b.dataset.del;
            if (P().accounts.length <= 1) return toast('계좌는 최소 1개가 필요합니다.');
            const n = P().trades.filter((t) => t.accountId === id).length + P().flows.filter((t) => t.accountId === id).length;
            if (n && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = `기록 ${n}건 함께 삭제?`; return; }
            update('portfolio', (p) => {
              p.accounts = p.accounts.filter((a) => a.id !== id);
              p.trades = p.trades.filter((t) => t.accountId !== id);
              p.flows = p.flows.filter((t) => t.accountId !== id);
            }, '계좌 삭제');
            form.querySelector('[data-list]').innerHTML = list(); bind();
          };
        });
      };
      bind();
      form.querySelector('[data-add]').onclick = () => {
        const name = form.newName.value.trim();
        if (!name) return;
        update('portfolio', (p) => { const id = uid(); p.accounts.push({ id, name, currency: 'KRW' }); p.selected = [...(p.selected || []), id]; }, '계좌 추가');
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
      }, '계좌 이름 변경');
      rerender();
    },
  });
  return form;
}

// ---------- 월별 보정 수익률 ----------
async function renderDietz(card, accIds, seq) {
  const D = disp();
  const allBook = computeBook(accIds);
  const firstDates = [...P().trades, ...P().flows].filter((x) => accIds.includes(x.accountId)).map((x) => x.date).sort();
  if (!firstDates.length) {
    card.innerHTML = `<div class="card-head"><h2>보정 수익률</h2><span class="tag">입출금 보정 · 추정</span></div><div class="empty">기록이 쌓이면 월별 수익률을 계산합니다.</div>`;
    return;
  }
  const now = asOf || today();
  const year = now.slice(0, 4);
  const startYm = firstDates[0] > `${year}-01-01` ? firstDates[0].slice(0, 7) : `${year}-01`;
  // 월 구간: 각 월의 시작 기준일(전월말)과 종료일
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
  if (seq !== renderSeq) return;
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
      const amt = conv(f.amount, f.cur, D, fxAt(f.date));
      // 거래일 당일 장 마감 기준으로 평가하므로 당일 입금은 해당일 시작에 들어온 것으로 간주
      const w = (Date.parse(m.end) - Date.parse(f.date) + 864e5) / 864e5 / days;
      F += amt; W += Math.min(1, w) * amt;
    }
    let pnl = null, ret = null;
    if (v0 != null && v1 != null) {
      pnl = v1 - v0 - F;
      const denom = v0 + W;
      ret = denom > 0 ? (pnl / denom) * 100 : null;
      if (ret != null) cumFactor *= 1 + ret / 100;
      cumPnl += pnl;
    }
    rows.push({ ...m, v1, pnl, ret, cumPnl, cumRet: (cumFactor - 1) * 100 });
  }
  const m = (v) => (hide() ? '••••' : fmtMoney(v, D));
  const last = rows[rows.length - 1];
  const ytdRows = rows.filter((r) => r.ym.startsWith(year));
  const ytd = ytdRows.reduce((f, r) => (r.ret != null ? f * (1 + r.ret / 100) : f), 1);
  card.innerHTML = `<div class="card-head"><h2>보정 수익률</h2><span class="tag">입출금 보정 · 추정</span></div>
    <div class="stats" style="margin-bottom:12px">
      <div class="stat"><div class="k">YTD</div><div class="v ${cls(ytd - 1)}">${fmtPct((ytd - 1) * 100)}</div></div>
      <div class="stat"><div class="k">이번 달 (${last.ym.slice(5)}월)</div><div class="v ${cls(last.ret)}">${fmtPct(last.ret)}</div><div class="s ${cls(last.pnl)}">${m(last.pnl)}</div></div>
    </div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>기준</th><th class="num">총자산</th><th class="num">기간 손익</th><th class="num">기간 수익률</th><th class="num">누적 수익률</th></tr></thead><tbody>
      ${rows.slice().reverse().map((r) => `<tr><td>${r.end}</td><td class="num">${m(r.v1)}</td><td class="num ${cls(r.pnl)}">${m(r.pnl)}</td><td class="num ${cls(r.ret)}">${fmtPct(r.ret)}</td><td class="num ${cls(r.cumRet)}">${fmtPct(r.cumRet)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">입출금 날짜를 가중한 Modified Dietz 추정치입니다. 기록되지 않은 입출금은 보정할 수 없고, 시세가 없는 기간은 —로 표시합니다.</p>`;
}
