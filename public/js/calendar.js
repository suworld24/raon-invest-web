// 실적발표 캘린더: 직접 등록한 일정 + 실적 벨을 켠 종목의 다음 실적일(확정·예상) + 시장 전체(선택)
import { state, update, market, api, esc, uid, today, openModal, confirmModal, toast, fmtCap, fmtNum } from './core.js';
import { metricsFor } from './metrics.js';
import { openStockModal } from './stock.js';

let ym = today().slice(0, 7);
let scope = 'all'; // all | bell | manual | market | g:<그룹id>
const TIME = { BMO: '장 전', AMC: '장 후', '': '' };

function scopeSymbols() {
  if (scope.startsWith('g:')) return new Set(state.watch.groups.find((g) => g.id === scope.slice(2))?.symbols || []);
  return null;
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
  const scopes = [['all', '전체 일정'], ['bell', '🔔 벨 종목만'], ['manual', '직접 등록한 일정만'], ['market', '시장 전체 (시총 $10B 이상)'], ...state.watch.groups.map((g) => [`g:${g.id}`, `그룹 · ${g.name}`])];

  root.innerHTML = `
  <div class="toolbar">
    <button class="btn icon-btn" id="cal-prev" aria-label="이전 달">‹</button>
    <input type="month" id="cal-month" value="${ym}" style="width:160px">
    <button class="btn icon-btn" id="cal-next" aria-label="다음 달">›</button>
    <button class="btn" id="cal-today">오늘</button>
    <span style="flex:1"></span>
    <span class="small muted">미국 동부 · ET</span>
    <select id="cal-scope">${scopes.map(([v, l]) => `<option value="${esc(v)}" ${scope === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
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
      <p class="small muted" style="margin-top:12px"><span style="color:var(--ok)">●</span> 확정 <span style="color:var(--muted)">○</span> 예상 <span style="color:var(--primary)">■</span> 직접 등록</p>
      <details class="small muted"><summary>자료 출처 및 사용 안내</summary>
        <p>직접 등록한 일정과 관심종목에서 실적 벨(🔔)을 켠 종목의 다음 실적 일정을 함께 표시합니다. 회사가 발표일을 확정했으면 ●, 과거 발표 패턴으로 추정한 날짜면 ○로 표시합니다. 장 전·장 후 구분은 Nasdaq 실적 일정을 따릅니다. 같은 종목·날짜에 직접 등록한 일정이 있으면 직접 기록을 우선합니다.</p>
        <p>달력 날짜는 미국 동부시간(뉴욕) 기준입니다. 날짜를 누르면 새 일정을, 일정을 누르면 상세 또는 수정 화면을 엽니다. 관심종목에서 벨을 꺼도 직접 등록한 일정은 남습니다.</p></details>
      <p class="small"><a href="https://www.nasdaq.com/market-activity/earnings" target="_blank" rel="noopener">전체 기업 실적발표 일정 목록 보기 ↗</a></p>
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
  root.querySelector('#cal-add').onclick = () => eventModal({ date: ym === today().slice(0, 7) ? today() : `${ym}-01` }, root);

  const only = scopeSymbols();
  const mine = scope === 'bell' || scope === 'market' ? [] : state.calendar.events
    .filter((e) => e.date.startsWith(ym) && (!only || only.has(e.symbol))).map((e) => ({ ...e, kind: 'manual' }));
  let events = [...mine];
  paint(root, events);
  if (scope === 'manual') return;
  const myMonth = `${y}-${String(m).padStart(2, '0')}`;
  try {
    await market.screener().catch(() => null);
    const nasdaq = await api(`/api/market/earnings?month=${ym}`).catch(() => []);
    const nByS = new Map(nasdaq.map((e) => [e.s, e]));
    const own = new Set(mine.map((e) => `${e.date}|${e.symbol}`));
    const ownSym = new Set(mine.map((e) => e.symbol));
    let autos = [];
    if (scope === 'market') {
      autos = nasdaq.filter((e) => (e.mc || market.lookup(e.s)?.mc || 0) >= 10e9).map((e) => ({ date: e.date, symbol: e.s, name: e.n, time: e.time, est: null, q: e.q, epsEst: e.est, mc: e.mc }));
    } else {
      // 벨 종목의 다음 실적일 (지표 수집본의 확정/예상 + Nasdaq 시간대)
      let bells = state.watch.bells || [];
      if (only) bells = bells.filter((s) => only.has(s));
      const mt = bells.length ? await metricsFor(bells, true) : {};
      for (const s of bells) {
        const f = mt[s]?.f || {};
        const n = nByS.get(s);
        let date = f.nextEarn, estFlag = f.nextEst;
        if (n && (!date || estFlag !== false)) { date = n.date; estFlag = date === f.nextEarn ? estFlag : true; }
        if (!date || !date.startsWith(ym) || ownSym.has(s) && own.has(`${date}|${s}`)) continue;
        autos.push({ date, symbol: s, name: f.name || market.lookup(s)?.n || '', time: n?.date === date ? n.time : '', est: estFlag, q: n?.q, epsEst: f.q0?.eps, revEst: f.q0?.rev, mc: f.mc });
      }
    }
    if (!root.isConnected || ym !== myMonth) return;
    events = [...mine, ...autos.filter((e) => !own.has(`${e.date}|${e.symbol}`)).map((e) => ({ ...e, id: `a:${e.date}:${e.symbol}`, kind: 'auto' }))];
    paint(root, events);
  } catch {
    toast('실적 일정을 불러오지 못했습니다.');
  }
}

const dot = (e) => (e.kind === 'manual' ? '<span style="color:var(--primary)">■</span>' : e.est === false ? '<span style="color:var(--ok)">●</span>' : '<span style="color:var(--muted)">○</span>');

function paint(root, events) {
  const byDate = {};
  // 같은 날: 직접 등록 먼저, 그다음 시가총액 큰 순
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ((a.kind === 'auto') - (b.kind === 'auto')) || ((b.mc || 0) - (a.mc || 0)))).forEach((e) => { (byDate[e.date] ||= []).push(e); });
  const byId = new Map(events.map((e) => [e.id, e]));
  root.querySelectorAll('[data-date]').forEach((cell) => {
    const list = byDate[cell.dataset.date] || [];
    cell.querySelector('[data-evs]').innerHTML = list.slice(0, 4).map((e) => `<div class="ev ${e.kind === 'auto' ? 'auto' : ''}" data-ev="${esc(e.id)}" title="${esc(e.symbol || '')} ${esc(e.name || e.title || '')}${e.time ? ' · ' + TIME[e.time] : ''}${e.kind === 'auto' ? (e.est === false ? ' · 확정' : ' · 예상') : ''}">${dot(e)} ${esc(e.symbol || e.title)}</div>`).join('') + (list.length > 4 ? `<div class="more">+${list.length - 4}건</div>` : '');
  });
  root.querySelector('#cal-count').textContent = `${events.length}건`;
  root.querySelector('#cal-list').innerHTML = events.length ? events.map((e) => `<div style="padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer" data-ev="${esc(e.id)}">
    <div>${dot(e)} <b>${esc(e.date.slice(5))}</b> ${e.time ? `<span class="tag">${TIME[e.time]}</span>` : ''} <b>${esc(e.symbol || '')}</b> ${esc(e.name || e.title || '')} ${e.kind === 'auto' ? `<span class="tag">${e.est === false ? '확정' : '예상'}</span>` : ''}</div>
    ${e.memo ? `<div class="muted">${esc(e.memo)}</div>` : ''}</div>`).join('') : '<div class="empty">이달 일정이 없습니다.<br>관심종목에서 🔔 벨을 켜거나 날짜를 눌러 일정을 추가해 보세요.</div>';
  root.querySelectorAll('[data-ev]').forEach((el) => {
    el.onclick = (ev) => {
      ev.stopPropagation();
      const e = byId.get(el.dataset.ev);
      if (!e) return;
      if (e.kind === 'manual') eventModal(state.calendar.events.find((x) => x.id === e.id), root);
      else autoDetail(e, root);
    };
  });
  root.querySelectorAll('.cal .day').forEach((cell) => {
    cell.onclick = (ev) => { if (ev.target.closest('[data-ev]')) return; eventModal({ date: cell.dataset.date }, root); };
  });
}

