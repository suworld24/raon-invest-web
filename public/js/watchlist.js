// 관심종목: 그룹 관리 · 시세 목록 · 가격 알림 · 종목 상세
import { state, update, market, esc, uid, fmtPct, fmtNum, cls, isKrx, openModal, confirmModal, toast } from './core.js';
import { renderStock, alertHit } from './stock.js';

let selected = null;
const collapsed = new Set();

const W = () => state.watch;
const fmtP = (v, sym) => (v == null ? '—' : isKrx(sym) ? fmtNum(v) : fmtNum(v, 2));

export async function render(root) {
  const groups = W().groups;
  const alertSyms = Object.keys(W().alerts || {});
  const allSyms = [...new Set([...groups.flatMap((g) => g.symbols), ...alertSyms])];
  if (!selected && allSyms.length) selected = allSyms[0];

  root.innerHTML = `
  <div class="watch-layout">
    <div class="card" style="padding:12px">
      <div class="card-head" style="margin-bottom:6px"><h2>내 관심 그룹</h2>
        <button class="btn btn-sm" data-act="add-sym">+ 종목</button>
        <button class="btn btn-sm" data-act="add-group">+ 새 그룹</button>
      </div>
      <div data-groups><div class="empty">시세 불러오는 중…</div></div>
    </div>
    <div class="card" data-detail>${selected ? '' : '<div class="empty" style="padding:60px 12px">↖<br><b>관심종목을 선택하세요</b><br>그룹을 펼쳐 종목을 누르면 가격과 실적을 볼 수 있습니다.</div>'}</div>
  </div>`;
  root.querySelector('[data-act=add-sym]').onclick = () => addSymbolModal(root);
  root.querySelector('[data-act=add-group]').onclick = () => groupModal(null, root);

  let quotes = {};
  try {
    await market.screener().catch(() => null);
    quotes = await market.quotes(allSyms);
  } catch { /* 시세 없이 목록만 */ }
  if (!root.isConnected) return;
  drawGroups(root, quotes);
  if (selected) renderStock(root.querySelector('[data-detail]'), selected, { onChange: () => render(root) });
}

function itemHtml(sym, q, gid) {
  const hit = alertHit(sym, q?.p);
  return `<div class="witem ${selected === sym ? 'on' : ''}" data-sym="${esc(sym)}">
    <div><div class="s">${esc(sym)} ${W().alerts?.[sym] ? `<span title="${esc(hit || '가격 알림 설정됨')}">${hit ? '🔔' : '🔕'}</span>` : ''}</div><div class="n">${esc(q?.name || market.lookup(sym)?.n || '')}</div></div>
    <div><div class="p">${fmtP(q?.p, sym)}</div><div class="c ${cls(q?.chg)}">${fmtPct(q?.chg)}</div></div>
    ${gid ? `<button class="star" data-remove="${esc(sym)}" data-gid="${gid}" title="그룹에서 빼기" style="grid-column:2;justify-self:end;font-size:11px">빼기</button>` : ''}
  </div>`;
}

