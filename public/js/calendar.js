// 실적발표 캘린더: 내가 등록한 일정 + Nasdaq 실적 발표 일정 자동 표시
import { state, update, updateQuiet, market, api, watchAll, esc, uid, today, openModal, confirmModal, toast, fmtCap } from './core.js';
import { computeBook } from './portfolio.js';

let ym = today().slice(0, 7);
let scope = 'mine'; // all: 시가총액 $10B 이상 전체 / mine: 관심종목·보유종목
const TIME = { BMO: '장 전', AMC: '장 후', '': '' };

function mySymbols() {
  const held = computeBook(state.portfolio.accounts.map((a) => a.id)).positions.map((p) => p.symbol);
  return new Set([...watchAll(), ...held]);
}

export async function render(root) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = first.getDay();
  const daysIn = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m - 1, 1 - startDow + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    cells.push({ iso, day: d.getDate(), other: d.getMonth() !== m - 1 });
  }
  const rowsNeeded = Math.ceil((startDow + daysIn) / 7);
  const showAuto = state.calendar.showAuto !== false;

  root.innerHTML = `
  <div class="toolbar">
    <button class="btn icon-btn" id="cal-prev" aria-label="이전 달">‹</button>
    <input type="month" id="cal-month" value="${ym}" style="width:160px">
    <button class="btn icon-btn" id="cal-next" aria-label="다음 달">›</button>
    <button class="btn" id="cal-today">오늘</button>
    <span style="flex:1"></span>
    <span class="small muted">미국 동부 · ET</span>
    <select id="cal-scope"><option value="mine" ${scope === 'mine' ? 'selected' : ''}>관심·보유 종목만</option><option value="all" ${scope === 'all' ? 'selected' : ''}>전체 (시총 $10B 이상)</option></select>
    <label class="chip ${showAuto ? 'on' : ''}"><input type="checkbox" id="cal-auto" ${showAuto ? 'checked' : ''}> Nasdaq 실적일 자동 표시</label>
    <button class="btn btn-primary" id="cal-add">+ 일정 추가</button>
  </div>
  <div class="grid-cal" style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px">
    <div class="card" style="padding:0;overflow:hidden">
      <div class="cal" id="cal-grid">
        ${['일', '월', '화', '수', '목', '금', '토'].map((d) => `<div class="dow">${d}</div>`).join('')}
        ${cells.slice(0, rowsNeeded * 7).map((c) => `<div class="day ${c.other ? 'other' : ''} ${c.iso === today() ? 'today' : ''}" data-date="${c.iso}"><span class="dn">${c.day}</span><div data-evs></div></div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>이달의 일정</h2><span class="tag" id="cal-count">0건</span></div>
      <div id="cal-list" class="small"></div>
      <p class="small muted" style="margin-top:12px">날짜를 누르면 일정을 추가할 수 있습니다.<br><a href="https://www.nasdaq.com/market-activity/earnings" target="_blank" rel="noopener">전체 기업 실적발표 일정 보기 ↗</a></p>
    </div>
  </div>
  <style>@media (max-width: 960px){ .grid-cal{ grid-template-columns: 1fr !important; } }</style>`;

  const go = (v) => { ym = v; render(root); };
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1); go(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  root.querySelector('#cal-prev').onclick = () => shift(-1);
  root.querySelector('#cal-next').onclick = () => shift(1);
  root.querySelector('#cal-today').onclick = () => go(today().slice(0, 7));
  root.querySelector('#cal-month').onchange = (e) => e.target.value && go(e.target.value);
  root.querySelector('#cal-scope').onchange = (e) => { scope = e.target.value; render(root); };
  root.querySelector('#cal-auto').onchange = (e) => { updateQuiet('calendar', (c) => { c.showAuto = e.target.checked; }); render(root); };
  root.querySelector('#cal-add').onclick = () => eventModal({ date: ym === today().slice(0, 7) ? today() : `${ym}-01` }, root);
  root.querySelectorAll('[data-date]').forEach((el) => {
    el.onclick = (e) => {
      const evId = e.target.closest('[data-ev]')?.dataset.ev;
      if (evId) return eventModal(state.calendar.events.find((x) => x.id === evId), root);
      eventModal({ date: el.dataset.date }, root);
    };
  });

  const mine = state.calendar.events.filter((e) => e.date.startsWith(ym)).map((e) => ({ ...e, auto: false }));
  paint(root, mine);
  if (!showAuto) return;
  try {
    await market.screener().catch(() => null);
    const auto = await api(`/api/market/earnings?month=${ym}`);
    if (!root.isConnected || ym !== `${y}-${String(m).padStart(2, '0')}`) return;
    const my = mySymbols();
    const own = new Set(mine.map((e) => `${e.date}|${e.symbol}`));
    const filtered = auto.filter((e) => (scope === 'mine' ? my.has(e.s) : (e.mc || market.lookup(e.s)?.mc || 0) >= 10e9))
      .filter((e) => !own.has(`${e.date}|${e.s}`))
      .map((e) => ({ id: 'a:' + e.date + e.s, date: e.date, symbol: e.s, title: e.n, time: e.time, memo: `${e.q ? e.q + ' 분기' : ''}${e.est ? ' · 예상 EPS ' + e.est : ''}${e.mc ? ' · 시총 $' + fmtCap(e.mc) : ''}`, mc: e.mc || 0, auto: true }));
    paint(root, [...mine, ...filtered]);
  } catch {
    toast('Nasdaq 실적 일정을 불러오지 못했습니다.');
  }
}

function paint(root, events) {
  const byDate = {};
  // 같은 날: 내 일정 먼저, 그다음 시가총액 큰 순
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.auto - b.auto) || ((b.mc || 0) - (a.mc || 0)))).forEach((e) => { (byDate[e.date] ||= []).push(e); });
  root.querySelectorAll('[data-date]').forEach((cell) => {
    const list = byDate[cell.dataset.date] || [];
    cell.querySelector('[data-evs]').innerHTML = list.slice(0, 4).map((e) => `<div class="ev ${e.auto ? 'auto' : ''}" ${e.auto ? '' : `data-ev="${e.id}"`} title="${esc(e.symbol || '')} ${esc(e.title || '')}${e.time ? ' · ' + TIME[e.time] : ''} ${esc(e.memo || '')}">${esc(e.symbol || e.title)}</div>`).join('') + (list.length > 4 ? `<div class="more">+${list.length - 4}건</div>` : '');
  });
  root.querySelector('#cal-count').textContent = `${events.length}건`;
  root.querySelector('#cal-list').innerHTML = events.length ? events.map((e) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
    <div><b>${esc(e.date.slice(5))}</b> ${e.time ? `<span class="tag">${TIME[e.time]}</span>` : ''} <b>${esc(e.symbol || '')}</b> ${esc(e.title || '')} ${e.auto ? '<span class="tag">자동</span>' : `<button class="btn btn-sm" data-ev-edit="${e.id}">수정</button>`}</div>
    ${e.memo ? `<div class="muted">${esc(e.memo)}</div>` : ''}</div>`).join('') : '<div class="empty">등록된 일정이 없습니다.<br>달력의 날짜를 눌러 관심종목 발표일을 추가해 보세요.</div>';
  root.querySelectorAll('[data-ev-edit]').forEach((b) => { b.onclick = () => eventModal(state.calendar.events.find((x) => x.id === b.dataset.evEdit), root); });
}

