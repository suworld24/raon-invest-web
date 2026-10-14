// 섹터 퍼포먼스: 대분류별 섹터(종목 바스켓) · 나만의 ETF · 동일가중 수익률 · RRG(현재 확대/전체 경로) · 상대강도 표
import { state, update, updateQuiet, market, esc, uid, fmtPct, cls, download, toCsv, today, openModal, confirmModal, toast } from './core.js';
import { rrg, color, quadrant } from './charts.js';
import { PERIODS, align, equalWeightIndex, periodReturns, rrgPoints } from './analytics.js';

export const CATS = [['tech', '기술주'], ['ind', '산업재'], ['energy', '에너지'], ['mat', '소재'], ['bio', '바이오'], ['agri', '농업'], ['fin', '금융'], ['cons', '소비재'], ['custom', '내가 만든 ETF']];
const GUESS = { 반도체: 'tech', 메모리: 'tech', 소프트웨어: 'tech', 클라우드: 'tech', 사이버: 'tech', 양자: 'tech', 네트워크: 'tech', 광학: 'tech', 전력: 'ind', 우주: 'ind', 방산: 'ind', 전기차: 'ind', 건설: 'ind', 원자력: 'energy', 에너지: 'energy', 정유: 'energy', 시추: 'energy', LNG: 'energy', 희토류: 'mat', 소재: 'mat', 광물: 'mat', 바이오: 'bio', 헬스: 'bio', 농업: 'agri', 금융: 'fin', 크립토: 'fin', 소비: 'cons' };
const catOf = (s) => s.cat || Object.entries(GUESS).find(([k]) => s.name.includes(k))?.[1] || 'custom';
const catName = (k) => CATS.find((c) => c[0] === k)?.[1] || '';

let sortKey = 'm3', sortDir = -1;
let bench = 'avg';
let offset = 0;          // 타임라인: 몇 주 전
let viewMode = 'path';   // now: 현재 확대 · path: 전체 경로
let tableTab = 'ret';    // ret: 수익률 · rs: 상대강도·모멘텀
let cat = '';            // 대분류 필터
let open = null;         // 펼친 섹터
let focus = '';          // 섹터 하나만 보기

const S = () => state.sectors;
const hidden = () => new Set(S().hidden || []);
const fillGaps = (v) => { const out = v.slice(); for (let i = 1; i < out.length; i++) if (out[i] == null) out[i] = out[i - 1]; return out; };

