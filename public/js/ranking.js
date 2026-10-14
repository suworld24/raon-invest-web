// 랭킹 테이블: 가로는 날짜(월말·주말), 세로는 순위 · 각 칸은 이름과 직전 12개월 상승률 · ▲▼ 직전 기록 대비 순위 변화
import { state, updateQuiet, api, esc, fmtPct, fmtNum, download, toCsv, today } from './core.js';
import { openStockModal } from './stock.js';

const COLORS = [['', '색상 없음'], ['red', '빨강', '#e0383e'], ['orange', '주황', '#f0883e'], ['yellow', '노랑', '#d4a106'], ['green', '초록', '#1f9d63'], ['blue', '파랑', '#2f6fed']];
const colorHex = (c) => COLORS.find((x) => x[0] === c)?.[2] || null;

let mkt = 'US';
let kind = 'industry';
let mode = 'month';
let group = 'mega';
let topN = 20;
let colorFilter = 'all';
let picked = null;   // 경로를 강조할 종목

export async function render(root) {
  const colors = state.ranking.colors || {};
  const groups = mkt === 'US'
    ? [['mega', '메가캡 · $200B 이상'], ['large', '라지캡 · $10B–200B'], ['mid', '미드캡 · $2B–10B']]
    : [['mega', '메가캡 · 50조원 이상'], ['large', '라지캡 · 10조–50조원'], ['mid', '미드캡 · 1조–10조원']];
  const tops = kind === 'industry' ? [[20, '상위 20위'], [50, '상위 50위'], [0, '전체 순위']] : [[20, '상위 20위'], [50, '상위 50위'], [100, '상위 100위']];
  if (!tops.some(([v]) => v === topN)) topN = 20;
  root.innerHTML = `
  <div class="toolbar">
    <div class="seg" id="rk-mkt"><button data-v="US" class="${mkt === 'US' ? 'on' : ''}">🇺🇸 미국</button><button data-v="KR" class="${mkt === 'KR' ? 'on' : ''}">🇰🇷 한국</button></div>
    <div class="seg" id="rk-kind"><button data-v="industry" class="${kind === 'industry' ? 'on' : ''}">산업</button><button data-v="company" class="${kind === 'company' ? 'on' : ''}">기업</button></div>
    <h2 style="margin:0 6px">${kind === 'industry' ? '산업 순위표' : '기업 순위표'}</h2>
    ${kind === 'company' ? `<select id="rk-group">${groups.map(([v, l]) => `<option value="${v}" ${group === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : '<span class="tag">대표 산업 ETF</span>'}
    <select id="rk-mode"><option value="week" ${mode === 'week' ? 'selected' : ''}>주간 기록</option><option value="month" ${mode === 'month' ? 'selected' : ''}>월간 기록</option></select>
    <select id="rk-top">${tops.map(([v, l]) => `<option value="${v}" ${topN === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select id="rk-color"><option value="all">모든 색상</option>${COLORS.map(([v, l]) => `<option value="${v || 'none'}" ${colorFilter === (v || 'none') ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <span style="flex:1"></span>
    <button class="btn btn-sm" id="rk-csv">CSV 저장</button>
  </div>
  <div class="card"><div id="rk-body"><div class="empty">순위를 계산하는 중입니다…</div></div>
    <div id="rk-picked"></div>
    <details class="small muted" style="margin-top:12px"><summary>자료 출처 및 순위 기준</summary>
      <p>${kind === 'industry' ? (mkt === 'US' ? 'State Street SPDR S&P 산업 ETF 18개(XAR·KBE·XBI·KCE·XHE·XHS·XHB·KIE·XME·XES·XOP·XPH·KRE·XRT·XSD·XSW·XTL·XTN)를 같은 기준으로 비교합니다. 은행·지역은행처럼 투자 범위가 겹칠 수 있습니다.' : '국내 산업·테마를 대표하는 ETF 18개(KODEX·TIGER)의 원화 가격 상승률을 비교합니다. 공식 업종 분류와 별개이며 편입 기업이 겹칠 수 있습니다.')
        : (mkt === 'US' ? '최신 시가총액으로 메가캡(2,000억 달러 이상)·라지캡(100억~2,000억 달러)·미드캡(20억~100억 달러)을 나누고, 같은 그룹으로 모든 과거 날짜의 순위를 비교합니다. 과거 당시의 시가총액 구분이나 상장폐지 기업을 복원한 자료가 아닙니다.' : '코스피·코스닥 기업을 최신 시가총액으로 메가캡(50조원 이상)·라지캡(10조~50조원)·미드캡(1조~10조원)으로 나눠 비교합니다. 시가총액 목록은 네이버 증권, 가격은 Yahoo Finance 종가입니다.')}</p>
      <p>직전 12개월 가격 상승률 = (기준일 종가 ÷ 1년 전 같은 날짜 또는 그 이전 마지막 거래일 종가 − 1) × 100. 완료된 월은 해당 월 마지막 거래일과 전년도 같은 월 마지막 거래일을 비교합니다. 분할이 반영된 종가를 쓰며 배당 재투자는 포함하지 않습니다. 12개월 전 가격이 없으면 그 날짜 순위에서 제외합니다. ▲·▼는 직전 기록 대비 순위 변화입니다.</p>
      <p>칸을 누르면 그 종목의 순위 경로가 강조되고 색상(빨강·주황·노랑·초록·파랑)을 지정할 수 있습니다. 색상 필터는 원래 순위를 유지한 채 해당 색만 보여줍니다. 칸에 마우스를 올리면 실제 비교 거래일과 종가가 보입니다.</p>
    </details></div>`;

  const seg = (id, set) => root.querySelectorAll(`${id} button`).forEach((b) => { b.onclick = () => { set(b.dataset.v); picked = null; render(root); }; });
  seg('#rk-mkt', (v) => { mkt = v; });
  seg('#rk-kind', (v) => { kind = v; });
  root.querySelector('#rk-group')?.addEventListener('change', (e) => { group = e.target.value; render(root); });
  root.querySelector('#rk-mode').onchange = (e) => { mode = e.target.value; render(root); };
  root.querySelector('#rk-top').onchange = (e) => { topN = +e.target.value; render(root); };
  root.querySelector('#rk-color').onchange = (e) => { colorFilter = e.target.value; render(root); };

  let data;
  try {
    data = await api(`/api/market/rankings?kind=${kind}&market=${mkt}&mode=${mode}&group=${group}`);
  } catch {
    root.querySelector('#rk-body').innerHTML = '<div class="empty">순위 자료를 불러오지 못했습니다.</div>';
    return;
  }
  if (!root.isConnected) return;
  // 첫 열은 직전 대비 변화를 계산하기 위한 기준이라 표시하지 않음
  const cols = data.columns.slice(1).filter((c) => c.list.length);
  if (!cols.length) {
    root.querySelector('#rk-body').innerHTML = `<div class="empty">아직 계산할 시세가 없습니다. 서버가 시세를 수집하는 중이면 몇 분 뒤 다시 열어주세요. (${data.covered}/${data.total} 확보)</div>`;
    return;
  }
  const maxRank = Math.max(...cols.map((c) => c.list.length));
  const n = topN ? Math.min(topN, maxRank) : maxRank;
  const short = (x) => (kind === 'industry' ? x.n.split(' · ')[0] : x.s.replace(/\.(KS|KQ)$/, '') + (mkt === 'KR' ? ` ${x.n}` : ''));
  const show = (x) => colorFilter === 'all' || (colorFilter === 'none' ? !colors[x.s] : colors[x.s] === colorFilter);
  const cell = (x) => {
    if (!x) return '<td></td>';
    if (!show(x)) return '<td style="opacity:.15"></td>';
    const c = colorHex(colors[x.s]);
    const ch = x.ch == null ? '<span class="sub">NEW</span>' : x.ch > 0 ? `<span class="up">▲${x.ch}</span>` : x.ch < 0 ? `<span class="down">▼${-x.ch}</span>` : '<span class="sub">–</span>';
    return `<td data-cell="${esc(x.s)}" title="${esc(x.n)} (${esc(x.s)})&#10;${esc(x.d1)} 종가 ${fmtNum(x.c1, 2)} ÷ ${esc(x.d0)} 종가 ${fmtNum(x.c0, 2)}" style="cursor:pointer;min-width:118px;${c ? `background:${c}22;box-shadow:inset 3px 0 0 ${c};` : ''}${picked === x.s ? 'outline:2px solid var(--primary);outline-offset:-2px;' : ''}">
      <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px">${esc(short(x))}</div>
      <div style="display:flex;justify-content:space-between;gap:6px;font-size:12px"><span class="${x.ret > 0 ? 'up' : 'down'}">${fmtPct(x.ret, 1)}</span>${ch}</div></td>`;
  };
  root.querySelector('#rk-body').innerHTML = `
    <div class="small muted" style="margin-bottom:6px">${kind === 'company' ? `${data.covered}/${data.total}개 종목 시세 확보 · ` : ''}가로는 날짜, 세로는 순위입니다. 각 칸은 이름과 직전 12개월 상승률입니다.</div>
    <div class="table-wrap" style="max-height:72vh"><table class="tbl rank-matrix"><thead><tr><th class="num">순위</th>${cols.map((c) => `<th class="num">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
      ${Array.from({ length: n }, (_, i) => `<tr><td class="num"><b>${i + 1}</b></td>${cols.map((c) => cell(c.list[i])).join('')}</tr>`).join('')}
    </tbody></table></div>`;
  root.querySelectorAll('[data-cell]').forEach((td) => { td.onclick = () => { picked = td.dataset.cell; render(root); }; });
  if (picked) showPicked(root, cols, colors);
  root.querySelector('#rk-csv').onclick = () => {
    const head = ['순위', ...cols.map((c) => c.label)];
    const rows = Array.from({ length: n }, (_, i) => [i + 1, ...cols.map((c) => { const x = c.list[i]; return x ? `${x.s} ${x.ret}%` : ''; })]);
    download(`랭킹-${mkt}-${kind}-${mode}-${today()}.csv`, toCsv([head, ...rows]), 'text/csv');
  };
}

function showPicked(root, cols, colors) {
  const box = root.querySelector('#rk-picked');
  if (!box || !picked) return;
  const path = cols.map((c) => ({ label: c.label, x: c.list.find((y) => y.s === picked) }));
  const any = path.find((p) => p.x)?.x;
  if (!any) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card" style="margin-top:12px;padding:12px">
    <div class="card-head" style="margin-bottom:8px"><h3 style="margin-right:auto">선택한 ${kind === 'industry' ? '산업' : '기업'} · ${esc(any.n)} <span class="sub">${esc(any.s)}</span></h3>
      ${COLORS.map(([v, l, hx]) => `<button class="chip ${(colors[picked] || '') === v ? 'on' : ''}" data-color="${v}">${hx ? `<span class="dot" style="background:${hx}"></span>` : ''}${l}</button>`).join('')}
      ${kind === 'company' ? '<button class="btn btn-sm" data-open>종목 상세</button>' : ''}
      <button class="btn btn-sm" data-close>닫기</button></div>
    <div class="toolbar">${path.map((p) => `<span class="tag" title="${esc(p.label)}">${esc(p.label)}: ${p.x ? `<b>${p.x.rank}위</b> ${fmtPct(p.x.ret, 1)}` : '—'}</span>`).join('')}</div></div>`;
  box.querySelectorAll('[data-color]').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.color;
      updateQuiet('ranking', (r) => { r.colors = { ...(r.colors || {}) }; if (v) r.colors[picked] = v; else delete r.colors[picked]; });
      render(root);
    };
  });
  box.querySelector('[data-open]')?.addEventListener('click', () => openStockModal(picked));
  box.querySelector('[data-close]').onclick = () => { picked = null; render(root); };
}