function drawGroups(root, quotes) {
  const groups = W().groups;
  const alertSyms = Object.keys(W().alerts || {});
  const box = root.querySelector('[data-groups]');
  const auto = alertSyms.length ? `<div class="wgroup">
      <div class="wgroup-head" data-toggle="__alert"><span>${collapsed.has('__alert') ? '▸' : '▾'}</span><span class="gname">🔔 알림 설정 종목</span><span class="cnt">${alertSyms.length}</span><span class="sp"></span><span class="tag">자동</span></div>
      ${collapsed.has('__alert') ? '' : alertSyms.map((s) => itemHtml(s, quotes[s])).join('')}
    </div>` : '';
  box.innerHTML = auto + groups.map((g, i) => `<div class="wgroup">
    <div class="wgroup-head" data-toggle="${g.id}"><span>${collapsed.has(g.id) ? '▸' : '▾'}</span><span class="gname">${esc(g.name)}</span><span class="cnt">${g.symbols.length}</span><span class="sp"></span>
      <button class="mini" data-up="${g.id}" title="위로" ${i === 0 ? 'disabled' : ''}>↑</button><button class="mini" data-down="${g.id}" title="아래로" ${i === groups.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="mini" data-add="${g.id}" title="이 그룹에 종목 추가">＋</button><button class="mini" data-edit="${g.id}" title="그룹 편집">⋯</button></div>
    ${collapsed.has(g.id) ? '' : (g.symbols.length ? g.symbols.map((s) => itemHtml(s, quotes[s], g.id)).join('') : '<div class="small muted" style="padding:4px 22px 10px">＋를 눌러 종목을 추가하세요.</div>')}
  </div>`).join('');

  box.querySelectorAll('[data-toggle]').forEach((h) => {
    h.onclick = (e) => {
      if (e.target.closest('button')) return;
      const id = h.dataset.toggle;
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      drawGroups(root, quotes);
    };
  });
  box.querySelectorAll('[data-sym]').forEach((it) => {
    it.onclick = (e) => {
      if (e.target.closest('[data-remove]')) return;
      selected = it.dataset.sym;
      box.querySelectorAll('.witem').forEach((x) => x.classList.toggle('on', x.dataset.sym === selected));
      const detail = root.querySelector('[data-detail]');
      renderStock(detail, selected, { onChange: () => render(root) });
      if (window.innerWidth < 960) detail.scrollIntoView({ behavior: 'smooth' });
    };
  });
  box.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = () => {
      const { remove: sym, gid } = b.dataset;
      update('watch', (w) => { const g = w.groups.find((x) => x.id === gid); if (g) g.symbols = g.symbols.filter((s) => s !== sym); }, '관심종목 빼기');
      drawGroups(root, quotes);
    };
  });
  const move = (id, dir) => {
    update('watch', (w) => {
      const i = w.groups.findIndex((g) => g.id === id), j = i + dir;
      if (j < 0 || j >= w.groups.length) return;
      [w.groups[i], w.groups[j]] = [w.groups[j], w.groups[i]];
    }, '그룹 순서 변경');
    drawGroups(root, quotes);
  };
  box.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => move(b.dataset.up, -1); });
  box.querySelectorAll('[data-down]').forEach((b) => { b.onclick = () => move(b.dataset.down, 1); });
  box.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => addSymbolModal(root, b.dataset.add); });
  box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => groupModal(W().groups.find((g) => g.id === b.dataset.edit), root); });
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
      <label class="field full">그룹<select name="gid">${W().groups.map((g) => `<option value="${g.id}" ${g.id === gid ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <p class="small muted full">한국 주식은 코스피 .KS, 코스닥 .KQ를 붙여 입력하세요.</p></div>`,
    submitText: '추가',
    async onSubmit(d) {
      const syms = [...new Set(d.syms.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
      if (!syms.length) throw new Error('종목을 입력하세요.');
      const q = await market.quotes(syms);
      const bad = syms.filter((s) => !q[s]);
      if (bad.length === syms.length) throw new Error(`시세를 찾지 못했습니다: ${bad.join(', ')}`);
      const good = syms.filter((s) => q[s]);
      update('watch', (w) => { const g = w.groups.find((x) => x.id === d.gid); g.symbols = [...new Set([...g.symbols, ...good])]; }, '관심종목 추가');
      if (bad.length) toast(`찾지 못한 종목은 제외했습니다: ${bad.join(', ')}`);
      selected = good[0];
      collapsed.delete(d.gid);
      render(root);
    },
  });
}

function groupModal(g, root) {
  const isEdit = !!g;
  openModal({
    title: isEdit ? '그룹 편집' : '새 그룹',
    body: `<label class="field">그룹 이름<input name="name" value="${esc(g?.name || '')}" required placeholder="예: 배당주, 🇺🇸 M7"></label>
      ${isEdit ? `<p class="small muted">종목 ${g.symbols.length}개: ${esc(g.symbols.join(', ') || '없음')}</p>` : ''}`,
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
        if (isEdit) w.groups.find((x) => x.id === g.id).name = name;
        else w.groups.push({ id: uid(), name, symbols: [] });
      }, isEdit ? '그룹 이름 변경' : '관심 그룹 추가');
      render(root);
    },
  });
}
