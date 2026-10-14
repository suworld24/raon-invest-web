// 관심종목: 그룹 관리 · 그룹 표(가격·등락률·주봉 정배열·이평선·종합 상태) · 실적 벨 · 끌어서 순서 변경
//           · 컨센서스 대비 실적 · 가격 알림 · 종목 상세
import { state, update, market, esc, uid, fmtPct, fmtNum, cls, isKrx, toggleBell, openModal, confirmModal, toast } from './core.js';
import { renderStock, alertHit, earningsBars } from './stock.js';
import { metricsFor, statusBadge, alignCell } from './metrics.js';

let selGroup = null;   // 표로 보는 그룹 id ('__bell' = 벨 표시 종목)
let selSym = null;     // 상세로 보는 종목
let retK = 'd1';
let eSym = null, ePer = 'q', eFld = 'rev';
const collapsed = new Set();
const RETS = [['d1', '일간 등락률'], ['m1', '1개월 등락률'], ['m3', '3개월 등락률'], ['m6', '6개월 등락률'], ['y1', '12개월 등락률'], ['ytd', 'YTD 등락률']];

const W = () => state.watch;
const bells = () => W().bells || [];
const fmtP = (v, sym) => (v == null ? '—' : isKrx(sym) ? fmtNum(v) : fmtNum(v, 2));
const groupSyms = (gid) => (gid === '__bell' ? bells() : (W().groups.find((g) => g.id === gid)?.symbols || []));
const groupName = (gid) => (gid === '__bell' ? '🔔 벨 표시 종목' : W().groups.find((g) => g.id === gid)?.name || '');

export async function render(root) {
  if (!selGroup || (selGroup !== '__bell' && !W().groups.some((g) => g.id === selGroup))) selGroup = W().groups[0]?.id || '__bell';
  const all = [...new Set([...W().groups.flatMap((g) => g.symbols), ...bells(), ...Object.keys(W().alerts || {})])];
  root.innerHTML = `
  <div class="watch-layout">
    <div class="card" style="padding:12px">
      <div class="card-head" style="margin-bottom:6px"><h2>내 관심 그룹</h2>
        <button class="btn btn-sm" data-act="add-sym">+ 종목</button>
        <button class="btn btn-sm" data-act="add-group">+ 새 그룹</button>
      </div>
      <div data-groups><div class="empty">시세 불러오는 중…</div></div>
    </div>
    <div class="card" data-main></div>
  </div>`;
  root.querySelector('[data-act=add-sym]').onclick = () => addSymbolModal(root);
  root.querySelector('[data-act=add-group]').onclick = () => groupModal(null, root);
  let quotes = {};
  try { await market.screener().catch(() => null); quotes = await market.quotes(all); } catch { /* 시세 없이 */ }
  if (!root.isConnected) return;
  drawGroups(root, quotes);
  drawMain(root, quotes);
}

function itemHtml(sym, q, gid) {
  const hit = alertHit(sym, q?.p);
  const bell = bells().includes(sym);
  return `<div class="witem ${selSym === sym ? 'on' : ''}" data-sym="${esc(sym)}" ${gid && gid !== '__bell' ? `draggable="true" data-gid="${gid}"` : ''}>
    <div><div class="s">${esc(sym)} ${W().alerts?.[sym] ? `<span title="${esc(hit || '가격 알림 설정됨')}">${hit ? '⏰' : ''}</span>` : ''}</div><div class="n">${esc(q?.name || market.lookup(sym)?.n || '')}</div></div>
    <div><div class="p">${fmtP(q?.p, sym)}</div><div class="c ${cls(q?.chg)}">${fmtPct(q?.chg)}</div></div>
    <div style="grid-column:1/-1;display:flex;gap:4px;justify-content:flex-end">
      <button class="star" data-bell="${esc(sym)}" title="${bell ? '실적 벨 끄기' : '실적 벨 켜기 (캘린더에 실적일 표시)'}" style="font-size:12px">${bell ? '🔔' : '🔕'}</button>
      ${gid && gid !== '__bell' ? `<button class="star" data-remove="${esc(sym)}" data-gid="${gid}" title="그룹에서 빼기" style="font-size:11px">빼기</button>` : ''}
    </div>
  </div>`;
}

