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

// 간단한 선 그래프 (값 배열)
export function sparkline(values, { w = 120, h = 32 } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${(i / (v.length - 1)) * w},${h - ((x - min) / (max - min || 1)) * h}`).join(' ');
  const c = v[v.length - 1] >= v[0] ? 'var(--up)' : 'var(--down)';
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="${d}" fill="none" stroke="${c}" stroke-width="1.5"/></svg>`;
}
