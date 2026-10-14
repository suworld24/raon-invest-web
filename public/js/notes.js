// 참고자료: 링크 · 메모 보관함 (태그 · 검색 · 고정)
import { state, update, esc, uid, today, openModal, confirmModal } from './core.js';

let q = '';
let tag = '';

const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

export function render(root) {
  const items = state.notes.items;
  const tags = [...new Set(items.flatMap((n) => n.tags || []))].sort();
  const ql = q.trim().toLowerCase();
  const list = items
    .filter((n) => !tag || (n.tags || []).includes(tag))
    .filter((n) => !ql || [n.title, n.body, n.url, ...(n.tags || [])].join(' ').toLowerCase().includes(ql))
    .sort((a, b) => (b.pinned - a.pinned) || (a.date < b.date ? 1 : -1));

  root.innerHTML = `
  <div class="toolbar">
    <input id="nt-q" placeholder="제목·내용·태그 검색" value="${esc(q)}" style="width:240px">
    <span class="chip ${!tag ? 'on' : ''}" data-tag="">전체 ${items.length}</span>
    ${tags.map((t) => `<span class="chip ${tag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</span>`).join('')}
    <span style="flex:1"></span>
    <button class="btn btn-primary" id="nt-add">+ 자료 추가</button>
  </div>
  ${list.length ? `<div class="notes-grid">${list.map((n) => `<article class="note">
    <div class="meta">${n.pinned ? '<span title="고정">📌</span>' : ''}<span>${esc(n.date)}</span>${(n.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
    <h3>${esc(n.title)}</h3>
    ${safeUrl(n.url) ? `<a class="small" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer" style="word-break:break-all">${esc(n.url)}</a>` : ''}
    ${n.body ? `<div class="body">${esc(n.body)}</div>` : ''}
    <div class="toolbar"><button class="btn btn-sm" data-pin="${n.id}">${n.pinned ? '고정 해제' : '고정'}</button><button class="btn btn-sm" data-edit="${n.id}">수정</button><button class="btn btn-sm btn-danger" data-del="${n.id}">삭제</button></div>
  </article>`).join('')}</div>` : `<div class="card"><div class="empty">${items.length ? '검색 결과가 없습니다.' : '보관한 참고자료가 없습니다.<br>리포트 링크, 기사, 투자 아이디어를 모아두세요.'}</div></div>`}`;

  const qi = root.querySelector('#nt-q');
  qi.oninput = () => { q = qi.value; render(root); const el = root.querySelector('#nt-q'); el.focus(); el.setSelectionRange(q.length, q.length); };
  root.querySelectorAll('[data-tag]').forEach((c) => { c.onclick = () => { tag = c.dataset.tag; render(root); }; });
  root.querySelector('#nt-add').onclick = () => noteModal(null, root);
  root.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => noteModal(items.find((n) => n.id === b.dataset.edit), root); });
  root.querySelectorAll('[data-pin]').forEach((b) => {
    b.onclick = () => { update('notes', (s) => { s.items = s.items.map((n) => (n.id === b.dataset.pin ? { ...n, pinned: !n.pinned } : n)); }, '고정 변경'); render(root); };
  });
  root.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmModal('이 자료를 삭제할까요?'))) return;
      update('notes', (s) => { s.items = s.items.filter((n) => n.id !== b.dataset.del); }, '참고자료 삭제');
      render(root);
    };
  });
}

function noteModal(n, root) {
  const isEdit = !!n;
  openModal({
    title: isEdit ? '자료 수정' : '자료 추가',
    body: `<div class="form-grid">
      <label class="field full">제목<input name="title" value="${esc(n?.title || '')}" required></label>
      <label class="field full">링크 (선택)<input name="url" type="url" value="${esc(n?.url || '')}" placeholder="https://"></label>
      <label class="field">태그 (쉼표 구분)<input name="tags" value="${esc((n?.tags || []).join(', '))}" placeholder="예: 반도체, 리포트"></label>
      <label class="field">날짜<input name="date" type="date" value="${esc(n?.date || today())}"></label>
      <label class="field full">내용<textarea name="body" rows="7">${esc(n?.body || '')}</textarea></label>
    </div>`,
    onSubmit(d) {
      if (!d.title.trim()) throw new Error('제목을 입력하세요.');
      if (d.url && !safeUrl(d.url.trim())) throw new Error('링크는 http:// 또는 https:// 로 시작해야 합니다.');
      const rec = { id: n?.id || uid(), title: d.title.trim(), url: d.url.trim(), tags: [...new Set(d.tags.split(',').map((t) => t.trim()).filter(Boolean))], date: d.date || today(), body: d.body, pinned: !!n?.pinned };
      update('notes', (s) => { s.items = isEdit ? s.items.map((x) => (x.id === rec.id ? rec : x)) : [...s.items, rec]; }, isEdit ? '참고자료 수정' : '참고자료 추가');
      render(root);
    },
  });
}
