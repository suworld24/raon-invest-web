// 섹터 퍼포먼스: 내가 만든 섹터(종목 묶음)의 동일가중 수익률 + RRG
import { state, update, updateQuiet, market, esc, uid, fmtPct, fmtNum, cls, download, toCsv, today, openModal, confirmModal, toast } from './core.js';
import { rrg, color, quadrant } from './charts.js';
import { PERIODS, align, equalWeightIndex, periodReturns, rrgPoints } from './analytics.js';

let sortKey = 'm3', sortDir = -1;
let bench = 'avg';
let offset = 0;        // 타임라인: 몇 주 전
const tail = 4;        // 이동 경로 길이 (주)
let showTail = true;
let open = null;       // 펼친 섹터 id
let focus = '';        // 위쪽 필터에서 고른 섹터

const S = () => state.sectors;
const hidden = () => new Set(S().hidden || []);

export async function render(root) {
  const list = S().list;
  const allSyms = [...new Set(list.flatMap((s) => s.tickers))];
  root.innerHTML = `
  <div class="toolbar">
    <select id="sec-focus"><option value="">전체 섹터</option>${list.map((s) => `<option value="${s.id}" ${focus === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <span style="flex:1"></span>
    <button class="btn" id="sec-backup">리스트 백업</button>
    <button class="btn" id="sec-import">리스트 불러오기</button>
    <input type="file" id="sec-file" accept="application/json" hidden>
    <button class="btn" id="sec-csv">CSV 다운로드</button>
    <button class="btn btn-primary" id="sec-add">섹터 추가</button>
  </div>
  <div class="card rrg">
    <div class="card-head"><h2>섹터 강도 · 모멘텀</h2>
      <select id="rrg-bench"><option value="avg" ${bench === 'avg' ? 'selected' : ''}>비교 기준: 선택 섹터 평균</option><option value="SPY" ${bench === 'SPY' ? 'selected' : ''}>비교 기준: S&P 500 (SPY)</option><option value="QQQ" ${bench === 'QQQ' ? 'selected' : ''}>비교 기준: 나스닥100 (QQQ)</option></select>
      <label class="chip ${showTail ? 'on' : ''}"><input type="checkbox" id="rrg-tail" ${showTail ? 'checked' : ''}> 이동 경로</label>
    </div>
    <div class="toolbar"><span class="small muted">타임라인</span><input type="range" id="rrg-off" min="0" max="20" value="${20 - offset}" style="flex:1;height:auto"><span class="small" id="rrg-when">현재</span>
      <button class="btn btn-sm" id="rrg-prev">← 이전</button><button class="btn btn-sm" id="rrg-next">이후 →</button><button class="btn btn-sm" id="rrg-now">현재로</button></div>
    <div id="rrg-box"><div class="empty" id="rrg-progress">과거 시세 불러오는 중 · 0/${allSyms.length}</div></div>
    <p class="small muted">가로: 상대강도 추세 · 세로: 상대강도 모멘텀 · 기준선 100. 주 단위로 계산한 추정치입니다.</p>
  </div>
  <div class="card">
    <div class="card-head"><h2>섹터 리스트 <span class="small muted">(${list.length}개 섹터 · ${allSyms.length}개 종목 · 동일가중 가격 수익률)</span></h2></div>
    <div id="sec-table"><div class="empty">계산 중…</div></div>
  </div>`;

  root.querySelector('#sec-focus').onchange = (e) => { focus = e.target.value; open = focus || null; render(root); };
  root.querySelector('#sec-add').onclick = () => sectorModal(null, root);
  root.querySelector('#sec-backup').onclick = () => download(`섹터리스트-${today()}.json`, JSON.stringify(S().list, null, 2), 'application/json');
  root.querySelector('#sec-import').onclick = () => root.querySelector('#sec-file').click();
  root.querySelector('#sec-file').onchange = async (e) => {
    try {
      const arr = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(arr) || !arr.every((x) => x.name && Array.isArray(x.tickers))) throw new Error();
      update('sectors', (s) => { s.list = arr.map((x) => ({ id: x.id || uid(), name: String(x.name), tickers: x.tickers.map((t) => String(t).toUpperCase()) })); }, '섹터 리스트 불러오기');
      render(root);
    } catch { toast('섹터 리스트 파일 형식이 아닙니다.'); }
  };
  root.querySelector('#rrg-bench').onchange = (e) => { bench = e.target.value; draw(root, data); };
  root.querySelector('#rrg-tail').onchange = (e) => { showTail = e.target.checked; e.target.parentElement.classList.toggle('on', showTail); draw(root, data); };
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
    const rows = [['섹터', '종목수', ...PERIODS.map((p) => p[1] + '(%)'), '구성 종목'],
      ...sectors.map((s) => [s.name, s.tickers.length, ...PERIODS.map((p) => s.ret[p[0]]?.toFixed(2) ?? ''), s.tickers.join(' ')])];
    download(`섹터수익률-${today()}.csv`, toCsv(rows), 'text/csv');
  };
}

function fillGaps(v) {
  const out = v.slice();
  for (let i = 1; i < out.length; i++) if (out[i] == null) out[i] = out[i - 1];
  return out;
}

function draw(root, data) {
  if (!data) return;
  const { axis, hist, sectors } = data;
  const hid = hidden();
  const active = sectors.filter((s) => s.idx && !hid.has(s.id));
  let benchIdx;
  if (bench === 'avg') {
    const base = sectors.filter((s) => s.idx && !hid.has(s.id));
    benchIdx = axis.map((_, i) => base.reduce((a, s) => a + s.idx[i], 0) / (base.length || 1));
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
  root.querySelector('#rrg-box').innerHTML = rrg(series, { tail: showTail ? tail : 1 });
  data.quad = Object.fromEntries(sectors.map((s) => {
    const pts = s.idx ? rrgPoints(s.idx, benchIdx) : [];
    const p = pts[pts.length - 1 - offset];
    return [s.id, p ? quadrant(p.x, p.y) : '—'];
  }));
  if (root.querySelector('#sec-table table')) drawTable(root, data);
}

function drawTable(root, data) {
  const hid = hidden();
  const list = data.sectors.slice().sort((a, b) => ((a.ret[sortKey] ?? -1e9) - (b.ret[sortKey] ?? -1e9)) * sortDir);
  const pc = (v) => `<td class="num ${cls(v)}">${fmtPct(v, 1)}</td>`;
  const qColor = { 주도: 'var(--c3)', 개선: 'var(--c1)', 부진: 'var(--c5)', 약화: 'var(--c7)' };
  root.querySelector('#sec-table').innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th title="RRG에 표시">표시</th><th>섹터</th><th class="num">종목</th>
    ${PERIODS.map(([k, l]) => `<th class="num sortable" data-k="${k}">${l} ${sortKey === k ? (sortDir < 0 ? '▼' : '▲') : ''}</th>`).join('')}<th>현재 영역</th><th></th></tr></thead><tbody>
    ${list.map((s) => `<tr data-row="${s.id}" style="cursor:pointer">
      <td><input type="checkbox" data-vis="${s.id}" ${hid.has(s.id) ? '' : 'checked'}></td>
      <td style="white-space:nowrap"><span class="dot" style="background:${s.color}"></span> <b>${esc(s.name)}</b></td><td class="num">${s.tickers.length}</td>
      ${PERIODS.map(([k]) => pc(s.ret[k])).join('')}
      <td>${data.quad?.[s.id] ? `<span class="tag" style="color:${qColor[data.quad[s.id]] || 'inherit'}">${data.quad[s.id]}</span>` : ''}</td>
      <td class="num" style="white-space:nowrap"><button class="btn btn-sm" data-edit="${s.id}">편집</button></td></tr>
      ${open === s.id ? `<tr><td></td><td colspan="${PERIODS.length + 4}"><div class="table-wrap"><table class="tbl"><thead><tr><th>종목</th>${PERIODS.map(([, l]) => `<th class="num">${l}</th>`).join('')}</tr></thead><tbody>
        ${s.members.slice().sort((a, b) => (b.ret[sortKey] ?? -1e9) - (a.ret[sortKey] ?? -1e9)).map((m) => `<tr><td><span class="sym">${esc(m.s)}</span> <span class="sub">${esc(m.n)}${m.ok ? '' : ' · 시세 없음'}</span></td>${PERIODS.map(([k]) => pc(m.ret[k])).join('')}</tr>`).join('')}
      </tbody></table></div></td></tr>` : ''}`).join('')}
  </tbody></table></div><p class="small muted">행을 누르면 구성 종목별 수익률을 볼 수 있습니다.</p>`;
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
}

function sectorModal(sec, root) {
  const isEdit = !!sec;
  openModal({
    title: isEdit ? '섹터 편집' : '섹터 추가',
    body: `<label class="field">섹터 이름<input name="name" value="${esc(sec?.name || '')}" required placeholder="예: 로봇"></label>
      <label class="field">구성 종목 (쉼표·공백으로 구분)<textarea name="tickers" rows="4" placeholder="예: ISRG, TER, SYM">${esc(sec?.tickers.join(', ') || '')}</textarea></label>
      <p class="small muted">미국 티커 또는 Yahoo 형식 티커(005930.KS)를 쓸 수 있습니다. 동일가중으로 계산합니다.</p>`,
    extraButtons: isEdit ? '<button type="button" class="btn btn-danger" data-del>섹터 삭제</button>' : '',
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
        if (isEdit) s.list = s.list.map((x) => (x.id === sec.id ? { ...x, name, tickers } : x));
        else s.list.push({ id: uid(), name, tickers });
      }, isEdit ? '섹터 편집' : '섹터 추가');
      render(root);
    },
  });
}
