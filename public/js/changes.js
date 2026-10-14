// 주요 변화: 보유·관심종목의 컨센서스(EPS·매출 전망) 변화 · 새 실적 · 발표 일정 변경 기록 + 오늘 요약
import { state, market, api, esc, fmtPct, fmtCap, cls, today, watchAll, openModal } from './core.js';
import { computeBook } from './portfolio.js';
import { alertHit, openStockModal } from './stock.js';

const F = { scope: 'both', kind: 'all', days: 30, per: 'all', min: 0.5, unread: false };
let view = 'log';
const PER = { q0: '이번 분기', q1: '다음 분기', y0: '올해', y1: '내년' };

function readSet() { try { return new Set(JSON.parse(localStorage.getItem('kk.readChanges') || '[]')); } catch { return new Set(); } }
function saveRead(set) { try { localStorage.setItem('kk.readChanges', JSON.stringify([...set].slice(-3000))); } catch { /* 저장 불가 */ } }

function symbols() {
  const held = computeBook(state.portfolio.accounts.map((a) => a.id)).positions.map((p) => p.symbol);
  const watch = [...watchAll(), ...(state.watch.bells || [])];
  return { held: new Set(held), watch: new Set(watch) };
}

export function showChanges() {
  const { form } = openModal({ title: '주요 변화', body: '<div data-body></div>', wide: true });
  draw(form.querySelector('[data-body]'));
}

async function draw(body) {
  body.innerHTML = `<p class="small muted" style="margin-top:-6px">보유·관심종목의 최근 저장 자료</p>
    <div class="toolbar" style="margin-bottom:8px"><div class="seg"><button data-view="log" class="${view === 'log' ? 'on' : ''}">변화 기록</button><button data-view="today" class="${view === 'today' ? 'on' : ''}">오늘 요약</button></div></div>
    <div data-inner><div class="empty">확인 중…</div></div>`;
  body.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { view = b.dataset.view; draw(body); }; });
  const inner = body.querySelector('[data-inner]');
  if (view === 'today') return drawToday(inner);
  return drawLog(inner);
}