export async function render(root) {
  const all = S().list;
  const list = all.filter((s) => !cat || catOf(s) === cat);
  const allSyms = [...new Set(list.flatMap((s) => s.tickers))];
  root.innerHTML = `
  <div class="toolbar">
    <select id="sec-cat"><option value="">전체 섹터 (${all.length})</option>${CATS.map(([k, l]) => `<option value="${k}" ${cat === k ? 'selected' : ''}>${l} (${all.filter((s) => catOf(s) === k).length})</option>`).join('')}</select>
    <select id="sec-focus"><option value="">섹터 하나만 보기</option>${list.map((s) => `<option value="${s.id}" ${focus === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <span style="flex:1"></span>
    <button class="btn" id="sec-backup">리스트 백업</button>
    <button class="btn" id="sec-import">리스트 불러오기</button>
    <input type="file" id="sec-file" accept="application/json" hidden>
    <button class="btn" id="sec-csv">CSV 다운로드</button>
    <button class="btn btn-primary" id="sec-add">섹터 추가 · 나만의 ETF</button>
  </div>
  <div class="card rrg">
    <div class="card-head"><h2>섹터 강도 · 모멘텀</h2>
      <div class="seg" id="rrg-mode"><button data-m="now" class="${viewMode === 'now' ? 'on' : ''}">현재 확대</button><button data-m="path" class="${viewMode === 'path' ? 'on' : ''}">전체 경로</button></div>
      <select id="rrg-bench"><option value="avg" ${bench === 'avg' ? 'selected' : ''}>비교 기준: 표시 ETF 평균</option><option value="SPY" ${bench === 'SPY' ? 'selected' : ''}>비교 기준: S&P 500 (SPY)</option><option value="QQQ" ${bench === 'QQQ' ? 'selected' : ''}>비교 기준: 나스닥100 (QQQ)</option></select>
    </div>
    <div class="toolbar"><span class="small muted">상대강도 타임라인</span><input type="range" id="rrg-off" min="0" max="20" value="${20 - offset}" style="flex:1;height:auto"><span class="small" id="rrg-when">현재</span>
      <button class="btn btn-sm" id="rrg-prev">← 이전</button><button class="btn btn-sm" id="rrg-next">이후 →</button><button class="btn btn-sm" id="rrg-now">현재로</button></div>
    <div id="rrg-box"><div class="empty" id="rrg-progress">과거 시세 불러오는 중 · 0/${allSyms.length}</div></div>
    <p class="small muted">가로: 상대강도 추세 · 세로: 상대강도 모멘텀 · 기준선 100.</p>
    <details class="small muted"><summary>적용한 RRG 방식 · 계산 기준 보기</summary>
      <p>각 섹터는 구성 종목의 일간 수익률을 같은 비중으로 평균한 지수입니다. 비교 기준(표시 ETF 평균·SPY·QQQ) 대비 상대강도(RS)를 구하고, 가로축은 RS를 50일 이동평균으로 나눈 값(×100), 세로축은 그 값의 10거래일 변화율(×100)입니다. 점은 주 단위로 찍고, '전체 경로'는 최근 8주의 이동 경로를 보여줍니다. JdK RS-Ratio의 공개되지 않은 정규화 방식을 그대로 복제한 값은 아닙니다.</p>
      <p>오른쪽 위는 주도, 오른쪽 아래는 약화, 왼쪽 아래는 부진, 왼쪽 위는 개선 영역입니다. 일반적으로 시계 방향으로 순환합니다.</p></details>
  </div>
  <div class="card">
    <div class="card-head"><h2>섹터 리스트 <span class="small muted">(${list.length}개 섹터 · ${allSyms.length}개 종목 · 동일가중 · 가격 수익률)</span></h2>
      <div class="seg" id="sec-tab"><button data-t="ret" class="${tableTab === 'ret' ? 'on' : ''}">수익률</button><button data-t="rs" class="${tableTab === 'rs' ? 'on' : ''}">상대강도·모멘텀</button></div></div>
    <div id="sec-table"><div class="empty">계산 중…</div></div>
    <details class="small muted"><summary>편입 기준·계산 방식</summary>
      <p>기본 바스켓은 각 테마의 대표 미국 상장 기업을 동일가중으로 묶은 것이며 특정 ETF의 구성·비중을 복제하지 않습니다. 여러 바스켓에 같은 기업이 들어갈 수 있고, 중복 편입 기업은 전체 주가 수익률을 양쪽에 반영합니다. '편집'으로 이름·대분류·종목을 바꾸거나, '섹터 추가 · 나만의 ETF'로 직접 바스켓을 만들 수 있습니다.</p></details>
  </div>`;

  root.querySelector('#sec-cat').onchange = (e) => { cat = e.target.value; focus = ''; render(root); };
  root.querySelector('#sec-focus').onchange = (e) => { focus = e.target.value; open = focus || null; render(root); };
  root.querySelector('#sec-add').onclick = () => sectorModal(null, root);
  root.querySelector('#sec-backup').onclick = () => download(`섹터리스트-${today()}.json`, JSON.stringify(S().list, null, 2), 'application/json');
  root.querySelector('#sec-import').onclick = () => root.querySelector('#sec-file').click();
  root.querySelector('#sec-file').onchange = async (e) => {
    try {
      const arr = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(arr) || !arr.every((x) => x.name && Array.isArray(x.tickers))) throw new Error();
      update('sectors', (s) => { s.list = arr.map((x) => ({ id: x.id || uid(), name: String(x.name), cat: x.cat, tickers: x.tickers.map((t) => String(t).toUpperCase()) })); }, '섹터 리스트 불러오기');
      render(root);
    } catch { toast('섹터 리스트 파일 형식이 아닙니다.'); }
  };
  root.querySelectorAll('#rrg-mode button').forEach((b) => { b.onclick = () => { viewMode = b.dataset.m; root.querySelectorAll('#rrg-mode button').forEach((x) => x.classList.toggle('on', x === b)); draw(root, data); }; });
  root.querySelectorAll('#sec-tab button').forEach((b) => { b.onclick = () => { tableTab = b.dataset.t; if (tableTab === 'rs' && !['x', 'y'].includes(sortKey)) sortKey = 'x'; if (tableTab === 'ret' && ['x', 'y'].includes(sortKey)) sortKey = 'm3'; root.querySelectorAll('#sec-tab button').forEach((x) => x.classList.toggle('on', x === b)); drawTable(root, data); }; });
  root.querySelector('#rrg-bench').onchange = (e) => { bench = e.target.value; draw(root, data); };
  const setOff = (v) => { offset = Math.max(0, Math.min(20, v)); root.querySelector('#rrg-off').value = 20 - offset; draw(root, data); };
  root.querySelector('#rrg-off').oninput = (e) => setOff(20 - +e.target.value);
  root.querySelector('#rrg-prev').onclick = () => setOff(offset + 1);
  root.querySelector('#rrg-next').onclick = () => setOff(offset - 1);
  root.querySelector('#rrg-now').onclick = () => setOff(0);

  let data = null;
  const hist = await market.history([...allSyms, 'SPY', 'QQQ'], '1y', (d, n) => {
    const el = root.querySelector('#rrg-progress');
    if (el) el.textContent = `과거 시세 불러오는 중 · ${d}/${n}`;
  });
  if (!root.isConnected) return;
  const axis = hist.SPY?.t;
  if (!axis?.length) {
    root.querySelector('#rrg-box').innerHTML = '<div class="empty">시세를 불러오지 못했습니다. 새로고침해 주세요.</div>';
    return;
  }
  const sectors = list.map((s, i) => {
    const idx = equalWeightIndex(s.tickers, axis, hist);
    const members = s.tickers.map((t) => {
      const v = hist[t] ? align(hist[t], axis) : null;
      return { s: t, n: market.lookup(t)?.n || '', ret: v ? periodReturns(fillGaps(v), axis) : {}, ok: !!v };
    });
    return { ...s, color: color(i), idx, ret: idx ? periodReturns(idx, axis) : {}, members };
  });
  data = { axis, hist, sectors };
  draw(root, data);
  drawTable(root, data);
  root.querySelector('#sec-csv').onclick = () => {
    const rows = [['섹터', '대분류', '종목수', ...PERIODS.map((p) => p[1] + '(%)'), '상대강도 추세', '상대강도 모멘텀', '영역', '구성 종목'],
      ...sectors.map((s) => { const r = data.rs?.[s.id]?.p; return [s.name, catName(catOf(s)), s.tickers.length, ...PERIODS.map((p) => s.ret[p[0]]?.toFixed(2) ?? ''), r?.x.toFixed(2) ?? '', r?.y.toFixed(2) ?? '', data.quad?.[s.id] || '', s.tickers.join(' ')]; })];
    download(`섹터수익률-${today()}.csv`, toCsv(rows), 'text/csv');
  };
}

function draw(root, data) {
  if (!data) return;
  const { axis, hist, sectors } = data;
  const hid = hidden();
  const active = sectors.filter((s) => s.idx && !hid.has(s.id));
  let benchIdx;
  if (bench === 'avg') {
    benchIdx = axis.map((_, i) => active.reduce((a, s) => a + s.idx[i], 0) / (active.length || 1));
  } else {
    benchIdx = fillGaps(align(hist[bench], axis));
  }
  const shown = focus ? sectors.filter((s) => s.idx && s.id === focus) : active;
  const series = shown.map((s) => {
    const pts = rrgPoints(s.idx, benchIdx);
    return { name: s.name, color: s.color, points: pts.slice(0, pts.length - offset) };
  });
  const lastPt = series[0]?.points[series[0].points.length - 1];
  root.querySelector('#rrg-when').textContent = offset === 0 ? '현재' : `${offset}주 전${lastPt ? ' · ' + axis[lastPt.date] : ''}`;
  root.querySelector('#rrg-box').innerHTML = rrg(series, { tail: viewMode === 'now' ? 1 : 8 });
  data.quad = {};
  data.rs = {};
  for (const s of sectors) {
    const pts = s.idx ? rrgPoints(s.idx, benchIdx) : [];
    const p = pts[pts.length - 1 - offset], p4 = pts[pts.length - 5 - offset];
    data.quad[s.id] = p ? quadrant(p.x, p.y) : '—';
    data.rs[s.id] = { p, p4, q4: p4 ? quadrant(p4.x, p4.y) : '—' };
  }
  if (root.querySelector('#sec-table table')) drawTable(root, data);
}

const QCOLOR = { 주도: 'var(--c3)', 개선: 'var(--c1)', 부진: 'var(--c5)', 약화: 'var(--c7)' };
const qTag = (q) => (q && q !== '—' ? `<span class="tag" style="color:${QCOLOR[q] || 'inherit'}">${q}</span>` : '<span class="muted">—</span>');

function drawTable(root, data) {
  if (!data) return;
  const hid = hidden();
  const pc = (v) => `<td class="num ${cls(v)}">${fmtPct(v, 1)}</td>`;
  const val = (s, k) => {
    if (k === 'x' || k === 'y') return data.rs?.[s.id]?.p?.[k];
    return s.ret[k];
  };
  const list = data.sectors.slice().sort((a, b) => ((val(a, sortKey) ?? -1e9) - (val(b, sortKey) ?? -1e9)) * sortDir);
  const arrow = (k) => (sortKey === k ? (sortDir < 0 ? '▼' : '▲') : '');
  const head = tableTab === 'rs'
    ? `<th class="num sortable" data-k="x">상대강도 추세 ${arrow('x')}</th><th class="num sortable" data-k="y">상대강도 모멘텀 ${arrow('y')}</th><th>현재 영역</th><th>4주 전 영역</th>`
    : `${PERIODS.map(([k, l]) => `<th class="num sortable" data-k="${k}">${l} ${arrow(k)}</th>`).join('')}<th>현재 영역</th>`;
  const body = (s) => {
    if (tableTab === 'rs') {
      const r = data.rs?.[s.id] || {};
      return `<td class="num ${r.p ? cls(r.p.x - 100) : ''}">${r.p ? r.p.x.toFixed(2) : '—'}</td><td class="num ${r.p ? cls(r.p.y - 100) : ''}">${r.p ? r.p.y.toFixed(2) : '—'}</td><td>${qTag(data.quad?.[s.id])}</td><td>${qTag(r.q4)}</td>`;
    }
    return `${PERIODS.map(([k]) => pc(s.ret[k])).join('')}<td>${qTag(data.quad?.[s.id])}</td>`;
  };
  const cols = tableTab === 'rs' ? 4 : PERIODS.length + 1;
  root.querySelector('#sec-table').innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th title="RRG에 표시">표시</th><th>ETF / 섹터</th><th class="num">종목</th>${head}<th></th></tr></thead><tbody>
    ${list.map((s) => `<tr data-row="${s.id}" style="cursor:pointer">
      <td><input type="checkbox" data-vis="${s.id}" ${hid.has(s.id) ? '' : 'checked'}></td>
      <td style="white-space:nowrap"><span class="dot" style="background:${s.color}"></span> <b>${esc(s.name)}</b> <span class="tag">${catName(catOf(s))}</span></td><td class="num">${s.tickers.length}</td>
      ${body(s)}
      <td class="num" style="white-space:nowrap"><button class="btn btn-sm" data-rename="${s.id}">이름</button> <button class="btn btn-sm" data-edit="${s.id}">편집</button></td></tr>
      ${open === s.id ? `<tr><td></td><td colspan="${cols + 3}"><div class="table-wrap"><table class="tbl"><thead><tr><th>종목</th>${PERIODS.map(([, l]) => `<th class="num">${l}</th>`).join('')}</tr></thead><tbody>
        ${s.members.slice().sort((a, b) => (b.ret.m3 ?? -1e9) - (a.ret.m3 ?? -1e9)).map((m) => `<tr><td><span class="sym">${esc(m.s)}</span> <span class="sub">${esc(m.n)}${m.ok ? '' : ' · 시세 없음'}</span></td>${PERIODS.map(([k]) => pc(m.ret[k])).join('')}</tr>`).join('')}
      </tbody></table></div></td></tr>` : ''}`).join('')}
  </tbody></table></div><p class="small muted">행을 누르면 구성 종목별 수익률을 볼 수 있습니다. 체크를 끄면 RRG와 '표시 ETF 평균'에서 빠집니다.</p>`;
  const el = root.querySelector('#sec-table');
  el.querySelectorAll('th.sortable').forEach((th) => { th.onclick = () => { sortDir = sortKey === th.dataset.k ? -sortDir : -1; sortKey = th.dataset.k; drawTable(root, data); }; });
  el.querySelectorAll('[data-row]').forEach((tr) => {
    tr.onclick = (e) => { if (e.target.closest('button,input')) return; open = open === tr.dataset.row ? null : tr.dataset.row; drawTable(root, data); };
  });
  el.querySelectorAll('[data-vis]').forEach((cb) => {
    cb.onchange = () => {
      updateQuiet('sectors', (s) => { const h = new Set(s.hidden || []); cb.checked ? h.delete(cb.dataset.vis) : h.add(cb.dataset.vis); s.hidden = [...h]; });
      draw(root, data);
    };
  });
  el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => sectorModal(S().list.find((s) => s.id === b.dataset.edit), root); });
  el.querySelectorAll('[data-rename]').forEach((b) => { b.onclick = () => renameModal(S().list.find((s) => s.id === b.dataset.rename), root); });
}

