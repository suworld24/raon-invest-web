// 섹터·랭킹 공통 계산: 동일가중 지수, 기간 수익률, RRG 좌표
import { valueAt } from './core.js';

export const PERIODS = [
  ['d1', '1일', 1], ['w1', '1주', 7], ['m1', '1개월', 30], ['m3', '3개월', 91], ['m6', '6개월', 182], ['ytd', 'YTD', 0], ['y1', '12개월', 365],
];

// 기준 날짜축(axis)에 맞춘 종가 배열
export function align(series, axis) {
  return axis.map((d) => valueAt(series, d));
}

// 구성 종목의 일간 수익률 평균으로 만든 지수 (시작 100)
export function equalWeightIndex(members, axis, hist) {
  const cols = members.map((s) => (hist[s] ? align(hist[s], axis) : null)).filter(Boolean);
  if (!cols.length) return null;
  const idx = [100];
  for (let i = 1; i < axis.length; i++) {
    let sum = 0, n = 0;
    for (const c of cols) {
      const a = c[i - 1], b = c[i];
      if (a && b) { sum += b / a - 1; n++; }
    }
    idx.push(idx[i - 1] * (1 + (n ? sum / n : 0)));
  }
  return idx;
}

// 지수/가격 배열의 기간 수익률 (끝에서 offset 거래일 이전 시점 기준)
export function periodReturns(values, axis, endOffset = 0) {
  const out = {};
  const end = values.length - 1 - endOffset;
  if (end < 1) return out;
  const last = values[end];
  const lastDate = axis[end];
  for (const [key, , days] of PERIODS) {
    let target;
    if (key === 'ytd') target = lastDate.slice(0, 4) + '-01-01';
    else if (key === 'd1') { out.d1 = values[end - 1] ? (last / values[end - 1] - 1) * 100 : null; continue; }
    else target = new Date(Date.parse(lastDate) - days * 864e5).toISOString().slice(0, 10);
    let i = -1;
    for (let k = end; k >= 0; k--) { if (axis[k] < target || (key !== 'ytd' && axis[k] <= target)) { i = k; break; } }
    // 자료 시작일이 기준일보다 며칠 늦은 정도면 첫날을 기준으로 사용
    if (i < 0 && (key === 'ytd' || Date.parse(axis[0]) - Date.parse(target) <= 7 * 864e5)) i = 0;
    out[key] = i >= 0 && values[i] ? (last / values[i] - 1) * 100 : null;
  }
  return out;
}

// RRG 좌표를 일간으로 계산해 주 단위로 표본 추출
// x: 상대강도(RS)의 50일 평균 대비 위치, y: x의 10일 변화율 — 둘 다 기준선 100
export function rrgPoints(idx, bench, { step = 5, smooth = 50, lag = 10 } = {}) {
  const n = idx.length;
  const rs = idx.map((v, i) => (bench[i] ? v / bench[i] : null));
  const ratio = new Array(n).fill(null);
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    if (rs[i] != null) { sum += rs[i]; cnt++; }
    if (i >= smooth && rs[i - smooth] != null) { sum -= rs[i - smooth]; cnt--; }
    if (i >= smooth - 1 && rs[i] != null && cnt) ratio[i] = 100 * rs[i] / (sum / cnt);
  }
  const pts = [];
  for (let i = n - 1; i >= lag; i -= step) {
    if (ratio[i] == null || ratio[i - lag] == null) continue;
    pts.unshift({ x: ratio[i], y: 100 * ratio[i] / ratio[i - lag], date: i });
  }
  return pts;
}