async function drawLog(el) {
  const { held, watch } = symbols();
  const scopeSyms = F.scope === 'held' ? held : F.scope === 'watch' ? watch : new Set([...held, ...watch]);
  const sel = (k, list) => `<select data-k="${k}">${list.map(([v, l]) => `<option value="${v}" ${String(F[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  el.innerHTML = `<div class="toolbar">
      ${sel('scope', [['both', '보유 + 관심종목'], ['held', '보유종목'], ['watch', '관심종목']])}
      ${sel('kind', [['all', '모든 변화'], ['consensus', '컨센서스'], ['result', '새 실적'], ['schedule', '발표 일정']])}
      ${sel('days', [[7, '최근 7일'], [30, '최근 30일'], [90, '최근 90일']])}
      ${sel('per', [['all', '모든 전망 기간'], ['y', '연간 전망'], ['q', '분기 전망']])}
      ${sel('min', [[1, '전망 변화 1% 이상'], [0.5, '전망 변화 0.5% 이상'], [0, '작은 변화도 모두']])}
      <label class="chip ${F.unread ? 'on' : ''}"><input type="checkbox" data-k="unread" ${F.unread ? 'checked' : ''}> 읽지 않은 항목만</label>
      <button class="btn btn-sm" data-reload>다시 확인</button>
    </div><div data-list><div class="empty">불러오는 중…</div></div>`;
  el.querySelectorAll('[data-k]').forEach((x) => { x.onchange = () => { F[x.dataset.k] = x.type === 'checkbox' ? x.checked : (x.dataset.k === 'days' || x.dataset.k === 'min' ? +x.value : x.value); drawLog(el); }; });
  el.querySelector('[data-reload]').onclick = () => drawLog(el);
  if (!scopeSyms.size) { el.querySelector('[data-list]').innerHTML = '<div class="empty">보유·관심종목이 없습니다.</div>'; return; }
  let rows = [];
  let status = null;
  try {
    [rows, status] = await Promise.all([
      api(`/api/changes?days=${F.days}&symbols=${encodeURIComponent([...scopeSyms].join(','))}`),
      api('/api/market/sync-status').catch(() => null),
    ]);
  } catch { el.querySelector('[data-list]').innerHTML = '<div class="empty">변화 기록을 불러오지 못했습니다.</div>'; return; }
  if (!el.isConnected) return;
  const read = readSet();
  const list = rows.filter((c) => (F.kind === 'all' || c.kind === F.kind)
    && (c.kind !== 'consensus' || ((F.per === 'all' || c.data.period?.startsWith(F.per)) && Math.abs(c.data.pct ?? 0) >= F.min))
    && (!F.unread || !read.has(c.id)));
  const unread = list.filter((c) => !read.has(c.id)).length;
  const line = (c) => {
    const d = c.data;
    const when = new Date(c.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    let text = '';
    if (c.kind === 'consensus') {
      const up = d.to > d.from;
      const fmt = (v) => (d.field === 'eps' ? v.toFixed(2) : '$' + fmtCap(v));
      text = `<span class="tag">${PER[d.period] || d.period} ${d.field === 'eps' ? 'EPS' : '매출'} 전망</span> ${fmt(d.from)} → <b>${fmt(d.to)}</b> <span class="${up ? 'up' : 'down'}">${up ? '상향' : '하향'} ${fmtPct(d.pct, 2)}</span> <span class="sub">(${esc(d.end || '')} 마감 회계기간)</span>`;
    } else if (c.kind === 'result') {
      const beat = d.act != null && d.est != null ? d.act >= d.est : null;
      text = `<span class="tag">새 실적</span> ${esc(d.q || '')} 분기 EPS <b>${d.act ?? '—'}</b> (예상 ${d.est?.toFixed?.(2) ?? '—'}) ${beat == null ? '' : `<span class="${beat ? 'up' : 'down'}">${beat ? '상회' : '하회'}${d.sp != null ? ' ' + fmtPct(d.sp * 100, 1) : ''}</span>`}`;
    } else {
      text = `<span class="tag">발표 일정</span> ${d.confirmed ? `<b>${esc(d.to)}</b> 회사 확정` : `${esc(d.from || '미정')} → <b>${esc(d.to)}</b> ${d.est === false ? '(확정)' : '(예상)'}`}`;
    }
    return `<li data-id="${c.id}" style="${read.has(c.id) ? 'opacity:.55' : ''}"><span class="sub">${when}</span> <a href="#" data-open="${esc(c.sym)}"><b>${esc(c.sym)}</b></a> ${held.has(c.sym) ? '<span class="tag">보유</span>' : ''} ${text}</li>`;
  };
  el.querySelector('[data-list]').innerHTML = `
    <div class="toolbar" style="margin:6px 0"><span class="small">${list.length}건 · 읽지 않음 ${unread}건</span><button class="btn btn-sm" data-readall ${list.length ? '' : 'disabled'}>표시 항목 읽음</button></div>
    <div class="changes">${list.length ? `<ul>${list.map(line).join('')}</ul>` : '<div class="empty">선택한 조건의 변화가 없습니다.</div>'}</div>
    <p class="small muted">${status?.fundAt ? `저장 자료 점검 ${new Date(status.fundAt).toLocaleString('ko-KR')} · ` : ''}서버가 매일 보유·관심종목의 컨센서스와 실적 일정을 다시 확인해 바뀐 것만 기록합니다. 같은 회계기간의 전망만 비교하며 처음 확인한 값과 변화 없는 재확인은 제외합니다. 기록은 이 기능을 켠 이후부터 쌓입니다. 읽음 표시는 이 기기에 저장됩니다.</p>`;
  el.querySelectorAll('[data-open]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); openStockModal(a.dataset.open); }; });
  el.querySelectorAll('[data-id]').forEach((li) => { li.addEventListener('click', () => { const s = readSet(); s.add(li.dataset.id); saveRead(s); li.style.opacity = '.55'; }); });
  el.querySelector('[data-readall]').onclick = () => { const s = readSet(); list.forEach((c) => s.add(c.id)); saveRead(s); drawLog(el); };
}

async function drawToday(el) {
  const { held, watch } = symbols();
  const syms = [...new Set([...held, ...watch, ...Object.keys(state.watch.alerts || {})])];
  if (!syms.length) { el.innerHTML = '<div class="empty">관심종목이나 보유 종목이 없습니다.</div>'; return; }
  const t0 = today();
  const t7 = new Date(Date.parse(t0) + 7 * 864e5).toISOString().slice(0, 10);
  const months = [...new Set([t0.slice(0, 7), t7.slice(0, 7)])];
  const [q, ...earn] = await Promise.all([market.quotes(syms).catch(() => ({})), ...months.map((m) => api(`/api/market/earnings?month=${m}`).catch(() => []))]);
  if (!el.isConnected) return;
  const mine = new Set(syms);
  const movers = syms.filter((s) => q[s]?.chg != null).sort((a, b) => Math.abs(q[b].chg) - Math.abs(q[a].chg));
  const big = movers.filter((s) => Math.abs(q[s].chg) >= 3);
  const hits = syms.map((s) => [s, alertHit(s, q[s]?.p)]).filter(([, h]) => h);
  const upcoming = [
    ...earn.flat().filter((e) => mine.has(e.s) && e.date >= t0 && e.date <= t7).map((e) => ({ date: e.date, s: e.s, text: `실적 발표${e.time === 'BMO' ? ' (장 전)' : e.time === 'AMC' ? ' (장 후)' : ''}` })),
    ...state.calendar.events.filter((e) => e.date >= t0 && e.date <= t7).map((e) => ({ date: e.date, s: e.symbol, text: e.title || '내 일정' })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  const row = (s, extra = '') => `<li><a href="#" data-open="${esc(s)}"><b>${esc(s)}</b></a> <span class="muted small">${esc(q[s]?.name || '')}</span> <span class="${cls(q[s]?.chg)}">${fmtPct(q[s]?.chg)}</span> ${extra}</li>`;
  el.innerHTML = `<div class="changes">
    <h3 style="margin:4px 0 6px">⏰ 가격 알림 도달</h3>
    ${hits.length ? `<ul>${hits.map(([s, h]) => row(s, `<span class="tag">${esc(h)}</span>`)).join('')}</ul>` : '<p class="muted small">도달한 알림이 없습니다.</p>'}
    <h3 style="margin:14px 0 6px">오늘 크게 움직인 종목 (±3% 이상)</h3>
    ${big.length ? `<ul>${big.map((s) => row(s, held.has(s) ? '<span class="tag">보유</span>' : '')).join('')}</ul>` : '<p class="muted small">±3% 이상 움직인 종목이 없습니다.</p>'}
    <h3 style="margin:14px 0 6px">앞으로 7일 일정</h3>
    ${upcoming.length ? `<ul>${upcoming.map((u) => `<li><b>${esc(u.date.slice(5))}</b> ${u.s ? `<a href="#" data-open="${esc(u.s)}">${esc(u.s)}</a>` : ''} ${esc(u.text)}</li>`).join('')}</ul>` : '<p class="muted small">7일 안에 예정된 실적 발표나 일정이 없습니다.</p>'}
    <h3 style="margin:14px 0 6px">보유·관심 종목 등락 순위</h3>
    <ul>${movers.slice(0, 10).map((s) => row(s)).join('')}</ul></div>`;
  el.querySelectorAll('[data-open]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); openStockModal(a.dataset.open); }; });
}
