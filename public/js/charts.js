// SVG 차트: 도넛, RRG(상대강도·모멘텀), 막대 선
import { esc } from './core.js';

export const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)', 'var(--c9)', 'var(--c10)'];
export const color = (i) => PALETTE[i % PALETTE.length];

export function donut(items, { top = '', value = '', sub = '' } = {}) {
  const total = items.reduce((a, b) => a + Math.max(0, b.value), 0);
  const R = 90, r = 62, cx = 110, cy = 110;
  let paths = '';
  if (total > 0) {
    let a0 = -Math.PI / 2;
    items.forEach((it) => {
      const frac = Math.max(0, it.value) / total;
      if (frac <= 0) return;
      if (frac >= 0.9999) {
        paths += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${it.color}" stroke-width="${R - r}"><title>${esc(it.label)}</title></circle>`;
        return;
      }
      const a1 = a0 + frac * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, ang) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
      paths += `<path d="M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z" fill="${it.color}" stroke="var(--panel)" stroke-width="1.5"><title>${esc(it.label)} ${(frac * 100).toFixed(1)}%</title></path>`;
      a0 = a1;
    });
  } else {
    paths = `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="var(--panel-2)" stroke-width="${R - r}"/>`;
  }
  return `<svg viewBox="0 0 220 220" role="img" aria-label="자산 구성">${paths}
    <text x="${cx}" y="${cy - 18}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(top)}</text>
    <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="17" font-weight="700" fill="var(--text)">${esc(value)}</text>
    <text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(sub)}</text>
  </svg>`;
}

// series: [{name, color, points:[{x,y}] (오래된→최근)}]
export function rrg(series, { tail = 6 } = {}) {
  const W = 640, H = 460, pad = 44;
  const pts = series.flatMap((s) => s.points.slice(-tail));
  if (!pts.length) return '<div class="empty">표시할 자료가 없습니다.</div>';
  const spanX = Math.max(1, ...pts.map((p) => Math.abs(p.x - 100))) * 1.15;
  const spanY = Math.max(0.5, ...pts.map((p) => Math.abs(p.y - 100))) * 1.15;
  const sx = (x) => pad + ((x - (100 - spanX)) / (2 * spanX)) * (W - 2 * pad);
  const sy = (y) => H - pad - ((y - (100 - spanY)) / (2 * spanY)) * (H - 2 * pad);
  const cx = sx(100), cy = sy(100);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="섹터 상대강도 모멘텀 차트">
    <rect x="${cx}" y="${pad}" width="${W - pad - cx}" height="${cy - pad}" fill="var(--c3)" opacity=".07"/>
    <rect x="${pad}" y="${pad}" width="${cx - pad}" height="${cy - pad}" fill="var(--c1)" opacity=".07"/>
    <rect x="${pad}" y="${cy}" width="${cx - pad}" height="${H - pad - cy}" fill="var(--c5)" opacity=".07"/>
    <rect x="${cx}" y="${cy}" width="${W - pad - cx}" height="${H - pad - cy}" fill="var(--c7)" opacity=".08"/>
    <line x1="${cx}" y1="${pad}" x2="${cx}" y2="${H - pad}" stroke="var(--border)"/>
    <line x1="${pad}" y1="${cy}" x2="${W - pad}" y2="${cy}" stroke="var(--border)"/>
    <text x="${W - pad - 4}" y="${pad + 14}" text-anchor="end">주도 (Leading)</text>
    <text x="${pad + 4}" y="${pad + 14}">개선 (Improving)</text>
    <text x="${pad + 4}" y="${H - pad - 6}">부진 (Lagging)</text>
    <text x="${W - pad - 4}" y="${H - pad - 6}" text-anchor="end">약화 (Weakening)</text>
    <text x="${W / 2}" y="${H - 10}" text-anchor="middle">상대강도 추세 →</text>
    <text x="14" y="${H / 2}" text-anchor="middle" transform="rotate(-90 14 ${H / 2})">상대강도 모멘텀 →</text>`;
  for (const s of series) {
    const p = s.points.slice(-tail);
    if (!p.length) continue;
    const d = p.map((q, i) => `${i ? 'L' : 'M'}${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`).join(' ');
    out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.6" opacity=".55"/>`;
    p.forEach((q, i) => {
      if (i < p.length - 1) out += `<circle cx="${sx(q.x)}" cy="${sy(q.y)}" r="2.2" fill="${s.color}" opacity=".5"/>`;
    });
    const last = p[p.length - 1];
    out += `<circle cx="${sx(last.x)}" cy="${sy(last.y)}" r="5.5" fill="${s.color}" stroke="var(--panel)" stroke-width="1.5"><title>${esc(s.name)} · 추세 ${last.x.toFixed(1)} · 모멘텀 ${last.y.toFixed(1)}</title></circle>
      <text x="${sx(last.x) + 8}" y="${sy(last.y) + 4}" style="fill:var(--text);font-weight:600">${esc(s.name)}</text>`;
  }
  return out + '</svg>';
}