function renameModal(sec, root) {
  openModal({
    title: '섹터 이름 변경',
    body: `<label class="field">섹터 이름<input name="name" value="${esc(sec.name)}" required></label>`,
    onSubmit(d) {
      const name = d.name.trim();
      if (!name) throw new Error('이름을 입력하세요.');
      update('sectors', (s) => { s.list = s.list.map((x) => (x.id === sec.id ? { ...x, name } : x)); }, '섹터 이름 변경');
      render(root);
    },
  });
}

function sectorModal(sec, root) {
  const isEdit = !!sec;
  const curCat = sec ? catOf(sec) : 'custom';
  openModal({
    title: isEdit ? '섹터 편집' : '나만의 ETF 만들기',
    body: `<div class="form-grid">
      <label class="field">ETF · 섹터 이름<input name="name" value="${esc(sec?.name || '')}" required placeholder="예: 광학"></label>
      <label class="field">대분류<select name="cat">${CATS.map(([k, l]) => `<option value="${k}" ${curCat === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field full">편입 종목 (미국 티커, 쉼표·공백 구분)<textarea name="tickers" rows="4" placeholder="예: COHR, LITE, CIEN, GLW">${esc(sec?.tickers.join(', ') || '')}</textarea></label>
      <p class="small muted full">Yahoo 형식 티커(005930.KS)도 쓸 수 있습니다. 동일가중으로 계산합니다.</p></div>`,
    extraButtons: isEdit ? '<button type="button" class="btn btn-danger" data-del>ETF 삭제</button>' : '',
    onOpen(form, close) {
      form.querySelector('[data-del]')?.addEventListener('click', async () => {
        close();
        if (!(await confirmModal(`'${sec.name}' 섹터를 삭제할까요?`))) return;
        update('sectors', (s) => { s.list = s.list.filter((x) => x.id !== sec.id); }, '섹터 삭제');
        render(root);
      });
    },
    onSubmit(d) {
      const name = d.name.trim();
      const tickers = [...new Set(d.tickers.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
      if (!name) throw new Error('이름을 입력하세요.');
      if (!tickers.length) throw new Error('종목을 1개 이상 입력하세요.');
      if (tickers.length > 60) throw new Error('섹터당 60개 종목까지 가능합니다.');
      update('sectors', (s) => {
        if (isEdit) s.list = s.list.map((x) => (x.id === sec.id ? { ...x, name, tickers, cat: d.cat } : x));
        else s.list.push({ id: uid(), name, tickers, cat: d.cat });
      }, isEdit ? '섹터 편집' : '나만의 ETF 추가');
      render(root);
    },
  });
}
