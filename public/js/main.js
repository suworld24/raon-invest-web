import { state, loadState, onChange, updateQuiet, undo, exportBackup, importBackup, market, api, esc, toast, watchAll, today, fmtPct, cls, openModal } from './core.js';
import * as portfolio from './portfolio.js';
import * as watchlist from './watchlist.js';
import * as screener from './screener.js';
import * as industry from './industry.js';
import { computeBook } from './portfolio.js';
import { alertHit, openStockModal } from './stock.js';
import * as sectors from './sectors.js';
import * as ranking from './ranking.js';
import * as calendar from './calendar.js';
import * as notes from './notes.js';

const ICON = {
  portfolio: '<path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  watchlist: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  screener: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  industry: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  sectors: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  ranking: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  notes: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
};
const TABS = [
  ['portfolio', '포트폴리오', portfolio],
  ['watchlist', '관심종목', watchlist],
  ['screener', '기업 스크리너', screener],
  ['industry', '산업분석', industry],
  ['sectors', '섹터 퍼포먼스', sectors],
  ['ranking', '랭킹 테이블', ranking],
  ['calendar', '실적발표 캘린더', calendar],
  ['notes', '참고자료', notes],
];
const view = document.getElementById('view');
let current = 'portfolio';

function navHtml() {
  return TABS.map(([id, label]) => `<button data-tab="${id}" class="${id === current ? 'on' : ''}" ${id === current ? 'aria-current="page"' : ''}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[id]}</svg>${label}
    ${id === 'watchlist' ? `<span class="badge">${watchAll().length}</span>` : ''}</button>`).join('');
}

function show(tab) {
  if (!TABS.some((t) => t[0] === tab)) tab = 'portfolio';
  current = tab;
  document.getElementById('nav').innerHTML = navHtml();
  document.getElementById('mobile-nav').innerHTML = TABS.map(([id, label]) => `<button class="btn btn-sm ${id === current ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')
    + '<button class="btn btn-sm" data-logout>로그아웃</button>';
  document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => go(b.dataset.tab); });
  document.querySelector('#mobile-nav [data-logout]').onclick = logout;
  const t = TABS.find((x) => x[0] === tab);
  document.getElementById('page-title').textContent = t[1];
  document.title = `${t[1]} · 라온's 투자`;
  view.innerHTML = '';
  // 다른 탭으로 넘어간 뒤 늦게 끝난 렌더가 덮어쓰지 않도록 탭마다 새 컨테이너
  const box = document.createElement('div');
  box.style.display = 'contents';
  view.appendChild(box);
  Promise.resolve(t[2].render(box)).catch((err) => {
    console.error(err);
    box.innerHTML = `<div class="card"><div class="empty">화면을 불러오지 못했습니다: ${esc(err.message)}</div></div>`;
  });
}

function go(tab) {
  if (location.hash !== '#' + tab) history.pushState(null, '', '#' + tab);
  updateQuiet('prefs', (p) => { p.tab = tab; });
  show(tab);
}
window.addEventListener('popstate', () => show(location.hash.slice(1)));
export const rerender = () => show(current);

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login';
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('kk.theme', t); } catch { /* 저장 불가 */ }
  document.querySelectorAll('#theme-seg button').forEach((b) => b.classList.toggle('on', b.dataset.theme === t));
}