function drawGroups(root, quotes) {
  const box = root.querySelector('[data-groups]');
  const bellSyms = bells();
  const head = (id, name, n, extra = '') => `<div class="wgroup-head ${selGroup === id && !selSym ? 'on' : ''}" data-gsel="${id}" ${id !== '__bell' ? `draggable="true" data-gdrag="${id}"` : ''}>
      <span class="mini" data-toggle="${id}">${collapsed.has(id) ? '▸' : '▾'}</span><span class="gname">${name}</span><span class="cnt">${n}</span><span class="sp"></span>${extra}</div>`;
  box.innerHTML = `<div class="wgroup">${head('__bell', '🔔 벨 표시 종목', bellSyms.length, '<span class="tag">자동</span>')}
      ${collapsed.has('__bell') ? '' : bellSyms.length ? bellSyms.map((s) => itemHtml(s, quotes[s], '__bell')).join('') : '<div class="small muted" style="padding:2px 22px 10px">벨을 켜면 추가되고 끄면 빠집니다.</div>'}</div>`
    + W().groups.map((g) => `<div class="wgroup" data-gwrap="${g.id}">
      ${head(g.id, esc(g.name), g.symbols.length, `<button class="mini" data-add="${g.id}" title="이 그룹에 종목 추가">＋</button><button class="mini" data-edit="${g.id}" title="그룹 편집">⋯</button><span class="mini" title="끌어서 순서 변경" style="cursor:grab">⠿</span>`)}
      ${collapsed.has(g.id) ? '' : (g.symbols.length ? g.symbols.map((s) => itemHtml(s, quotes[s], g.id)).join('') : '<div class="small muted" style="padding:2px 22px 10px">＋를 눌러 종목을 추가하세요.</div>')}
    </div>`).join('');

  box.querySelectorAll('[data-toggle]').forEach((t) => {
    t.onclick = (e) => { e.stopPropagation(); const id = t.dataset.toggle; collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); drawGroups(root, quotes); };
  });
  box.querySelectorAll('[data-gsel]').forEach((h) => {
    h.onclick = (e) => { if (e.target.closest('button')) return; selGroup = h.dataset.gsel; selSym = null; drawGroups(root, quotes); drawMain(root, quotes); };
  });
  box.querySelectorAll('[data-sym]').forEach((it) => {
    it.onclick = (e) => {
      if (e.target.closest('button')) return;
      selSym = it.dataset.sym;
      drawGroups(root, quotes); drawMain(root, quotes);
      if (window.innerWidth < 960) root.querySelector('[data-main]').scrollIntoView({ behavior: 'smooth' });
    };
  });
  box.querySelectorAll('[data-bell]').forEach((b) => { b.onclick = () => { toggleBell(b.dataset.bell); drawGroups(root, quotes); if (!selSym) drawMain(root, quotes); }; });
  box.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = () => {
      const { remove: sym, gid } = b.dataset;
      update('watch', (w) => { const g = w.groups.find((x) => x.id === gid); if (g) g.symbols = g.symbols.filter((s) => s !== sym); }, '관심종목 빼기');
      drawGroups(root, quotes); if (!selSym) drawMain(root, quotes);
    };
  });
  box.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => addSymbolModal(root, b.dataset.add); });
  box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => groupModal(W().groups.find((g) => g.id === b.dataset.edit), root); });

  // 그룹 끌어서 순서 변경
  let dragG = null;
  box.querySelectorAll('[data-gdrag]').forEach((h) => {
    h.addEventListener('dragstart', (e) => { dragG = h.dataset.gdrag; e.dataTransfer.effectAllowed = 'move'; });
    h.addEventListener('dragover', (e) => { if (dragG) e.preventDefault(); });
    h.addEventListener('drop', (e) => {
      e.preventDefault();
      const to = h.dataset.gdrag;
      if (!dragG || dragG === to) return;
      update('watch', (w) => { const from = w.groups.findIndex((g) => g.id === dragG); const [g] = w.groups.splice(from, 1); w.groups.splice(w.groups.findIndex((x) => x.id === to), 0, g); }, '그룹 순서 변경');
      dragG = null; drawGroups(root, quotes);
    });
  });
  // 종목 끌어서 순서 변경 / 다른 그룹으로 이동
  let dragS = null;
  box.querySelectorAll('.witem[draggable]').forEach((it) => {
    it.addEventListener('dragstart', (e) => { dragS = { s: it.dataset.sym, g: it.dataset.gid }; e.stopPropagation(); });
    it.addEventListener('dragover', (e) => { if (dragS) e.preventDefault(); });
    it.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!dragS) return;
      const toG = it.dataset.gid, toS = it.dataset.sym;
      update('watch', (w) => {
        const src = w.groups.find((g) => g.id === dragS.g), dst = w.groups.find((g) => g.id === toG);
        src.symbols = src.symbols.filter((s) => s !== dragS.s);
        dst.symbols = dst.symbols.filter((s) => s !== dragS.s);
        dst.symbols.splice(dst.symbols.indexOf(toS) + (src === dst ? 0 : 1), 0, dragS.s);
      }, '관심종목 순서 변경');
      dragS = null; drawGroups(root, quotes); if (!selSym) drawMain(root, quotes);
    });
  });
}

