// 서버가 미리 계산한 지표(기술·컨센서스)를 불러와 화면용 값으로 풀어내기
import { api } from './core.js';

let allP = null;        // 전체 지표 Promise
let allAt = 0;
const extra = new Map(); // 개별 요청으로 받은 종목

export function loadMetrics(force = false) {
  if (!allP || force || Date.now() - allAt > 10 * 60e3) {
    allAt = Date.now();
    allP = api('/api/market/metrics').catch((e) => { allP = null; throw e; });
  }
  return allP;
}

// 특정 종목들 (수집 대상 밖이면 서버가 즉석 계산) · withFund=true 면 컨센서스도
export async function metricsFor(syms, withFund = false) {
  const all = await loadMetrics().catch(() => ({ rows: {} }));
  const need = syms.filter((s) => !all.rows[s]?.t || (withFund && !all.rows[s]?.f && !extra.get(s)?.f)).filter((s) => !extra.has(s) || (withFund && !extra.get(s).f));
  for (let i = 0; i < need.length; i += 60) {
    const chunk = need.slice(i, i + 60);
    try {
      const d = await api(`/api/market/metrics?symbols=${encodeURIComponent(chunk.join(','))}${withFund ? '&fund=1' : ''}`);
      for (const s of chunk) extra.set(s, d.rows[s] || { t: null, f: null });
    } catch { /* 없음 */ }
  }
  const out = {};
  for (const s of syms) {
    const a = all.rows[s] || {}, b = extra.get(s) || {};
    out[s] = { t: a.t || b.t || null, f: a.f || b.f || null };
  }
  return out;
}

export function row(all, s) {
  const r = all?.rows?.[s];
  if (r) return r;
  return extra.get(s) || { t: null, f: null };
}

// ---------- 파생 지표 ----------
const pos = (v) => (v != null && v > 0 ? v : null);
const ratio = (a, b) => (a != null && b ? a / b : null);
function revision(tr, k) { // tr = [현재, 7일, 30일, 60일, 90일 전]
  if (!tr || tr[0] == null || tr[k] == null || tr[k] === 0) return null;
  return ((tr[0] - tr[k]) / Math.abs(tr[k])) * 100;
}
export function epsState(prev, cur) {
  if (prev == null || cur == null) return null;
  if (prev > 0 && cur > 0) return '흑자 유지';
  if (prev <= 0 && cur > 0) return '흑자전환';
  if (prev < 0 && cur < 0) return cur > prev ? '적자축소' : '적자확대';
  if (prev > 0 && cur <= 0) return '적자전환';
  return null;
}
export const fyLabel = (end) => (end ? `FY${end.slice(0, 4)}` : 'FY');

export function derive(r) {
  const t = r?.t || {}, f = r?.f || {};
  const p = t.p ?? f.price ?? null;
  const y0 = f.y0 || {}, y1 = f.y1 || {};
  let ntm = null;
  if (y0.eps != null && y1.eps != null && y0.end) {
    const frac = Math.max(0, Math.min(1, (Date.parse(y0.end) - Date.now()) / (365 * 864e5)));
    ntm = y0.eps * frac + y1.eps * (1 - frac);
  }
  const teps = f.teps;
  const perTTM = pos(teps) ? p / teps : null;
  const perNTM = pos(ntm) ? p / ntm : null;
  const perFY = pos(y0.eps) ? p / y0.eps : null;
  const perFY1 = pos(y1.eps) ? p / y1.eps : null;
  const gNTM = pos(teps) && ntm != null ? (ntm / teps - 1) * 100 : null;
  const peg = (per, g) => (per != null && g != null && g > 0 ? per / g : null);
  return {
    p, cur: t.cur || f.cur,
    perTTM, perNTM, perFY, perFY1,
    pegTTM: peg(perTTM, gNTM), pegNTM: peg(perNTM, gNTM),
    pegFY: peg(perFY, y0.epsG != null ? y0.epsG * 100 : null), pegFY1: peg(perFY1, y1.epsG != null ? y1.epsG * 100 : null),
    pbr: f.pb ?? ratio(p, pos(f.bvps)),
    revG0: y0.revG != null ? y0.revG * 100 : null, revG1: y1.revG != null ? y1.revG * 100 : null,
    epsG0: y0.epsG != null ? y0.epsG * 100 : null, epsG1: y1.epsG != null ? y1.epsG * 100 : null,
    eps0: y0.eps, eps1: y1.eps, epsPrev: y0.epsYA, ntm, teps,
    st0: epsState(y0.epsYA, y0.eps), st1: epsState(y1.epsYA ?? y0.eps, y1.eps),
    rev30_0: revision(y0.tr, 2), rev90_0: revision(y0.tr, 4), rev30_1: revision(y1.tr, 2), rev90_1: revision(y1.tr, 4),
    fy0: fyLabel(y0.end), fy1: fyLabel(y1.end),
    upside: f.tgt && p ? (f.tgt / p - 1) * 100 : null,
  };
}

export const STATUS_COLOR = { 양호: 'var(--ok)', 주의: 'var(--warn)', 경계: '#f0883e', 위험: 'var(--up)' };
export function statusBadge(st) {
  if (!st) return '<span class="muted">—</span>';
  const label = st === '위험' ? '이탈위험' : st;
  return `<span class="tag" style="color:${STATUS_COLOR[st]};border:1px solid currentColor;background:transparent">${label}</span>`;
}
export function maCell(t, k) {
  const v = t?.[k];
  if (v == null || t.p == null) return '<span class="muted">—</span>';
  const above = t.p >= v;
  return `<span class="${above ? 'up' : 'down'}" title="${k.slice(1)}일선 ${v}">${above ? '상회' : '이탈'}</span>`;
}
export function alignCell(t) {
  if (!t || t.al == null) return '<span class="muted">자료 부족</span>';
  return t.al ? `<b class="up">O</b><div class="sub">${t.alDays ?? 0}일 경과</div>` : '<b class="down">X</b><div class="sub">미충족</div>';
}