// ---------- 주요 변화: 관심·보유 종목의 큰 움직임, 알림 도달, 다가오는 실적 ----------
async function showChanges() {
  const { form } = openModal({ title: '주요 변화', body: '<div class="changes" data-body><div class="empty">확인 중…</div></div>', wide: true });
  const body = form.querySelector('[data-body]');
  const held = computeBook(state.portfolio.accounts.map((a) => a.id)).positions.map((p) => p.symbol);
  const syms = [...new Set([...watchAll(), ...held, ...Object.keys(state.watch.alerts || {})])];
  if (!syms.length) { body.innerHTML = '<div class="empty">관심종목이나 보유 종목이 없습니다.</div>'; return; }
  const t0 = today();
  const t7 = new Date(Date.parse(t0) + 7 * 864e5).toISOString().slice(0, 10);
  const months = [...new Set([t0.slice(0, 7), t7.slice(0, 7)])];
  const [q, ...earn] = await Promise.all([
    market.quotes(syms).catch(() => ({})),
    ...months.map((m) => api(`/api/market/earnings?month=${m}`).catch(() => [])),
  ]);
  if (!body.isConnected) return;
  const mine = new Set(syms);
  const movers = syms.filter((s) => q[s]?.chg != null).sort((a, b) => Math.abs(q[b].chg) - Math.abs(q[a].chg));
  const big = movers.filter((s) => Math.abs(q[s].chg) >= 3);
  const hits = syms.map((s) => [s, alertHit(s, q[s]?.p)]).filter(([, h]) => h);
  const upcoming = [
    ...earn.flat().filter((e) => mine.has(e.s) && e.date >= t0 && e.date <= t7).map((e) => ({ date: e.date, s: e.s, text: `실적 발표${e.time === 'BMO' ? ' (장 전)' : e.time === 'AMC' ? ' (장 후)' : ''}` })),
    ...state.calendar.events.filter((e) => e.date >= t0 && e.date <= t7).map((e) => ({ date: e.date, s: e.symbol, text: e.title || '내 일정' })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  const row = (s, extra = '') => `<li><a href="#" data-open="${esc(s)}"><b>${esc(s)}</b></a> <span class="muted small">${esc(q[s]?.name || '')}</span> <span class="${cls(q[s]?.chg)}">${fmtPct(q[s]?.chg)}</span> ${extra}</li>`;
  body.innerHTML = `
    <h3 style="margin:4px 0 6px">🔔 가격 알림 도달</h3>
    ${hits.length ? `<ul>${hits.map(([s, h]) => row(s, `<span class="tag">${esc(h)}</span>`)).join('')}</ul>` : '<p class="muted small">도달한 알림이 없습니다.</p>'}
    <h3 style="margin:14px 0 6px">오늘 크게 움직인 종목 (±3% 이상)</h3>
    ${big.length ? `<ul>${big.map((s) => row(s, held.includes(s) ? '<span class="tag">보유</span>' : '')).join('')}</ul>` : '<p class="muted small">±3% 이상 움직인 종목이 없습니다.</p>'}
    <h3 style="margin:14px 0 6px">앞으로 7일 일정</h3>
    ${upcoming.length ? `<ul>${upcoming.map((u) => `<li><b>${esc(u.date.slice(5))}</b> ${u.s ? `<a href="#" data-open="${esc(u.s)}">${esc(u.s)}</a>` : ''} ${esc(u.text)}</li>`).join('')}</ul>` : '<p class="muted small">7일 안에 예정된 실적 발표나 일정이 없습니다.</p>'}
    <h3 style="margin:14px 0 6px">관심·보유 종목 등락 순위</h3>
    <ul>${movers.slice(0, 10).map((s) => row(s)).join('')}</ul>`;
  body.querySelectorAll('[data-open]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); openStockModal(a.dataset.open); }; });
}

// ---------- 앱 설치 (PWA) ----------
let installEvt = null;
function setupInstall() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
  const btn = document.getElementById('install');
  if (window.matchMedia('(display-mode: standalone)').matches) { btn.hidden = true; return; }
  btn.onclick = async () => {
    if (installEvt) {
      installEvt.prompt();
      await installEvt.userChoice.catch(() => null);
      installEvt = null;
      return;
    }
    openModal({
      title: '앱 설치',
      body: `<p>홈 화면에 추가하면 앱처럼 바로 열 수 있습니다.</p>
        <ul style="line-height:1.8"><li><b>아이폰 (Safari)</b>: 아래 공유 버튼 → “홈 화면에 추가”</li>
        <li><b>안드로이드 (Chrome)</b>: 오른쪽 위 ⋮ → “앱 설치” 또는 “홈 화면에 추가”</li>
        <li><b>PC (Chrome·Edge)</b>: 주소창 오른쪽의 설치 아이콘(⊕)</li></ul>`,
    });
  };
}

async function boot() {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  document.getElementById('changes').onclick = showChanges;
  setupInstall();
  document.querySelectorAll('#theme-seg button').forEach((b) => { b.onclick = () => setTheme(b.dataset.theme); });
  document.getElementById('logout').onclick = logout;
  document.getElementById('refresh').onclick = () => { market.clear(); toast('시세를 새로 불러옵니다.'); rerender(); };
  document.getElementById('undo').onclick = undo;
  document.getElementById('backup').onclick = exportBackup;
  const file = document.getElementById('restore-file');
  document.getElementById('restore').onclick = () => file.click();
  file.onchange = async () => {
    try { const n = await importBackup(file.files[0]); toast(`백업에서 ${n}개 항목을 불러왔습니다.`); } catch (err) { toast('불러오기 실패: ' + err.message); }
    file.value = '';
  };
  onChange(() => rerender());

  try {
    const [me] = await Promise.all([api('/api/me'), loadState()]);
    document.getElementById('user-chip').innerHTML = `${me.picture ? `<img src="${esc(me.picture)}" alt="" referrerpolicy="no-referrer">` : ''}<div class="who"><b>${esc(me.name || '')}</b><div class="muted">${esc(me.email || '')}</div></div>`;
  } catch (err) {
    if (err.message === 'login') return;
    toast('기록을 불러오지 못했습니다. 이 기기의 사본을 사용합니다.');
  }
  market.screener().catch(() => null); // 미리 받아두기
  show(location.hash.slice(1) || state.prefs.tab || 'portfolio');
}
boot();