async function drawMain(root, quotes) {
  const main = root.querySelector('[data-main]');
  if (selSym) {
    main.innerHTML = '<button class="btn btn-sm" data-back style="margin-bottom:10px">↑ 관심그룹 보기</button><div data-stock></div>';
    main.querySelector('[data-back]').onclick = () => { selSym = null; drawGroups(root, quotes); drawMain(root, quotes); };
    renderStock(main.querySelector('[data-stock]'), selSym, { onChange: () => render(root) });
    return;
  }
  const syms = groupSyms(selGroup);
  main.innerHTML = `<div class="card-head"><h2>${esc(groupName(selGroup))}</h2>
      <select data-gpick>${[['__bell', '🔔 벨 표시 종목'], ...W().groups.map((g) => [g.id, g.name])].map(([id, n]) => `<option value="${id}" ${id === selGroup ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    ${syms.length ? '<div data-table><div class="empty">지표 불러오는 중…</div></div><div data-earn style="margin-top:18px"></div>' : '<div class="empty" style="padding:50px 12px">↖<br><b>관심종목을 선택하세요</b><br>그룹을 펼쳐 종목을 누르면 가격과 실적을 볼 수 있습니다.</div>'}`;
  main.querySelector('[data-gpick]').onchange = (e) => { selGroup = e.target.value; drawGroups(root, quotes); drawMain(root, quotes); };
  if (!syms.length) return;
  const m = await metricsFor(syms);
  if (!main.isConnected) return;
  const box = main.querySelector('[data-table]');
  const ma = (t, k) => (t?.[k] == null ? '<span class="muted">—</span>' : `${isKrx(selSym || '') ? '' : ''}${fmtNum(t[k], t[k] > 1000 ? 0 : 2)} <span class="${t.p >= t[k] ? 'up' : 'down'}">${t.p >= t[k] ? '상회' : '이탈'}</span>`);
  box.innerHTML = `<h3 style="margin-bottom:6px">가격 · 주요 가격지표</h3><div class="table-wrap"><table class="tbl"><thead><tr>
      <th>종목</th><th class="num">현재가</th>
      <th class="num"><select data-ret class="small" style="height:24px;padding:0 4px">${RETS.map(([k, l]) => `<option value="${k}" ${k === retK ? 'selected' : ''}>${l}</option>`).join('')}</select></th>
      <th class="num">주봉 정배열<div class="sub">4·13·26·52주</div></th><th class="num">주요 이평선</th><th class="num">종합 상태</th><th class="num">벨</th><th></th>
    </tr></thead><tbody>
    ${syms.map((s) => {
      const t = m[s]?.t;
      const q = quotes[s];
      return `<tr data-row="${esc(s)}" ${selGroup !== '__bell' ? 'draggable="true"' : ''}>
        <td data-open="${esc(s)}" style="cursor:pointer"><span class="sym">${esc(s)}</span><div class="sub">${esc(q?.name || market.lookup(s)?.n || '')}</div></td>
        <td class="num">${fmtP(t?.p ?? q?.p, s)}</td>
        <td class="num ${cls(retK === 'd1' ? (t?.d1 ?? q?.chg) : t?.[retK])}">${fmtPct(retK === 'd1' ? (t?.d1 ?? q?.chg) : t?.[retK])}</td>
        <td class="num">${alignCell(t)}</td>
        <td class="num" style="white-space:nowrap;font-size:12px"><div>20일 ${ma(t, 's20')}</div><div>60일 ${ma(t, 's60')}</div><div>120일 ${ma(t, 's120')}</div></td>
        <td class="num">${statusBadge(t?.st)}<div class="sub">${esc(t?.at || '')}</div></td>
        <td class="num"><button class="star" data-tbell="${esc(s)}">${bells().includes(s) ? '🔔' : '🔕'}</button></td>
        <td class="num" style="white-space:nowrap">${selGroup !== '__bell' ? '<span title="끌어서 순서 변경" style="cursor:grab;color:var(--muted)">⠿</span> ' : ''}<button class="btn btn-sm" data-unwatch="${esc(s)}">해제</button></td></tr>`;
    }).join('')}
    </tbody></table></div>
    <details class="small muted" style="margin-top:8px"><summary>이동평균선 및 상태 판정 기준</summary>
      <p>종가와 단순이동평균(SMA)을 비교합니다. 120일선 아래는 이탈위험, 그 외 60일선 아래는 경계, 그 외 20일선 아래 또는 주봉 정배열 미충족은 주의, 세 일간선 이상이며 4주 > 13주 > 26주 > 52주 순서이면 양호입니다. 주간 이평선은 진행 중인 주를 제외하고 완료된 주의 종가로 계산하며, O 아래 경과일은 현재 정배열이 연속해서 유지된 기간입니다. 자료가 부족하면 —로 표시합니다.</p></details>`;
  box.querySelector('[data-ret]').onchange = (e) => { retK = e.target.value; drawMain(root, quotes); };
  box.querySelectorAll('[data-open]').forEach((td) => { td.onclick = () => { selSym = td.dataset.open; drawGroups(root, quotes); drawMain(root, quotes); }; });
  box.querySelectorAll('[data-tbell]').forEach((b) => { b.onclick = () => { toggleBell(b.dataset.tbell); drawGroups(root, quotes); drawMain(root, quotes); }; });
  box.querySelectorAll('[data-unwatch]').forEach((b) => {
    b.onclick = () => {
      const s = b.dataset.unwatch;
      if (selGroup === '__bell') toggleBell(s);
      else update('watch', (w) => { const g = w.groups.find((x) => x.id === selGroup); g.symbols = g.symbols.filter((x) => x !== s); }, '관심종목 해제');
      drawGroups(root, quotes); drawMain(root, quotes);
    };
  });
  // 표에서 끌어서 순서 변경
  let drag = null;
  box.querySelectorAll('tr[draggable]').forEach((tr) => {
    tr.addEventListener('dragstart', () => { drag = tr.dataset.row; });
    tr.addEventListener('dragover', (e) => { if (drag) e.preventDefault(); });
    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      const to = tr.dataset.row;
      if (!drag || drag === to) return;
      update('watch', (w) => { const g = w.groups.find((x) => x.id === selGroup); g.symbols = g.symbols.filter((x) => x !== drag); g.symbols.splice(g.symbols.indexOf(to), 0, drag); }, '관심종목 순서 변경');
      drag = null; drawGroups(root, quotes); drawMain(root, quotes);
    });
  });
  drawEarnings(main.querySelector('[data-earn]'), syms);
}

async function drawEarnings(el, syms) {
  if (!syms.includes(eSym)) eSym = syms[0];
  el.innerHTML = `<div class="card-head"><h3 style="margin-right:auto">컨센서스 및 실적 현황</h3>
      <div class="seg"><button data-per="q" class="${ePer === 'q' ? 'on' : ''}">분기</button><button data-per="y" class="${ePer === 'y' ? 'on' : ''}">연간</button></div>
      <div class="seg"><button data-fld="rev" class="${eFld === 'rev' ? 'on' : ''}">매출액</button><button data-fld="eps" class="${eFld === 'eps' ? 'on' : ''}">EPS</button></div></div>
    <div class="toolbar" style="margin-bottom:8px">${syms.map((s) => `<button class="chip ${s === eSym ? 'on' : ''}" data-es="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <div data-ec><div class="empty">${esc(eSym)} 실적 불러오는 중…</div></div>`;
  el.querySelectorAll('[data-es]').forEach((b) => { b.onclick = () => { eSym = b.dataset.es; drawEarnings(el, syms); }; });
  el.querySelectorAll('[data-per]').forEach((b) => { b.onclick = () => { ePer = b.dataset.per; drawEarnings(el, syms); }; });
  el.querySelectorAll('[data-fld]').forEach((b) => { b.onclick = () => { eFld = b.dataset.fld; drawEarnings(el, syms); }; });
  let p = null;
  try { p = await market.profile(eSym); } catch { /* 없음 */ }
  if (!el.isConnected) return;
  el.querySelector('[data-ec]').innerHTML = earningsBars(p, ePer, eFld, p?.cur || (isKrx(eSym) ? 'KRW' : 'USD'));
}

async function addSymbolModal(root, gid) {
  if (!W().groups.length) return toast('먼저 그룹을 만드세요.');
  let opts = '';
  try { opts = (await market.screener()).rows.slice(0, 3000).map((r) => `<option value="${esc(r.s)}">${esc(r.n)}</option>`).join(''); } catch { /* 자동완성 없이 */ }
  openModal({
    title: '관심종목 추가',
    body: `<div class="form-grid">
      <label class="field full">종목 (티커, 여러 개는 쉼표로)<input name="syms" list="w-syms" placeholder="예: NVDA, 005930.KS" autocomplete="off" required></label>
      <datalist id="w-syms">${opts}</datalist>
      <label class="field">그룹<select name="gid">${W().groups.map((g) => `<option value="${g.id}" ${g.id === (gid || selGroup) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <label class="field" style="justify-content:flex-end"><span><input type="checkbox" name="bell"> 실적 벨도 켜기</span></label>
      <p class="small muted full">한국 주식은 코스피 .KS, 코스닥 .KQ를 붙여 입력하세요.</p></div>`,
    submitText: '추가',
    async onSubmit(d, form) {
      const syms = [...new Set(d.syms.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
      if (!syms.length) throw new Error('종목을 입력하세요.');
      const q = await market.quotes(syms);
      const bad = syms.filter((s) => !q[s]);
      if (bad.length === syms.length) throw new Error(`시세를 찾지 못했습니다: ${bad.join(', ')}`);
      const good = syms.filter((s) => q[s]);
      update('watch', (w) => {
        const g = w.groups.find((x) => x.id === d.gid);
        g.symbols = [...new Set([...g.symbols, ...good])];
        if (form.bell.checked) w.bells = [...new Set([...(w.bells || []), ...good])];
      }, '관심종목 추가');
      if (bad.length) toast(`찾지 못한 종목은 제외했습니다: ${bad.join(', ')}`);
      selGroup = d.gid; selSym = null;
      collapsed.delete(d.gid);
      render(root);
    },
  });
}

function groupModal(g, root) {
  const isEdit = !!g;
  openModal({
    title: isEdit ? '그룹 수정' : '새 그룹',
    body: `<label class="field">그룹 이름<input name="name" value="${esc(g?.name || '')}" required placeholder="예: ♡ 관심, 🇺🇸 M7"></label>
      ${isEdit ? `<p class="small muted">종목 ${g.symbols.length}개: ${esc(g.symbols.join(', ') || '없음')}</p>
      <label class="field">이 그룹 종목의 실적 벨<select name="bellAll"><option value="">그대로 두기</option><option value="on">모두 켜기</option><option value="off">모두 끄기</option></select></label>` : ''}`,
    extraButtons: isEdit ? '<button type="button" class="btn btn-danger" data-del>그룹 삭제</button>' : '',
    onOpen(form, close) {
      form.querySelector('[data-del]')?.addEventListener('click', async () => {
        close();
        if (!(await confirmModal(`'${g.name}' 그룹을 삭제할까요? (종목 ${g.symbols.length}개)`))) return;
        update('watch', (w) => { w.groups = w.groups.filter((x) => x.id !== g.id); }, '관심 그룹 삭제');
        render(root);
      });
    },
    onSubmit(d) {
      const name = d.name.trim();
      if (!name) throw new Error('이름을 입력하세요.');
      update('watch', (w) => {
        if (isEdit) {
          w.groups.find((x) => x.id === g.id).name = name;
          if (d.bellAll === 'on') w.bells = [...new Set([...(w.bells || []), ...g.symbols])];
          if (d.bellAll === 'off') w.bells = (w.bells || []).filter((s) => !g.symbols.includes(s));
        } else w.groups.push({ id: uid(), name, symbols: [] });
      }, isEdit ? '그룹 수정' : '관심 그룹 추가');
      render(root);
    },
  });
}
