// 산업분석: 산업(기업 묶음)별 비교표 · 수익률 비교 차트 · 투자 메모
import { state, update, updateQuiet, market, esc, uid, fmtPct, fmtNum, fmtCap, cls, download, toCsv, today, openModal, confirmModal, toast } from './core.js';
import { renderLine, color } from './charts.js';
import { periodReturns } from './analytics.js';
import { openStockModal } from './stock.js';
import { renderValueChain, mapTickers, parseMap, EXAMPLE } from './valuechain.js';

let current = null;
let sortKey = 'mc', sortDir = -1;
let chartRange = '6mo';

const I = () => state.industries;
const median = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const mean = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const times = (v) => (v == null ? '—' : v.toFixed(1));
const pc = (v) => (v == null ? '—' : fmtPct(v * 100, 1));
const pcn = (v) => (v == null ? '—' : fmtPct(v * 100, 1, false));

const COLS = [
  ['s', '기업'], ['mc', '시총 ($)'], ['m1', '1개월'], ['m3', '3개월'], ['ytd', 'YTD'], ['pe', 'PER'], ['fpe', '선행 PER'], ['ps', 'PSR'],
  ['revG', '매출성장'], ['om', '영업이익률'], ['roe', 'ROE'], ['upside', '목표가 괴리'], ['nextEarn', '다음 실적'],
];

let sub = 'map'; // map: 밸류체인 지도 · compare: 기업 비교·메모
const allTickers = (ind) => [...new Set([...(ind.tickers || []), ...mapTickers(ind.maps)])];

export async function render(root) {
  const list = I().list;
  if (!current || !list.some((x) => x.id === current)) current = list[0]?.id || null;
  root.innerHTML = `
  <div class="toolbar">
    ${list.length ? `<div class="seg" style="flex-wrap:wrap">${list.map((x) => `<button data-id="${x.id}" draggable="true" class="${x.id === current ? 'on' : ''}" title="끌어서 순서 변경">⠿ ${esc(x.name)}</button>`).join('')}</div>` : ''}
    <span style="flex:1"></span>
    <button class="btn" data-act="import">섹터에서 가져오기</button>
    <button class="btn btn-primary" data-act="add">+ 산업 추가</button>
  </div>
  ${list.length ? '' : '<div class="card"><div class="empty">아직 만든 산업이 없습니다.<br>“+ 산업 추가”로 만들면 밸류체인 지도와 기업 비교표를 함께 정리할 수 있습니다.</div></div>'}
  ${current ? `<div class="toolbar"><div class="seg"><button data-sub="map" class="${sub === 'map' ? 'on' : ''}">밸류체인 지도</button><button data-sub="compare" class="${sub === 'compare' ? 'on' : ''}">기업 비교 · 메모</button></div>
    <button class="btn btn-sm" data-act="edit">산업 이름·기업 편집</button></div>` : ''}
  <div data-body></div>`;
  root.querySelector('[data-act=add]').onclick = () => industryModal(null, root);
  root.querySelector('[data-act=import]').onclick = () => importModal(root);
  root.querySelector('[data-act=edit]')?.addEventListener('click', () => industryModal(list.find((x) => x.id === current), root));
  root.querySelectorAll('[data-sub]').forEach((b) => { b.onclick = () => { sub = b.dataset.sub; render(root); }; });
  let drag = null;
  root.querySelectorAll('[data-id]').forEach((c) => {
    c.onclick = () => { current = c.dataset.id; render(root); };
    c.addEventListener('dragstart', () => { drag = c.dataset.id; });
    c.addEventListener('dragover', (e) => { if (drag) e.preventDefault(); });
    c.addEventListener('drop', (e) => {
      e.preventDefault();
      const to = c.dataset.id;
      if (!drag || drag === to) return;
      update('industries', (s) => { const i = s.list.findIndex((x) => x.id === drag); const [x] = s.list.splice(i, 1); s.list.splice(s.list.findIndex((y) => y.id === to), 0, x); }, '산업 순서 변경');
      drag = null; render(root);
    });
  });
  if (!current) return;
  const ind = list.find((x) => x.id === current);
  const body = root.querySelector('[data-body]');
  if (sub === 'map') {
    body.className = 'card';
    renderValueChain(body, JSON.parse(JSON.stringify(ind.maps || [])), {
      onSave(maps, quiet) {
        (quiet ? updateQuiet : update)('industries', (s) => { const x = s.list.find((y) => y.id === ind.id); if (x) x.maps = maps; }, '밸류체인 지도 수정');
        if (!quiet) render(root);
      },
    });
  } else {
    drawIndustry(body, { ...ind, tickers: allTickers(ind) }, root);
  }
}