function autoDetail(e, root) {
  const money = (v) => (v == null ? '—' : '$' + fmtCap(v));
  openModal({
    title: `${e.symbol} 실적 발표`,
    body: `<div class="kv">
      <div><div class="k">기업</div><div class="v">${esc(e.name || e.symbol)}</div></div>
      <div><div class="k">발표일 (미국 동부)</div><div class="v">${esc(e.date)} ${e.time ? '· ' + TIME[e.time] : ''}</div></div>
      <div><div class="k">상태</div><div class="v">${e.est === false ? '<span style="color:var(--ok)">● 회사 확정</span>' : '○ 예상일'}</div></div>
      <div><div class="k">회계 분기</div><div class="v">${esc(e.q || '—')}</div></div>
      <div><div class="k">EPS 컨센서스</div><div class="v">${e.epsEst == null ? '—' : typeof e.epsEst === 'number' ? e.epsEst.toFixed(2) : esc(e.epsEst)}</div></div>
      <div><div class="k">매출 컨센서스</div><div class="v">${money(e.revEst)}</div></div>
    </div>
    <p class="small muted">장 전(BMO)은 개장 전, 장 후(AMC)는 마감 후 발표입니다. 출처: 회사 발표일 확정 여부는 Yahoo Finance, 시간대는 Nasdaq 실적 일정.</p>`,
    extraButtons: `<button type="button" class="btn" data-open>종목 상세</button><button type="button" class="btn" data-copy>내 일정으로 복사</button>`,
    onOpen(form, close) {
      form.querySelector('[data-open]').onclick = () => { close(); openStockModal(e.symbol); };
      form.querySelector('[data-copy]').onclick = () => {
        close();
        eventModal({ date: e.date, time: e.time, symbol: e.symbol, title: '실적 발표', memo: e.est === false ? '회사 확정일' : '예상일' }, root);
      };
    },
  });
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