function eventModal(ev, root) {
  const isEdit = !!ev.id;
  openModal({
    title: isEdit ? '일정 수정' : '일정 추가',
    body: `<div class="form-grid">
      <label class="field">날짜<input type="date" name="date" value="${esc(ev.date)}" required></label>
      <label class="field">시간<select name="time"><option value="">미정</option><option value="BMO" ${ev.time === 'BMO' ? 'selected' : ''}>장 전 발표</option><option value="AMC" ${ev.time === 'AMC' ? 'selected' : ''}>장 후 발표</option></select></label>
      <label class="field">종목<input name="symbol" value="${esc(ev.symbol || '')}" placeholder="예: NVDA"></label>
      <label class="field">제목<input name="title" value="${esc(ev.title || '')}" placeholder="예: 3분기 실적"></label>
      <label class="field full">메모<textarea name="memo" rows="3">${esc(ev.memo || '')}</textarea></label>
    </div>`,
    extraButtons: isEdit ? '<button type="button" class="btn btn-danger" data-del>삭제</button>' : '',
    onOpen(form, close) {
      form.querySelector('[data-del]')?.addEventListener('click', async () => {
        close();
        if (!(await confirmModal('이 일정을 삭제할까요?'))) return;
        update('calendar', (c) => { c.events = c.events.filter((x) => x.id !== ev.id); }, '일정 삭제');
        render(root);
      });
    },
    onSubmit(d) {
      const symbol = d.symbol.trim().toUpperCase();
      if (!symbol && !d.title.trim()) throw new Error('종목이나 제목을 입력하세요.');
      const rec = { id: ev.id || uid(), date: d.date, time: d.time, symbol, title: d.title.trim(), memo: d.memo.trim() };
      update('calendar', (c) => { c.events = isEdit ? c.events.map((x) => (x.id === rec.id ? rec : x)) : [...c.events, rec]; }, isEdit ? '일정 수정' : '일정 추가');
      ym = rec.date.slice(0, 7);
      render(root);
    },
  });
}
