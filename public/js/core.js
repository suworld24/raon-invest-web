// 공통: 포맷 · 저장소 · 시세 클라이언트 · 모달

// ---------- 포맷 ----------
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const clone = (o) => JSON.parse(JSON.stringify(o));

export function fmtNum(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtMoney(v, cur = 'KRW') {
  if (v == null || !Number.isFinite(v)) return '—';
  if (cur === 'USD') return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-' : '') + Math.round(Math.abs(v)).toLocaleString('ko-KR') + '원';
}
export function fmtPct(v, digits = 2, sign = true) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (sign && v > 0 ? '+' : '') + v.toFixed(digits) + '%';
}
export function fmtCap(v) {
  if (v == null || !Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  return fmtNum(v);
}
export const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');
export const isKrx = (s) => /\.(KS|KQ)$/i.test(s);

export function toast(msg, ms = 2400) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function toCsv(rows) {
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\n');
}

// ---------- API ----------
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('login'); }
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ---------- 개인 기록 저장소 ----------
const DEFAULT_SECTORS = [
  ['반도체 설계', ['NVDA', 'AMD', 'AVGO', 'QCOM', 'MRVL', 'ARM', 'MPWR', 'LSCC']],
  ['반도체 장비', ['ASML', 'AMAT', 'LRCX', 'KLAC', 'TER', 'ONTO', 'ENTG']],
  ['메모리·저장', ['MU', 'WDC', 'STX', 'SNDK', 'PSTG', 'NTAP']],
  ['AI 소프트웨어', ['MSFT', 'PLTR', 'NOW', 'CRM', 'SNOW', 'DDOG', 'MDB', 'ADBE']],
  ['클라우드·플랫폼', ['AMZN', 'GOOGL', 'META', 'ORCL', 'NET', 'SHOP']],
  ['사이버보안', ['CRWD', 'PANW', 'FTNT', 'ZS', 'OKTA', 'S', 'CHKP']],
  ['전력·인프라', ['VRT', 'ETN', 'GEV', 'PWR', 'VST', 'CEG', 'NRG']],
  ['원자력', ['CCJ', 'OKLO', 'SMR', 'BWXT', 'LEU', 'NNE']],
  ['우주·방산', ['RKLB', 'LMT', 'NOC', 'RTX', 'GD', 'ASTS', 'LHX']],
  ['헬스케어·바이오', ['LLY', 'NVO', 'ABBV', 'JNJ', 'MRK', 'VRTX', 'REGN', 'ISRG']],
  ['금융', ['JPM', 'BAC', 'GS', 'MS', 'WFC', 'V', 'MA', 'BLK']],
  ['에너지·정유', ['XOM', 'CVX', 'COP', 'MPC', 'VLO', 'PSX', 'OXY']],
  ['소비재', ['WMT', 'COST', 'HD', 'MCD', 'NKE', 'SBUX', 'PG', 'KO']],
  ['크립토', ['COIN', 'MSTR', 'HOOD', 'MARA', 'RIOT', 'CLSK']],
  ['전기차·자율주행', ['TSLA', 'RIVN', 'LCID', 'UBER', 'MBLY', 'XPEV', 'NIO']],
  ['양자컴퓨팅', ['IONQ', 'RGTI', 'QBTS', 'QUBT', 'IBM', 'HON']],
];

export function defaultState() {
  return {
    portfolio: { accounts: [{ id: 'main', name: '내 포트폴리오', currency: 'KRW' }], trades: [], flows: [], selected: ['main'] },
    watch: {
      groups: [
        { id: 'fav', name: '관심', symbols: [] },
        { id: 'm7', name: 'M7', symbols: ['NVDA', 'GOOGL', 'AAPL', 'MSFT', 'AMZN', 'META', 'TSLA'] },
      ],
      alerts: {}, // sym -> { above, below }
    },
    sectors: { list: DEFAULT_SECTORS.map(([name, tickers], i) => ({ id: 's' + i, name, tickers })) },
    industries: { list: [] }, // { id, name, tickers, memo }
    notes: { items: [] },
    calendar: { events: [], showAuto: true },
    screener: { presets: {} },
    ranking: { colors: {} },
    prefs: { hideAmounts: false, currency: 'KRW', tab: 'portfolio' },
  };
}

export const state = defaultState();
const undoStack = [];
const dirty = new Set();
let saveTimer = null;
const listeners = new Set();
// 되돌리기·백업 불러오기처럼 화면 밖에서 기록이 바뀔 때 알림
export const onChange = (fn) => listeners.add(fn);