export function quadrant(x, y) {
  if (x >= 100 && y >= 100) return '주도';
  if (x < 100 && y >= 100) return '개선';
  if (x < 100 && y < 100) return '부진';
  return '약화';
}

// 선 그래프 (여러 시리즈, 날짜축 공유) + 마우스 위치 값 표시
// series: [{ name, color, t: [날짜], v: [값] }], normalize: 시작=0% 수익률로 변환
export function renderLine(el, series, { h = 260, normalize = false, fmt = (v) => v.toFixed(2) } = {}) {
  const data = series.filter((s) => s.v.length > 1).map((s) => {
    if (!normalize) return s;
    const base = s.v.find((x) => x != null);
    return { ...s, v: s.v.map((x) => (x == null || !base ? null : (x / base - 1) * 100)) };
  });
  if (!data.length) { el.innerHTML = '<div class="empty">차트 자료가 없습니다.</div>'; return; }
  const axis = data[0].t;
  const W = 720, H = h, L = 52, R = 12, T = 12, B = 26;
  const all = data.flatMap((s) => s.v.filter((x) => x != null));
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.06; min -= pad; max += pad;
  const n = axis.length;
  const x = (i) => L + (i / Math.max(1, n - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const yfmt = normalize ? (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%` : fmt;
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = min + ((max - min) * k) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(yfmt(v))}</text>`;
  }
  if (normalize && min < 0 && max > 0) g += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" stroke-dasharray="3 3"/>`;
  [0, Math.floor(n / 2), n - 1].forEach((i, k) => {
    g += `<text x="${x(i)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][k]}">${esc(axis[i] || '')}</text>`;
  });
  const lines = data.map((s) => {
    let d = '', pen = false;
    s.v.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.8"/>`;
  }).join('');
  el.innerHTML = `<div style="position:relative">
    <svg viewBox="0 0 ${W} ${H}" class="line-chart" style="width:100%;height:auto;display:block;font-size:11px;fill:var(--muted)">${g}${lines}
      <line data-cursor x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--muted)" visibility="hidden"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" data-hit/></svg>
    <div data-tip class="chart-tip" hidden></div></div>
    ${data.length > 1 ? `<div class="legend" style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px">${data.map((s) => `<div><span class="dot" style="background:${s.color}"></span>${esc(s.name)} <span class="${s.v[s.v.length - 1] > 0 ? 'up' : 'down'}">${normalize ? esc(yfmt(s.v[s.v.length - 1] ?? 0)) : ''}</span></div>`).join('')}</div>` : ''}`;
  const svg = el.querySelector('svg'), cur = el.querySelector('[data-cursor]'), tip = el.querySelector('[data-tip]');
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    cur.setAttribute('x1', x(i)); cur.setAttribute('x2', x(i)); cur.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(axis[i])}</b>` + data.map((s) => `<div><span class="dot" style="background:${s.color}"></span> ${data.length > 1 ? esc(s.name) + ' ' : ''}${s.v[i] == null ? '—' : esc(yfmt(s.v[i]))}</div>`).join('');
    const left = (x(i) / W) * r.width;
    tip.style.left = `${left > r.width / 2 ? left - tip.offsetWidth - 10 : left + 10}px`;
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', () => { cur.setAttribute('visibility', 'hidden'); tip.hidden = true; });
}

// 간단한 선 그래프 (값 배열)
export function sparkline(values, { w = 120, h = 32 } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${(i / (v.length - 1)) * w},${h - ((x - min) / (max - min || 1)) * h}`).join(' ');
  const c = v[v.length - 1] >= v[0] ? 'var(--up)' : 'var(--down)';
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${d}" fill="none" stroke="${c}" stroke-width="1.5"/></svg>`;
}
