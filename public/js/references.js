// 참고자료: 이미지·PDF 자료실(산업별 · 계정 저장) + 링크·메모 보관함
import { state, api, esc, openModal, confirmModal, toast } from './core.js';
import * as notes from './notes.js';

let tab = 'files';
let ind = '';

const industries = () => [...new Set((state.industries.list || []).map((x) => x.name))];
const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`);

export async function render(root) {
  root.innerHTML = `
  <div class="toolbar"><div class="seg"><button data-tab="files" class="${tab === 'files' ? 'on' : ''}">이미지 · PDF</button><button data-tab="notes" class="${tab === 'notes' ? 'on' : ''}">링크 · 메모</button></div>
    <span class="small muted">산업 도표와 리포트 캡처, PDF를 산업별로 보관합니다.</span></div>
  <div data-sub style="display:contents"></div>`;
  root.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(root); }; });
  const sub = root.querySelector('[data-sub]');
  if (tab === 'notes') return notes.render(sub);
  return renderFiles(sub);
}

async function renderFiles(root) {
  root.innerHTML = '<div class="card"><div class="empty">자료실을 불러오는 중…</div></div>';
  let data;
  try { data = await api('/api/files'); } catch { root.innerHTML = '<div class="card"><div class="empty">자료실을 불러오지 못했습니다.</div></div>'; return; }
  if (!root.isConnected) return;
  const inds = industries();
  const files = data.files.filter((f) => !ind || (ind === '__none' ? !f.industry : f.industry === ind));
  const pct = Math.min(100, (data.used / data.limit) * 100);
  root.innerHTML = `
  <div class="card">
    <div class="card-head"><h2>참고자료 <span class="small muted">${data.files.length}개</span></h2>
      <select data-ind><option value="">전체 산업</option>${inds.map((n) => `<option ${ind === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}<option value="__none" ${ind === '__none' ? 'selected' : ''}>미분류</option></select></div>
    <details ${data.files.length ? '' : 'open'}><summary><b>이미지·PDF 업로드</b></summary>
      <form data-up class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <label class="field">제목<input name="title" placeholder="비워 두면 파일명으로 저장"></label>
        <label class="field">산업<select name="industry"><option value="">미분류</option>${inds.map((n) => `<option ${ind === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label class="field" style="grid-column:1/-1">파일 선택<input type="file" name="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" multiple style="height:auto;padding:6px"></label>
        <div style="grid-column:1/-1" class="small muted">PNG·JPG·GIF·WebP·PDF · 계정당 첨부파일 합계 ${fmtSize(data.limit)} · 최대 ${data.maxCount}개. 내 계정에 저장되며 로그인한 기기에서 함께 볼 수 있습니다.</div>
        <div style="grid-column:1/-1" class="toolbar"><div class="bar" style="flex:1"><span style="width:${pct}%;background:${pct > 85 ? 'var(--up)' : 'var(--primary)'}"></span></div><span class="small">${fmtSize(data.used)} / ${fmtSize(data.limit)}</span><button class="btn btn-primary" type="submit">업로드</button></div>
      </form></details>
  </div>
  ${files.length ? `<div class="notes-grid">${files.map((f) => `<article class="note" data-file="${f.id}" style="cursor:pointer">
      <div style="height:150px;border-radius:8px;overflow:hidden;background:var(--panel-2);display:grid;place-items:center">
        ${f.mime === 'application/pdf' ? '<div style="font-size:40px">📄</div>' : `<img src="/api/files/${f.id}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">`}
      </div>
      <h3>${esc(f.title)}</h3>
      <div class="meta"><span class="tag">${esc(f.industry || '미분류')}</span><span>${fmtSize(f.size)}</span><span>${esc(f.created_at.slice(0, 10))}</span></div>
    </article>`).join('')}</div>` : `<div class="card"><div class="empty">${data.files.length ? '이 산업에 보관된 참고자료가 없습니다.' : '보관된 참고자료가 없습니다. 이미지나 PDF를 업로드해 주세요.'}</div></div>`}`;

  root.querySelector('[data-ind]').onchange = (e) => { ind = e.target.value; renderFiles(root); };
  root.querySelector('[data-up]').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const list = [...form.file.files];
    if (!list.length) return toast('파일을 선택하세요.');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = '업로드 중…';
    let ok = 0;
    for (const file of list) {
      try {
        if (file.size > data.limit) throw new Error(`${file.name}: 8MB를 넘습니다.`);
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
        const title = list.length === 1 && form.title.value.trim() ? form.title.value.trim() : file.name.replace(/\.[^.]+$/, '');
        await api('/api/files', { method: 'POST', body: { title, industry: form.industry.value, mime: file.type, data: b64 } });
        ok++;
      } catch (err) {
        toast(err.message.startsWith('400') ? `${file.name}: 업로드할 수 없습니다 (용량·개수·형식 확인)` : err.message);
      }
    }
    if (ok) toast(`${ok}개 파일을 올렸습니다.`);
    renderFiles(root);
  };
  root.querySelectorAll('[data-file]').forEach((card) => { card.onclick = () => viewer(data.files.find((f) => f.id === card.dataset.file), root); });
}

function viewer(f, root) {
  let big = false;
  const inds = industries();
  const { form } = openModal({
    title: f.title,
    wide: true,
    body: `<div data-view style="max-height:70vh;overflow:auto;text-align:center;background:var(--panel-2);border-radius:10px">
        ${f.mime === 'application/pdf' ? `<iframe src="/api/files/${f.id}" title="${esc(f.title)}" style="width:100%;height:68vh;border:0"></iframe>` : `<img data-img src="/api/files/${f.id}" alt="${esc(f.title)}" style="max-width:100%;cursor:zoom-in">`}
      </div>
      <p class="small muted">${f.mime === 'application/pdf' ? 'PDF가 보이지 않으면 새 창에서 열기를 눌러주세요.' : '이미지를 누르면 원래 크기로 확대합니다.'} <a href="/api/files/${f.id}" target="_blank" rel="noopener">새 창에서 열기 ↗</a></p>
      <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field">제목<input name="title" value="${esc(f.title)}"></label>
        <label class="field">산업<select name="industry"><option value="">미분류</option>${inds.map((n) => `<option ${f.industry === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      </div>`,
    submitText: '저장',
    extraButtons: '<button type="button" class="btn btn-danger" data-del>삭제</button>',
    async onSubmit(d) {
      await api(`/api/files/${f.id}`, { method: 'PATCH', body: { title: d.title.trim() || f.title, industry: d.industry } });
      renderFiles(root);
    },
    onOpen(form, close) {
      const img = form.querySelector('[data-img]');
      if (img) img.onclick = () => { big = !big; img.style.maxWidth = big ? 'none' : '100%'; img.style.cursor = big ? 'zoom-out' : 'zoom-in'; };
      form.querySelector('[data-del]').onclick = async () => {
        close();
        if (!(await confirmModal(`'${f.title}' 파일을 삭제할까요? 삭제한 파일은 되돌릴 수 없습니다.`))) return;
        await api(`/api/files/${f.id}`, { method: 'DELETE' });
        renderFiles(root);
      };
    },
  });
  return form;
}