function setSaveStatus(kind) {
  const el = document.getElementById('save-status');
  if (!el) return;
  const text = { ok: '저장 완료', saving: '저장 중…', err: '저장 실패 · 이 기기에 임시 보관' }[kind];
  el.innerHTML = `<span class="save-dot ${kind === 'ok' ? '' : kind}"></span>${text}`;
}

export async function loadState() {
  let remote = {};
  try {
    remote = await api('/api/state');
  } catch (err) {
    if (err.message === 'login') throw err;
    try { remote = JSON.parse(localStorage.getItem('kk.backup') || '{}'); } catch { remote = {}; }
  }
  migrateWatch(remote.watch);
  const def = defaultState();
  for (const k of Object.keys(def)) state[k] = remote[k] ? { ...def[k], ...remote[k] } : def[k];
}

// 예전 형식(관심종목 목록 하나) → 그룹 형식
function migrateWatch(w) {
  if (!w || Array.isArray(w.groups)) return;
  w.groups = [{ id: 'fav', name: '관심', symbols: [...(w.symbols || [])] }];
  delete w.symbols;
}

// 모든 관심 그룹의 종목 (중복 제거)
export function watchAll() {
  return [...new Set((state.watch.groups || []).flatMap((g) => g.symbols))];
}
export function toggleWatch(sym) {
  const has = watchAll().includes(sym);
  update('watch', (w) => {
    if (has) w.groups.forEach((g) => { g.symbols = g.symbols.filter((s) => s !== sym); });
    else (w.groups[0] ||= { id: 'fav', name: '관심', symbols: [] }).symbols.push(sym);
  }, has ? '관심종목 해제' : '관심종목 추가');
  return !has;
}

async function flush() {
  saveTimer = null;
  const keys = [...dirty];
  dirty.clear();
  setSaveStatus('saving');
  try {
    await Promise.all(keys.map((k) => api(`/api/state/${k}`, { method: 'PUT', body: { data: state[k] } })));
    setSaveStatus('ok');
  } catch (err) {
    keys.forEach((k) => dirty.add(k));
    try { localStorage.setItem('kk.backup', JSON.stringify(state)); } catch { /* 저장 공간 없음 */ }
    setSaveStatus('err');
    saveTimer = setTimeout(flush, 15000);
  }
}
function scheduleSave(key) {
  dirty.add(key);
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
}

// 변경 + 되돌리기 기록 + 저장 예약
export function update(key, mutator, label = '변경') {
  undoStack.push({ key, data: clone(state[key]), label });
  if (undoStack.length > 50) undoStack.shift();
  mutator(state[key]);
  scheduleSave(key);
}
// 되돌리기 기록 없이 저장만 (보기 설정 등)
export function updateQuiet(key, mutator) {
  mutator(state[key]);
  scheduleSave(key);
}
export function undo() {
  const last = undoStack.pop();
  if (!last) return toast('되돌릴 변경이 없습니다.');
  state[last.key] = last.data;
  scheduleSave(last.key);
  listeners.forEach((fn) => fn(last.key));
  toast(`되돌림: ${last.label}`);
}
export function exportBackup() {
  download(`raon-invest-backup-${today()}.json`, JSON.stringify({ app: 'raon-invest-web', version: 1, at: new Date().toISOString(), state }, null, 2), 'application/json');
}
export async function importBackup(file) {
  const json = JSON.parse(await file.text());
  const src = json.state || json;
  migrateWatch(src.watch);
  const def = defaultState();
  const keys = Object.keys(def).filter((k) => src[k] && typeof src[k] === 'object');
  if (!keys.length) throw new Error('백업 파일 형식이 아닙니다.');
  for (const k of keys) {
    undoStack.push({ key: k, data: clone(state[k]), label: '백업 불러오기' });
    state[k] = { ...def[k], ...src[k] };
    scheduleSave(k);
  }
  listeners.forEach((fn) => fn('*'));
  return keys.length;
}
window.addEventListener('beforeunload', (e) => {
  if (dirty.size) { flush(); e.preventDefault(); e.returnValue = ''; }
});

// ---------- 시세 클라이언트 ----------
const qCache = new Map(); // sym -> {t, v}
const hCache = new Map(); // range|sym -> data
const fCache = new Map(); // sym -> fundamentals
const pCache = new Map(); // sym -> Promise<profile>
let screenerP = null;
let screenerIdx = null;

