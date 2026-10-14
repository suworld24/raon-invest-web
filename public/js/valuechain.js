// 산업 밸류체인 지도: 단계(열) · 공정 상자(기업·티커·역할) · 화살표 · 세부 지도 · 확대/축소 · 검색 · 편집
import { esc, uid, openModal, toast } from './core.js';
import { openStockModal } from './stock.js';

// ---------- 예시 지도 (처음 시작용) ----------
export const EXAMPLE = `제목: AI 데이터센터 반도체 전체 흐름
설명: 설계부터 제조·패키징, 서버·네트워크, 전력, 최종 수요처까지 AI 인프라 공급망을 연결한 예시 지도입니다.
단계: 설계·IP | 제조·장비 | 메모리·패키징 | 시스템·네트워크 | 전력·냉각 | 수요처

[EDA·설계 IP] @1 설계 소프트웨어 · 코어 IP
- Synopsys | SNPS | EDA 소프트웨어
- Cadence | CDNS | EDA 소프트웨어
- Arm | ARM | CPU 코어 IP

[AI 가속기 설계] @1 GPU · 맞춤형 ASIC
- NVIDIA | NVDA | GPU
- AMD | AMD | GPU
- Broadcom | AVGO | 맞춤형 ASIC
- Marvell | MRVL | 맞춤형 ASIC

[반도체 장비] @2 노광 · 증착 · 식각 · 검사
- ASML | ASML | EUV 노광
- Applied Materials | AMAT | 증착
- Lam Research | LRCX | 식각
- KLA | KLAC | 검사
- Tokyo Electron | | 증착·식각

[파운드리] @2 위탁 생산
- TSMC | TSM | 첨단 공정
- Samsung Electronics | 005930.KS | 파운드리
- Intel | INTC | 파운드리

[HBM 메모리] @3 고대역폭 메모리
- SK hynix | 000660.KS | HBM
- Micron | MU | HBM
- Samsung Electronics | 005930.KS | HBM

[첨단 패키징] @3 CoWoS · 2.5D
- TSMC | TSM | CoWoS
- Amkor | AMKR | OSAT
- ASE | ASX | OSAT

[AI 서버] @4 서버 · 랙 조립
- Super Micro | SMCI | 서버
- Dell | DELL | 서버
- Hewlett Packard Enterprise | HPE | 서버
- Foxconn | | ODM

[네트워크·광연결] @4 스위치 · 광트랜시버
- Arista Networks | ANET | 스위치
- Coherent | COHR | 광트랜시버
- Credo | CRDO | 연결 IC

[전력·냉각] @5 전원 · 액체 냉각
- Vertiv | VRT | 전원·냉각
- Eaton | ETN | 전력 기기
- GE Vernova | GEV | 발전·송전
- Schneider Electric | | 전력 관리

[클라우드·AI 서비스] @6 최종 인프라 수요
- Microsoft | MSFT | 클라우드
- Amazon | AMZN | 클라우드
- Alphabet | GOOGL | 클라우드
- Meta | META | AI 서비스
- Oracle | ORCL | 클라우드

화살표: EDA·설계 IP -> AI 가속기 설계
화살표: AI 가속기 설계 -> 파운드리
화살표: 반도체 장비 -> 파운드리
화살표: 파운드리 -> 첨단 패키징
화살표: HBM 메모리 -> 첨단 패키징
화살표: 첨단 패키징 -> AI 서버
화살표: AI 서버 -> 클라우드·AI 서비스
화살표: 네트워크·광연결 -> 클라우드·AI 서비스
화살표: 전력·냉각 -> 클라우드·AI 서비스`;

// ---------- 글 형식 ↔ 지도 ----------
export function parseMap(text, name = '전체 흐름') {
  const map = { id: uid(), name, title: '', desc: '', stages: [], nodes: [], links: [] };
  let node = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^제목\s*:\s*(.*)$/))) map.title = m[1].trim();
    else if ((m = line.match(/^설명\s*:\s*(.*)$/))) map.desc = m[1].trim();
    else if ((m = line.match(/^단계\s*:\s*(.*)$/))) map.stages = m[1].split('|').map((s) => s.trim()).filter(Boolean);
    else if ((m = line.match(/^화살표\s*:\s*(.+?)\s*->\s*(.+)$/))) map.links.push([m[1].trim(), m[2].trim()]);
    else if ((m = line.match(/^\[(.+?)\]\s*(?:@(\d+))?\s*(.*)$/))) {
      node = { id: m[1].trim(), title: m[1].trim(), stage: Math.max(1, +(m[2] || 1)), sub: m[3].trim(), companies: [] };
      map.nodes.push(node);
    } else if ((m = line.match(/^[-•]\s*(.+)$/)) && node) {
      const [n, t, r] = m[1].split('|').map((s) => s.trim());
      node.companies.push({ n, t: (t || '').toUpperCase(), r: r || '' });
    }
  }
  if (!map.stages.length) map.stages = Array.from({ length: Math.max(1, ...map.nodes.map((x) => x.stage)) }, (_, i) => `${i + 1}단계`);
  const ids = new Set(map.nodes.map((x) => x.id));
  map.links = map.links.filter(([a, b]) => ids.has(a) && ids.has(b));
  return map;
}