async function drawIndustry(el, ind, root) {
  el.innerHTML = `<div class="card"><div class="empty">${esc(ind.name)} 기업 자료를 불러오는 중… <span data-prog></span></div></div>`;
  const syms = ind.tickers;
  const [fund, hist] = await Promise.all([
    market.fundamentals(syms, (d, n) => { const p = el.querySelector('[data-prog]'); if (p) p.textContent = `${d}/${n}`; }),
    market.history(syms, '1y'),
    market.screener().catch(() => null),
  ]);
  if (!el.isConnected) return;
  const rows = syms.map((s) => {
    const f = fund[s] || {}, h = hist[s];
    const r = h?.c.length ? periodReturns(h.c, h.t) : {};
    const price = f.price ?? h?.c[h.c.length - 1];
    return {
      s, n: f.name || market.lookup(s)?.n || '', cur: f.cur, mc: f.mc, m1: r.m1, m3: r.m3, ytd: r.ytd,
      pe: f.pe, fpe: f.fpe, ps: f.ps, revG: f.revG, om: f.om, roe: f.roe,
      upside: f.tgt && price ? (f.tgt / price - 1) * 100 : null, nextEarn: f.nextEarn || '', ok: !!(fund[s] || h),
    };
  });
  const sorted = rows.slice().sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey];
    if (va == null || va === '') return 1;
    if (vb == null || vb === '') return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * sortDir;
  });
  const usdRows = rows.filter((r) => r.cur !== 'KRW');
  el.innerHTML = `
  <div class="card">
    <div class="card-head"><h2>${esc(ind.name)}</h2>
      <button class="btn btn-sm" data-act="csv">CSV 저장</button>
      <button class="btn btn-sm" data-act="edit">산업 편집</button>
    </div>
    <div class="stats" style="margin-bottom:14px">
      <div class="stat"><div class="k">기업 수</div><div class="v">${rows.length}</div></div>
      <div class="stat"><div class="k">시가총액 합계 (USD 기업)</div><div class="v">$${fmtCap(usdRows.reduce((a, r) => a + (r.mc || 0), 0))}</div></div>
      <div class="stat"><div class="k">PER 중앙값</div><div class="v">${times(median(rows.map((r) => r.pe)))}</div><div class="s muted">선행 ${times(median(rows.map((r) => r.fpe)))}</div></div>
      <div class="stat"><div class="k">평균 매출성장</div><div class="v ${cls(mean(rows.map((r) => r.revG)))}">${pc(mean(rows.map((r) => r.revG)))}</div></div>
      <div class="stat"><div class="k">평균 3개월 수익률</div><div class="v ${cls(mean(rows.map((r) => r.m3)))}">${fmtPct(mean(rows.map((r) => r.m3)), 1)}</div></div>
    </div>
    <div class="table-wrap"><table class="tbl"><thead><tr>${COLS.map(([k, l]) => `<th class="sortable ${k === 's' ? '' : 'num'}" data-k="${k}">${l} ${sortKey === k ? (sortDir < 0 ? '▼' : '▲') : ''}</th>`).join('')}</tr></thead><tbody>
      ${sorted.map((r) => `<tr data-open="${esc(r.s)}" style="cursor:pointer">
        <td><span class="sym">${esc(r.s)}</span><div class="sub">${esc(r.n)}${r.ok ? '' : ' · 자료 없음'}</div></td>
        <td class="num">${r.cur === 'KRW' ? (r.mc ? (r.mc / 1e12).toFixed(1) + '조원' : '—') : fmtCap(r.mc)}</td>
        ${['m1', 'm3', 'ytd'].map((k) => `<td class="num ${cls(r[k])}">${fmtPct(r[k], 1)}</td>`).join('')}
        <td class="num">${times(r.pe)}</td><td class="num">${times(r.fpe)}</td><td class="num">${times(r.ps)}</td>
        <td class="num ${cls(r.revG)}">${pc(r.revG)}</td><td class="num">${pcn(r.om)}</td><td class="num">${pcn(r.roe)}</td>
        <td class="num ${cls(r.upside)}">${fmtPct(r.upside, 1)}</td><td class="num">${esc(r.nextEarn || '—')}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">행을 누르면 종목 상세를 볼 수 있습니다. 자료: Yahoo Finance.</p>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h2>수익률 비교</h2><div class="seg" data-ranges>${[['3mo', '3개월'], ['6mo', '6개월'], ['1y', '1년']].map(([v, l]) => `<button data-r="${v}" class="${chartRange === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div data-chart></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>투자 메모</h2><span class="small muted" data-saved></span></div>
      <textarea data-memo rows="14" style="width:100%" placeholder="산업 성장 동력, 밸류체인, 핵심 지표, 리스크 등을 정리해 두세요">${esc(ind.memo || '')}</textarea>
    </div>
  </div>`;

  el.querySelectorAll('th.sortable').forEach((th) => {
    th.onclick = () => { const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : (k === 's' || k === 'nextEarn' ? 1 : -1); sortKey = k; drawIndustry(el, ind, root); };
  });
  el.querySelectorAll('[data-open]').forEach((tr) => { tr.onclick = () => openStockModal(tr.dataset.open); });
  el.querySelector('[data-act=edit]').onclick = () => industryModal(I().list.find((x) => x.id === ind.id), root);
  el.querySelector('[data-act=csv]').onclick = () => download(`산업분석-${ind.name}-${today()}.csv`, toCsv([COLS.map((c) => c[1]),
    ...sorted.map((r) => [r.s, r.mc, r.m1?.toFixed(2), r.m3?.toFixed(2), r.ytd?.toFixed(2), r.pe?.toFixed(2), r.fpe?.toFixed(2), r.ps?.toFixed(2), r.revG, r.om, r.roe, r.upside?.toFixed(2), r.nextEarn])]), 'text/csv');

  const drawChart = async () => {
    const box = el.querySelector('[data-chart]');
    const h = await market.history(syms, chartRange === '1y' ? '1y' : chartRange);
    if (!box.isConnected) return;
    const base = syms.find((s) => h[s]?.t.length);
    if (!base) { box.innerHTML = '<div class="empty">차트 자료가 없습니다.</div>'; return; }
    const axis = h[base].t;
    const series = syms.filter((s) => h[s]).slice(0, 10).map((s, i) => {
      const m = new Map(h[s].t.map((d, k) => [d, h[s].c[k]]));
      let last = null;
      return { name: s, color: color(i), t: axis, v: axis.map((d) => (m.has(d) ? (last = m.get(d)) : last)) };
    });
    renderLine(box, series, { normalize: true, h: 280 });
  };
  el.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => { chartRange = b.dataset.r; el.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); drawChart(); }; });
  drawChart();

  const memo = el.querySelector('[data-memo]');
  let t;
  memo.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      updateQuiet('industries', (s) => { const x = s.list.find((y) => y.id === ind.id); if (x) x.memo = memo.value; });
      const sv = el.querySelector('[data-saved]'); if (sv) sv.textContent = '메모 저장됨';
    }, 700);
  };
}

function industryModal(ind, root) {
  const isEdit = !!ind;
  openModal({
    title: isEdit ? '산업 편집' : '산업 추가',
    body: `<label class="field">산업 이름<input name="name" value="${esc(ind?.name || '')}" required placeholder="예: AI 반도체, 비만 치료제"></label>
      <label class="field">비교표에 넣을 기업 (선택 · 티커, 쉼표·공백 구분 · 최대 30개)<textarea name="tickers" rows="3" placeholder="예: NVDA, AMD, AVGO, 000660.KS">${esc(ind?.tickers.join(', ') || '')}</textarea></label>
      <p class="small muted">밸류체인 지도에 넣은 티커는 비교표에 자동으로 포함됩니다.</p>
      ${isEdit ? '' : '<label class="toolbar small"><input type="checkbox" name="example"> AI 데이터센터 예시 지도로 시작</label>'}`,
    extraButtons: isEdit ? '<button type="button" class="btn btn-danger" data-del>산업 삭제</button>' : '',
    onOpen(form, close) {
      form.querySelector('[data-del]')?.addEventListener('click', async () => {
        close();
        if (!(await confirmModal(`'${ind.name}' 산업과 메모를 삭제할까요?`))) return;
        update('industries', (s) => { s.list = s.list.filter((x) => x.id !== ind.id); }, '산업 삭제');
        render(root);
      });
    },
    onSubmit(d, form) {
      const name = d.name.trim();
      const tickers = [...new Set(d.tickers.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
      if (!name) throw new Error('이름을 입력하세요.');
      if (tickers.length > 30) throw new Error('산업당 30개 기업까지 가능합니다.');
      const id = ind?.id || uid();
      const maps = !isEdit && form.example?.checked ? [parseMap(EXAMPLE)] : [];
      update('industries', (s) => {
        if (isEdit) s.list = s.list.map((x) => (x.id === id ? { ...x, name, tickers } : x));
        else s.list.push({ id, name, tickers, memo: '', maps });
      }, isEdit ? '산업 편집' : '산업 추가');
      sub = 'map';
      current = id;
      render(root);
    },
  });
}

function importModal(root) {
  const sectors = state.sectors.list;
  if (!sectors.length) return toast('섹터 퍼포먼스에 섹터가 없습니다.');
  openModal({
    title: '섹터에서 가져오기',
    body: `<p class="small muted">섹터 퍼포먼스의 종목 묶음을 산업분석으로 복사합니다.</p>
      <div style="display:grid;gap:6px;max-height:50vh;overflow:auto">${sectors.map((s) => `<label class="toolbar"><input type="checkbox" name="s" value="${s.id}"> <b>${esc(s.name)}</b> <span class="small muted">${esc(s.tickers.join(', '))}</span></label>`).join('')}</div>`,
    submitText: '가져오기',
    onSubmit(d, form) {
      const ids = [...form.querySelectorAll('input[name=s]:checked')].map((x) => x.value);
      if (!ids.length) throw new Error('하나 이상 고르세요.');
      let first = null;
      update('industries', (st) => {
        for (const id of ids) {
          const s = sectors.find((x) => x.id === id);
          const nid = uid();
          first ||= nid;
          st.list.push({ id: nid, name: s.name, tickers: s.tickers.slice(0, 30), memo: '' });
        }
      }, '섹터에서 산업 가져오기');
      current = first;
      render(root);
    },
  });
}