export const market = {
  screener() {
    if (!screenerP) {
      screenerP = api('/api/market/screener').then((d) => {
        screenerIdx = new Map(d.rows.map((r) => [r.s, r]));
        return d;
      }).catch((err) => { screenerP = null; throw err; });
    }
    return screenerP;
  },
  lookup(sym) { return screenerIdx?.get(sym) || null; },
  async quotes(symbols, force = false) {
    const need = [...new Set(symbols)].filter((s) => force || !qCache.has(s) || Date.now() - qCache.get(s).t > 5 * 60e3);
    for (let i = 0; i < need.length; i += 80) {
      const chunk = need.slice(i, i + 80);
      const d = await api('/api/market/quotes?symbols=' + encodeURIComponent(chunk.join(',')));
      for (const s of chunk) qCache.set(s, { t: Date.now(), v: d[s] || null });
    }
    const out = {};
    for (const s of symbols) out[s] = qCache.get(s)?.v || null;
    return out;
  },
  async history(symbols, range = '1y', onProgress) {
    const uniq = [...new Set(symbols)];
    const need = uniq.filter((s) => !hCache.has(range + '|' + s));
    let done = uniq.length - need.length;
    onProgress?.(done, uniq.length);
    const chunks = [];
    for (let i = 0; i < need.length; i += 40) chunks.push(need.slice(i, i + 40));
    // 동시에 3개 묶음씩
    let ci = 0;
    await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, async () => {
      while (ci < chunks.length) {
        const chunk = chunks[ci++];
        let d = {};
        try { d = await api(`/api/market/history?range=${range}&symbols=` + encodeURIComponent(chunk.join(','))); } catch { /* 실패 종목은 빈 값 */ }
        for (const s of chunk) hCache.set(range + '|' + s, d[s] || null);
        done += chunk.length;
        onProgress?.(done, uniq.length);
      }
    }));
    const out = {};
    for (const s of uniq) out[s] = hCache.get(range + '|' + s);
    return out;
  },
  // 밸류에이션·재무·컨센서스 요약 (종목당 한 번 요청, 서버에서 12시간 캐시)
  async fundamentals(symbols, onProgress) {
    const need = [...new Set(symbols)].filter((s) => !fCache.has(s));
    let done = symbols.length - need.length;
    for (let i = 0; i < need.length; i += 25) {
      const chunk = need.slice(i, i + 25);
      let d = {};
      try { d = await api('/api/market/fundamentals?symbols=' + encodeURIComponent(chunk.join(','))); } catch { /* 실패 종목은 빈 값 */ }
      for (const s of chunk) fCache.set(s, d[s] || null);
      done += chunk.length;
      onProgress?.(done, symbols.length);
    }
    const out = {};
    for (const s of symbols) out[s] = fCache.get(s) || null;
    return out;
  },
  async profile(sym) {
    if (!pCache.has(sym)) pCache.set(sym, api('/api/market/profile?symbol=' + encodeURIComponent(sym)).catch((e) => { pCache.delete(sym); throw e; }));
    return pCache.get(sym);
  },
  async fx() {
    const q = await this.quotes(['KRW=X']);
    return q['KRW=X']?.p || 1350;
  },
  clear() { qCache.clear(); hCache.clear(); fCache.clear(); pCache.clear(); screenerP = null; },
};

// 날짜 배열에서 해당 날짜(이하) 마지막 값
export function valueAt(series, date) {
  if (!series || !series.t.length) return null;
  let lo = 0, hi = series.t.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series.t[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? series.c[ans] : null;
}

// ---------- 모달 ----------
export function openModal({ title, body, submitText = '저장', onSubmit, extraButtons = '', onOpen, wide = false }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<form class="modal" style="${wide ? 'width:min(860px,100%)' : ''}" novalidate>
    <h2>${esc(title)}</h2>
    <div class="modal-body">${body}</div>
    <p class="error" data-err></p>
    <div class="actions">${extraButtons}<button type="button" class="btn" data-close>닫기</button>${onSubmit ? `<button class="btn btn-primary" type="submit">${esc(submitText)}</button>` : ''}</div>
  </form>`;
  const form = back.querySelector('form');
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.querySelector('[data-close]').onclick = close;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const r = await onSubmit(data, form);
      if (r !== false) close();
    } catch (err) {
      form.querySelector('[data-err]').textContent = err.message;
    }
  });
  document.body.appendChild(back);
  onOpen?.(form, close);
  form.querySelector('input:not([type=hidden]),select,textarea')?.focus();
  return { form, close };
}

export function confirmModal(message, okText = '삭제') {
  return new Promise((resolve) => {
    let ok = false;
    const { form } = openModal({
      title: '확인',
      body: `<p>${esc(message)}</p>`,
      submitText: okText,
      onSubmit: () => { ok = true; resolve(true); },
    });
    form.querySelector('[data-close]').addEventListener('click', () => { if (!ok) resolve(false); });
  });
}