export function serializeMap(map) {
  const out = [];
  out.push(`제목: ${map.title || ''}`);
  if (map.desc) out.push(`설명: ${map.desc}`);
  out.push(`단계: ${map.stages.join(' | ')}`, '');
  for (const nd of map.nodes) {
    out.push(`[${nd.title}] @${nd.stage}${nd.sub ? ' ' + nd.sub : ''}`);
    for (const c of nd.companies) out.push(`- ${c.n}${c.t || c.r ? ` | ${c.t || ''}` : ''}${c.r ? ` | ${c.r}` : ''}`);
    out.push('');
  }
  for (const [a, b] of map.links) out.push(`화살표: ${a} -> ${b}`);
  return out.join('\n');
}

const usListed = (t) => !!t && !/\.(KS|KQ|T|HK|L|TO|SS|SZ)$/i.test(t);

// ---------- 지도 그리기 ----------
// maps: 산업의 지도 목록 (첫 번째가 전체 흐름) · onSave(maps) 로 저장
export function renderValueChain(el, maps, { onSave } = {}) {
  let cur = 0, zoom = 1, usOnly = false, q = '', linkMode = false, linkFrom = null;
  if (!maps.length) {
    el.innerHTML = `<div class="empty">아직 밸류체인 지도가 없습니다.<br>
      <button class="btn btn-primary" data-new style="margin-top:10px">예시로 시작하기</button> <button class="btn" data-blank style="margin-top:10px">빈 지도 만들기</button></div>`;
    el.querySelector('[data-new]').onclick = () => onSave([parseMap(EXAMPLE)]);
    el.querySelector('[data-blank]').onclick = () => editModal(parseMap('제목: 새 산업 지도\n단계: 1단계 | 2단계 | 3단계'), (m) => onSave([m]));
    return;
  }
  const draw = () => {
    const map = maps[cur];
    const allCos = map.nodes.flatMap((n) => n.companies);
    const nUS = allCos.filter((c) => usListed(c.t)).length, nOther = allCos.length - nUS;
    const subNames = new Set(maps.map((m) => m.name));
    el.innerHTML = `
      <div class="card-head" style="margin-bottom:6px"><div style="margin-right:auto"><h2>${esc(map.title || map.name)}</h2>${map.desc ? `<div class="small muted">${esc(map.desc)}</div>` : ''}</div>
        <button class="btn btn-sm" data-edit>내용 편집</button>
        <button class="btn btn-sm ${linkMode ? 'active' : ''}" data-links>${linkMode ? '화살표 편집 끝내기' : '화살표 편집'}</button>
        <button class="btn btn-sm" data-addmap>+ 세부 지도</button></div>
      <div class="toolbar" style="margin-bottom:8px">
        <span class="tag">${nUS} 미국 상장</span><span class="tag">${nOther} 그 외 기업</span>
        <div class="seg" style="flex-wrap:wrap">${maps.map((m, i) => `<button data-map="${i}" class="${i === cur ? 'on' : ''}">${esc(m.name)}</button>`).join('')}</div>
        <span style="flex:1"></span>
        <label class="chip ${usOnly ? 'on' : ''}"><input type="checkbox" data-us ${usOnly ? 'checked' : ''}> 미국 상장만</label>
        <input type="search" data-q placeholder="기업명 · 티커 찾기" value="${esc(q)}" style="width:170px">
        <button class="btn btn-sm" data-fit>화면 맞춤</button><button class="btn btn-sm icon-btn" data-zo>−</button><span class="small" data-zl>${Math.round(zoom * 100)}%</span><button class="btn btn-sm icon-btn" data-zi>＋</button>
      </div>
      ${linkMode ? `<div class="tag" style="background:var(--primary-weak);color:var(--primary);margin-bottom:8px">${linkFrom ? `'${esc(linkFrom)}'에서 이어질 상자를 누르세요 (같은 연결을 다시 누르면 지워집니다)` : '화살표를 시작할 상자를 누르세요'}</div>` : ''}
      <div class="vc-wrap"><div class="vc-sizer"><div class="vc" style="transform:scale(${zoom});grid-template-columns:repeat(${map.stages.length}, minmax(170px, 1fr))">
        ${map.stages.map((s, i) => `<div class="vc-col"><div class="vc-stage"><b>${String(i + 1).padStart(2, '0')}</b> ${esc(s)}</div>
          ${map.nodes.filter((n) => n.stage === i + 1).map((n) => {
            const cos = n.companies.filter((c) => !usOnly || usListed(c.t));
            const hit = q && (n.title.toLowerCase().includes(q.toLowerCase()) || n.companies.some((c) => `${c.n} ${c.t}`.toLowerCase().includes(q.toLowerCase())));
            return `<div class="vc-node ${q && !hit ? 'dim' : ''} ${linkFrom === n.id ? 'sel' : ''}" data-node="${esc(n.id)}">
              <h4>${subNames.has(n.title) && maps[cur].name !== n.title ? `<a href="#" data-goto="${esc(n.title)}">${esc(n.title)} ↗</a>` : esc(n.title)}</h4>
              ${n.sub ? `<div class="sub">${esc(n.sub)}</div>` : ''}
              ${cos.map((c) => `<div class="vc-co ${q && `${c.n} ${c.t}`.toLowerCase().includes(q.toLowerCase()) ? 'hit' : ''}">${c.t ? `<a href="#" data-t="${esc(c.t)}" title="${esc(c.r || '')}">${esc(c.n)} <b>${esc(c.t)}</b> ↗</a>` : `<span class="muted" title="${esc(c.r || '')}">${esc(c.n)}</span>`}</div>`).join('') || '<div class="sub">—</div>'}
            </div>`;
          }).join('')}</div>`).join('')}
        <svg class="vc-svg"></svg>
      </div></div></div>
      <details class="small muted" style="margin-top:8px"><summary>지도 읽는 방법</summary><p>왼쪽에서 오른쪽으로 공급망 단계가 이어집니다. 화살표는 공정 간 주요 연결입니다. 티커가 있는 기업을 누르면 종목 상세가 열리고, 이름 옆 ↗가 있는 공정을 누르면 같은 이름의 세부 지도로 이동합니다. '내용 편집'에서 단계·공정·기업을 글로 고칠 수 있고, '화살표 편집'에서는 상자 두 개를 차례로 눌러 연결을 추가·삭제합니다.</p></details>
      <details class="small" style="margin-top:8px"><summary><b>공정별 기업·역할 전체 목록</b></summary>
        <div class="table-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>단계</th><th>공정</th><th>기업</th><th>티커</th><th>역할 · 제품</th></tr></thead><tbody>
        ${map.nodes.flatMap((n) => n.companies.filter((c) => !usOnly || usListed(c.t)).map((c) => `<tr><td>${esc(map.stages[n.stage - 1] || '')}</td><td>${esc(n.title)}</td><td>${esc(c.n)}</td><td>${c.t ? `<a href="#" data-t="${esc(c.t)}">${esc(c.t)}</a>` : '<span class="muted">비상장·해외</span>'}</td><td>${esc(c.r || n.sub || '')}</td></tr>`)).join('')}
        </tbody></table></div></details>`;
    drawLinks(map);
    el.querySelectorAll('[data-map]').forEach((b) => { b.onclick = () => { cur = +b.dataset.map; linkFrom = null; draw(); }; });
    el.querySelectorAll('[data-goto]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); cur = maps.findIndex((m) => m.name === a.dataset.goto); draw(); }; });
    el.querySelectorAll('[data-t]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (!linkMode) openStockModal(a.dataset.t); }; });
    el.querySelector('[data-us]').onchange = (e) => { usOnly = e.target.checked; draw(); };
    const qi = el.querySelector('[data-q]');
    qi.oninput = () => { q = qi.value; draw(); const n = el.querySelector('[data-q]'); n.focus(); n.setSelectionRange(q.length, q.length); };
    const setZoom = (z) => { zoom = Math.max(0.4, Math.min(1.6, z)); draw(); };
    el.querySelector('[data-zi]').onclick = () => setZoom(zoom + 0.1);
    el.querySelector('[data-zo]').onclick = () => setZoom(zoom - 0.1);
    el.querySelector('[data-fit]').onclick = () => {
      const wrap = el.querySelector('.vc-wrap'), inner = el.querySelector('.vc');
      setZoom(Math.min(1, (wrap.clientWidth - 26) / inner.scrollWidth)); // transform은 레이아웃 폭에 영향을 주지 않음
    };
    el.querySelector('[data-edit]').onclick = () => editModal(maps[cur], (m) => { maps[cur] = { ...m, id: maps[cur].id, name: maps[cur].name }; onSave(maps); }, cur > 0 ? () => { maps.splice(cur, 1); onSave(maps); } : null);
    el.querySelector('[data-links]').onclick = () => { linkMode = !linkMode; linkFrom = null; draw(); };
    el.querySelector('[data-addmap]').onclick = () => openModal({
      title: '세부 지도 추가',
      body: `<label class="field">세부 지도 이름<input name="name" required placeholder="예: 광트랜시버·광엔진"></label>
        <p class="small muted">전체 흐름에 같은 이름의 공정 상자가 있으면 그 상자에서 이 세부 지도로 바로 이동할 수 있습니다.</p>`,
      onSubmit(d) {
        const name = d.name.trim();
        if (!name) throw new Error('이름을 입력하세요.');
        maps.push(parseMap(`제목: ${name}\n단계: 1단계 | 2단계 | 3단계`, name));
        cur = maps.length - 1;
        onSave(maps);
      },
    });
    if (linkMode) {
      el.querySelectorAll('[data-node]').forEach((nd) => {
        nd.style.cursor = 'crosshair';
        nd.onclick = () => {
          const id = nd.dataset.node;
          if (!linkFrom) { linkFrom = id; draw(); return; }
          if (linkFrom !== id) {
            const i = map.links.findIndex(([a, b]) => a === linkFrom && b === id);
            if (i >= 0) map.links.splice(i, 1); else map.links.push([linkFrom, id]);
            onSave(maps, true);
          }
          linkFrom = null; draw();
        };
      });
    }
  };

  const drawLinks = (map) => {
    const inner = el.querySelector('.vc'), svg = el.querySelector('.vc-svg');
    if (!inner || !svg) return;
    requestAnimationFrame(() => {
      const box = inner.getBoundingClientRect();
      const W = inner.scrollWidth, H = inner.scrollHeight;
      svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      // 축소·확대한 크기만큼 바깥 상자 크기를 맞춰 빈 공간이 생기지 않게
      const sizer = el.querySelector('.vc-sizer');
      if (sizer) { sizer.style.width = `${W * zoom}px`; sizer.style.height = `${H * zoom}px`; }
      const pos = (id) => {
        const n = inner.querySelector(`[data-node="${CSS.escape(id)}"]`);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { l: (r.left - box.left) / zoom, r: (r.right - box.left) / zoom, t: (r.top - box.top) / zoom, b: (r.bottom - box.top) / zoom };
      };
      let g = '<defs><marker id="vc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--primary)"/></marker></defs>';
      for (const [a, b] of map.links) {
        const A = pos(a), B = pos(b);
        if (!A || !B) continue;
        let d;
        if (B.l > A.r) {
          const y1 = (A.t + A.b) / 2, y2 = (B.t + B.b) / 2, mx = (A.r + B.l) / 2;
          d = `M${A.r},${y1} C${mx},${y1} ${mx},${y2} ${B.l - 2},${y2}`;
        } else {
          const x1 = (A.l + A.r) / 2, x2 = (B.l + B.r) / 2;
          const down = B.t > A.b;
          const y1 = down ? A.b : A.t, y2 = down ? B.t - 2 : B.b + 2;
          d = `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
        }
        g += `<path d="${d}" fill="none" stroke="var(--primary)" stroke-width="1.6" opacity=".6" marker-end="url(#vc-arrow)"/>`;
      }
      svg.innerHTML = g;
    });
  };

  draw();
}

function editModal(map, onDone, onDelete) {
  openModal({
    title: '지도 내용 편집',
    wide: true,
    body: `<p class="small muted">한 줄에 하나씩 적습니다. <b>단계:</b> 열 이름을 | 로 구분 · <b>[공정 이름] @단계번호 설명</b> · 아래에 <b>- 기업 | 티커 | 역할</b> (티커·역할은 선택) · <b>화살표: 공정A -> 공정B</b></p>
      <textarea name="text" rows="22" style="width:100%;font-family:ui-monospace,Consolas,monospace;font-size:12px">${esc(serializeMap(map))}</textarea>`,
    extraButtons: onDelete ? '<button type="button" class="btn btn-danger" data-del>이 세부 지도 삭제</button>' : '',
    onOpen(form, close) { form.querySelector('[data-del]')?.addEventListener('click', () => { close(); onDelete(); }); },
    onSubmit(d) {
      const m = parseMap(d.text, map.name);
      if (!m.nodes.length && !m.stages.length) throw new Error('단계나 공정을 하나 이상 적어주세요.');
      onDone(m);
      toast('지도를 저장했습니다.');
    },
  });
}

export const mapTickers = (maps) => [...new Set((maps || []).flatMap((m) => m.nodes.flatMap((n) => n.companies.map((c) => c.t).filter(Boolean))))];
