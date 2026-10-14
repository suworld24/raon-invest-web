import { state, loadState, onChange, updateQuiet, undo, exportBackup, importBackup, market, api, esc, toast } from './core.js';
import * as portfolio from './portfolio.js';
import * as screener from './screener.js';
import * as sectors from './sectors.js';
import * as ranking from './ranking.js';
import * as calendar from './calendar.js';
import * as notes from './notes.js';

const ICON = {
  portfolio: '<path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  screener: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  sectors: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  ranking: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  notes: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
};
const TABS = [
  ['portfolio', '포트폴리오', portfolio],
  ['screener', '기업 스크리너', screener],
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
    ${id === 'screener' ? `<span class="badge" title="관심종목">★${state.watch.symbols.length}</span>` : ''}</button>`).join('');
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

async function boot() {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
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
