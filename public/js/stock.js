// 종목 상세: 가격 차트 · 밸류에이션 · 재무 · 컨센서스 · 실적 · 내부자 거래 · 회사 소개 · 메모 · 가격 알림
import { state, update, updateQuiet, market, esc, fmtNum, fmtPct, fmtCap, cls, watchAll, toggleWatch, toggleBell, openModal, toast } from './core.js';
import { renderLine } from './charts.js';

const RANGES = [['1mo', '1개월'], ['3mo', '3개월'], ['6mo', '6개월'], ['1y', '1년'], ['5y', '5년']];
let range = '6mo';

const pct = (v, d = 1) => (v == null ? '—' : fmtPct(v * 100, d, false));
const times = (v) => (v == null ? '—' : `${v.toFixed(1)}배`);
const REC = { strong_buy: '강력 매수', buy: '매수', hold: '보유', underperform: '비중 축소', sell: '매도', none: '—' };

function money(v, cur) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (cur === 'KRW') return fmtNum(v) + '원';
  if (cur === 'USD') return '$' + fmtNum(v, 2);
  return fmtNum(v, 2) + (cur ? ' ' + cur : '');
}
function bigMoney(v, cur) {
  if (v == null) return '—';
  if (v === 0) return cur === 'KRW' ? '0원' : '$0';
  if (cur === 'KRW') {
    const a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(1) + '조원';
    if (a >= 1e8) return (v / 1e8).toFixed(0) + '억원';
    return fmtNum(v) + '원';
  }
  return (v < 0 ? '-$' : '$') + fmtCap(Math.abs(v));
}

export function alertHit(sym, price) {
  const a = state.watch.alerts?.[sym];
  if (!a || price == null) return null;
  if (a.above != null && price >= a.above) return `${a.above} 이상 도달`;
  if (a.below != null && price <= a.below) return `${a.below} 이하 도달`;
  return null;
}

export async function renderStock(el, sym, { onChange } = {}) {
  el.innerHTML = `<div class="empty">${esc(sym)} 정보를 불러오는 중…</div>`;
  let q = null, p = null;
  try {
    [q, p] = await Promise.all([
      market.quotes([sym]).then((r) => r[sym]),
      market.profile(sym).catch(() => null),
    ]);
  } catch { /* 아래에서 처리 */ }
  if (!el.isConnected) return;
  if (!q && !p) { el.innerHTML = `<div class="empty">${esc(sym)} 시세를 찾지 못했습니다. 티커를 확인하세요.</div>`; return; }
  const cur = q?.cur || p?.cur || 'USD';
  const price = q?.p ?? p?.price;
  const name = p?.name || q?.name || market.lookup(sym)?.n || sym;
  const watched = watchAll().includes(sym);
  const belled = (state.watch.bells || []).includes(sym);
  const al = state.watch.alerts?.[sym];
  const hit = alertHit(sym, price);
  const memo = state.watch.memos?.[sym] || '';
  const upside = p?.tgt && price ? (p.tgt / price - 1) * 100 : null;
  const rt = p?.recTrend;
  const recTotal = rt ? rt.strongBuy + rt.buy + rt.hold + rt.sell + rt.strongSell : 0;
  const ins = p?.ins6m;

  el.innerHTML = `
  <div class="card-head" style="margin-bottom:6px">
    <div style="margin-right:auto">
      <div style="font-size:20px;font-weight:800">${esc(sym)} <span class="muted" style="font-size:14px;font-weight:600">${esc(name)}</span></div>
      <div style="font-size:24px;font-weight:800;margin-top:2px">${money(price, cur)} <span class="${cls(q?.chg)}" style="font-size:15px">${fmtPct(q?.chg)}</span></div>
      <div class="small muted">${esc([p?.sector, p?.industry, q?.ex].filter(Boolean).join(' · '))}${q?.at ? ' · ' + new Date(q.at).toLocaleString('ko-KR') + ' 기준' : ''}</div>
    </div>
    <button class="btn ${watched ? 'active' : ''}" data-act="watch">${watched ? '★ 관심종목' : '☆ 관심 추가'}</button>
    <button class="btn ${belled ? 'active' : ''}" data-act="bell" title="벨을 켜면 다음 실적 발표일이 실적발표 캘린더에 표시됩니다">${belled ? '🔔 실적 벨 켜짐' : '🔕 실적 벨'}</button>
    <button class="btn ${al ? 'active' : ''}" data-act="alert">🔔 ${al ? '알림 ' + [al.above != null ? '↑' + al.above : '', al.below != null ? '↓' + al.below : ''].filter(Boolean).join(' ') : '가격 알림'}</button>
  </div>
  ${hit ? `<div class="tag" style="background:var(--primary-weak);color:var(--primary);margin-bottom:8px">🔔 알림 조건 ${esc(hit)}</div>` : ''}
  <div class="toolbar" style="margin-bottom:6px"><div class="seg" data-ranges>${RANGES.map(([v, l]) => `<button data-r="${v}" class="${range === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
  <div data-chart><div class="empty">차트 불러오는 중…</div></div>
  ${p?.lo52 != null && p?.hi52 != null && price ? `<div class="small muted" style="margin-top:8px">52주 범위 ${money(p.lo52, cur)} ~ ${money(p.hi52, cur)}</div>
    <div class="range"><span style="left:calc(${Math.max(0, Math.min(100, ((price - p.lo52) / (p.hi52 - p.lo52 || 1)) * 100))}% - 2px)"></span></div>` : ''}

  ${p ? `
  <h3 style="margin:16px 0 8px">밸류에이션</h3>
  <div class="kv">
    <div><div class="k">시가총액</div><div class="v">${bigMoney(p.mc, cur)}</div></div>
    <div><div class="k">PER (TTM)</div><div class="v">${times(p.pe)}</div></div>
    <div><div class="k">선행 PER</div><div class="v">${times(p.fpe)}</div></div>
    <div><div class="k">PBR</div><div class="v">${times(p.pb)}</div></div>
    <div><div class="k">PSR</div><div class="v">${times(p.ps)}</div></div>
    <div><div class="k">EV/EBITDA</div><div class="v">${times(p.evEbitda)}</div></div>
    <div><div class="k">PEG</div><div class="v">${p.peg == null ? '—' : p.peg.toFixed(2)}</div></div>
    <div><div class="k">배당수익률</div><div class="v">${pct(p.div, 2)}</div></div>
    <div><div class="k">베타</div><div class="v">${p.beta == null ? '—' : p.beta.toFixed(2)}</div></div>
    <div><div class="k">다음 실적 발표</div><div class="v">${esc(p.nextEarn || '—')}</div></div>
  </div>

  <h3 style="margin:16px 0 8px">재무</h3>
  <div class="kv">
    <div><div class="k">매출 (TTM)</div><div class="v">${bigMoney(p.rev, cur)}</div></div>
    <div><div class="k">매출 성장 (YoY)</div><div class="v ${cls(p.revG)}">${pct(p.revG)}</div></div>
    <div><div class="k">이익 성장 (YoY)</div><div class="v ${cls(p.earnG)}">${pct(p.earnG)}</div></div>
    <div><div class="k">매출총이익률</div><div class="v">${pct(p.gm)}</div></div>
    <div><div class="k">영업이익률</div><div class="v">${pct(p.om)}</div></div>
    <div><div class="k">순이익률</div><div class="v">${pct(p.nm)}</div></div>
    <div><div class="k">ROE</div><div class="v">${pct(p.roe)}</div></div>
    <div><div class="k">부채비율 (D/E)</div><div class="v">${p.de == null ? '—' : p.de.toFixed(0) + '%'}</div></div>
    <div><div class="k">잉여현금흐름</div><div class="v">${bigMoney(p.fcf, cur)}</div></div>
    <div><div class="k">현금 / 총부채</div><div class="v">${bigMoney(p.cash, cur)} / ${bigMoney(p.debt, cur)}</div></div>
  </div>
  ${p.quarterly?.length ? `<div class="grid-2" style="margin-top:10px">${['rev', 'earn'].map((k) => {
    const vals = p.quarterly.map((x) => x[k]);
    const mx = Math.max(...vals.map((v) => Math.abs(v || 0))) || 1;
    return `<div class="card" style="padding:12px"><div class="small muted">분기 ${k === 'rev' ? '매출' : '순이익'}</div><div class="mini-bars">${p.quarterly.map((x) => `<div title="${esc(x.p)} ${bigMoney(x[k], cur)}"><span>${bigMoney(x[k], cur)}</span><div class="b ${x[k] < 0 ? 'neg' : ''}" style="height:${Math.max(2, (Math.abs(x[k] || 0) / mx) * 70)}px"></div>${esc(x.p)}</div>`).join('')}</div></div>`;
  }).join('')}</div>` : ''}

  <div data-ebars>
    <div class="card-head" style="margin:16px 0 8px"><h3 style="margin-right:auto">컨센서스 및 실적 현황</h3>
      <div class="seg"><button type="button" data-per="q" class="on">분기</button><button type="button" data-per="y">연간</button></div>
      <div class="seg"><button type="button" data-fld="eps" class="on">EPS</button><button type="button" data-fld="rev">매출액</button></div></div>
    <div data-echart></div>
  </div>

  <h3 style="margin:16px 0 8px">컨센서스</h3>
  <div class="kv">
    <div><div class="k">목표주가 평균</div><div class="v">${money(p.tgt, cur)} <span class="${cls(upside)}" style="font-size:12px">${fmtPct(upside, 1)}</span></div></div>
    <div><div class="k">목표주가 범위</div><div class="v">${money(p.tgtLo, cur)} ~ ${money(p.tgtHi, cur)}</div></div>
    <div><div class="k">투자의견</div><div class="v">${REC[p.recKey] || p.recKey || '—'} ${p.rec ? `<span class="small muted">(${p.rec.toFixed(2)})</span>` : ''}</div></div>
    <div><div class="k">애널리스트 수</div><div class="v">${p.nAnalyst ?? '—'}명</div></div>
    <div><div class="k">다음 분기 EPS 예상</div><div class="v">${p.epsEst == null ? '—' : p.epsEst.toFixed(2)}</div></div>
  </div>
  ${recTotal ? `<div style="margin-top:10px"><div class="rec-bar">
      <span style="width:${(rt.strongBuy / recTotal) * 100}%;background:#1f9d63"></span><span style="width:${(rt.buy / recTotal) * 100}%;background:#6cc59a"></span>
      <span style="width:${(rt.hold / recTotal) * 100}%;background:#c9ccd4"></span><span style="width:${(rt.sell / recTotal) * 100}%;background:#f0883e"></span><span style="width:${(rt.strongSell / recTotal) * 100}%;background:#e0383e"></span></div>
      <div class="small muted" style="margin-top:4px">강력매수 ${rt.strongBuy} · 매수 ${rt.buy} · 보유 ${rt.hold} · 매도 ${rt.sell} · 강력매도 ${rt.strongSell}</div></div>` : ''}
  ${p.epsHist?.length ? `<div class="table-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>분기</th><th class="num">EPS 예상</th><th class="num">EPS 실제</th><th class="num">서프라이즈</th></tr></thead><tbody>
    ${p.epsHist.map((e) => `<tr><td>${esc(e.q || '')}</td><td class="num">${e.est?.toFixed(2) ?? '—'}</td><td class="num">${e.act?.toFixed(2) ?? '—'}</td><td class="num ${cls(e.surprise)}">${e.surprise == null ? '—' : fmtPct(e.surprise * 100, 1)}</td></tr>`).join('')}</tbody></table></div>` : ''}

  <h3 style="margin:16px 0 8px">내부자 거래</h3>
  <div class="small" style="margin-bottom:8px">최근 6개월: <span class="up">매수 ${ins?.buyN ?? 0}건 (${bigMoney(ins?.buyV || 0, cur)})</span> · <span class="down">매도 ${ins?.sellN ?? 0}건 (${bigMoney(ins?.sellV || 0, cur)})</span> · 내부자 지분 ${pct(p.insiderPct)} · 기관 지분 ${pct(p.instPct)}</div>
  ${p.insiders?.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>날짜</th><th>이름</th><th>직위</th><th>내용</th><th class="num">주식수</th><th class="num">금액</th></tr></thead><tbody>
    ${p.insiders.map((t) => `<tr><td>${esc(t.date || '')}</td><td>${esc(t.name)}</td><td class="sub">${esc(t.rel)}</td><td class="sub">${esc(t.text || '—')}</td><td class="num">${fmtNum(t.shares)}</td><td class="num">${t.value ? bigMoney(t.value, cur) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted small">공개된 내부자 거래가 없습니다.</div>'}

  ${p.summary ? `<h3 style="margin:16px 0 8px">회사 소개</h3>
    <div class="small muted">${esc([p.country, p.employees ? fmtNum(p.employees) + '명' : '', ''].filter(Boolean).join(' · '))} ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener noreferrer">${esc(p.website)}</a>` : ''}</div>
    <p style="font-size:13px;line-height:1.6;margin:6px 0 0">${esc(p.summary)}</p>` : ''}` : '<p class="muted small" style="margin-top:12px">이 종목은 재무·컨센서스 자료가 제공되지 않습니다.</p>'}

  <h3 style="margin:16px 0 8px">내 메모</h3>
  <textarea data-memo rows="3" style="width:100%" placeholder="매수 이유, 체크 포인트 등을 적어두세요">${esc(memo)}</textarea>
  <p class="small muted">자료: 시세 Yahoo Finance · 재무·컨센서스 ${p?.source === 'nasdaq' ? 'Nasdaq (PER·PSR 등은 최근 4분기 재무제표로 계산)' : 'Yahoo Finance'} · 지연 시세</p>`;

  const draw = async () => {
    const box = el.querySelector('[data-chart]');
    const h = (await market.history([sym], range))[sym];
    if (!box.isConnected) return;
    if (!h?.c.length) { box.innerHTML = '<div class="empty">차트 자료가 없습니다.</div>'; return; }
    const up = h.c[h.c.length - 1] >= h.c[0];
    renderLine(box, [{ name: sym, color: up ? 'var(--up)' : 'var(--down)', t: h.t, v: h.c }], { h: 240, fmt: (v) => money(v, cur) });
  };
  el.querySelectorAll('[data-r]').forEach((b) => {
    b.onclick = () => { range = b.dataset.r; el.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  });
  draw();
  el.querySelector('[data-act=watch]').onclick = () => { toggleWatch(sym); onChange?.(); renderStock(el, sym, { onChange }); };
  el.querySelector('[data-act=bell]').onclick = () => { toggleBell(sym); onChange?.(); renderStock(el, sym, { onChange }); };
  const ebox = el.querySelector('[data-ebars]');
  if (ebox) {
    let per = 'q', fld = 'eps';
    const drawE = () => { ebox.querySelector('[data-echart]').innerHTML = earningsBars(p, per, fld, cur); };
    ebox.querySelectorAll('[data-per]').forEach((b) => { b.onclick = () => { per = b.dataset.per; ebox.querySelectorAll('[data-per]').forEach((x) => x.classList.toggle('on', x === b)); drawE(); }; });
    ebox.querySelectorAll('[data-fld]').forEach((b) => { b.onclick = () => { fld = b.dataset.fld; ebox.querySelectorAll('[data-fld]').forEach((x) => x.classList.toggle('on', x === b)); drawE(); }; });
    drawE();
  }
  el.querySelector('[data-act=alert]').onclick = () => alertModal(sym, price, cur, () => { onChange?.(); renderStock(el, sym, { onChange }); });
  const memoEl = el.querySelector('[data-memo]');
  let t;
  memoEl.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => updateQuiet('watch', (w) => { w.memos = { ...(w.memos || {}), [sym]: memoEl.value }; if (!memoEl.value) delete w.memos[sym]; }), 600);
  };
}

function alertModal(sym, price, cur, done) {
  const a = state.watch.alerts?.[sym] || {};
  openModal({
    title: `${sym} 가격 알림`,
    body: `<p class="small muted">현재가 ${money(price, cur)}. 조건에 도달하면 관심종목 목록과 “주요 변화”에 🔔로 표시됩니다.</p>
      <div class="form-grid">
        <label class="field">이 가격 이상이면<input type="number" step="any" name="above" value="${a.above ?? ''}" placeholder="예: ${price ? +(price * 1.1).toFixed(2) : ''}"></label>
        <label class="field">이 가격 이하이면<input type="number" step="any" name="below" value="${a.below ?? ''}" placeholder="예: ${price ? +(price * 0.9).toFixed(2) : ''}"></label>
      </div>`,
    extraButtons: state.watch.alerts?.[sym] ? '<button type="button" class="btn btn-danger" data-clear>알림 삭제</button>' : '',
    onOpen(form, close) {
      form.querySelector('[data-clear]')?.addEventListener('click', () => {
        update('watch', (w) => { delete w.alerts[sym]; }, '가격 알림 삭제');
        close(); done();
      });
    },
    onSubmit(d) {
      const above = d.above === '' ? null : +d.above, below = d.below === '' ? null : +d.below;
      if (above == null && below == null) throw new Error('가격을 하나 이상 입력하세요.');
      update('watch', (w) => { w.alerts = { ...(w.alerts || {}), [sym]: { above, below } }; }, '가격 알림 설정');
      toast('가격 알림을 저장했습니다.');
      done();
    },
  });
}

// ---------- 컨센서스 대비 실적 차트 ----------
// period: 'q' | 'y', field: 'rev' | 'eps'
export function earningsBars(p, period, field, cur = 'USD') {
  if (!p) return '<div class="empty">실적 자료가 없습니다.</div>';
  const est = p.est || {};
  const fyl = (end) => (end ? `FY${end.slice(0, 4)}` : '');
  let items = [];
  if (period === 'q' && field === 'eps') {
    items = (p.qeps || []).map((x) => ({ label: x.p, act: x.act, est: x.est }));
    if (est.q0?.eps != null) items.push({ label: `${(est.q0.end || '').slice(2, 7)} 예상`, est: est.q0.eps, future: true });
    if (est.q1?.eps != null) items.push({ label: `${(est.q1.end || '').slice(2, 7)} 예상`, est: est.q1.eps, future: true });
  } else if (period === 'q') {
    items = (p.quarterly || []).map((x) => ({ label: x.p, act: x.rev }));
    if (est.q0?.rev != null) items.push({ label: `${(est.q0.end || '').slice(2, 7)} 예상`, est: est.q0.rev, future: true });
    if (est.q1?.rev != null) items.push({ label: `${(est.q1.end || '').slice(2, 7)} 예상`, est: est.q1.rev, future: true });
  } else if (field === 'rev') {
    items = (p.yearly || []).map((x) => ({ label: `FY${x.p}`, act: x.rev }));
    const have = new Set(items.map((x) => x.label));
    if (est.y0?.rev != null && !have.has(fyl(est.y0.end))) items.push({ label: `${fyl(est.y0.end)} 예상`, est: est.y0.rev, future: true });
    if (est.y1?.rev != null) items.push({ label: `${fyl(est.y1.end)} 예상`, est: est.y1.rev, future: true });
  } else {
    if (est.y0?.epsYA != null) items.push({ label: `FY${+fyl(est.y0.end).slice(2) - 1}`, act: est.y0.epsYA });
    if (est.y0?.eps != null) items.push({ label: `${fyl(est.y0.end)} 예상`, est: est.y0.eps, future: true });
    if (est.y1?.eps != null) items.push({ label: `${fyl(est.y1.end)} 예상`, est: est.y1.eps, future: true });
  }
  items = items.filter((x) => x.act != null || x.est != null);
  if (!items.length) return '<div class="empty">이 종목은 실적·컨센서스 자료가 없습니다.</div>';
  const fmt = (v) => (field === 'eps' ? v.toFixed(2) : bigMoney(v, cur));
  const vals = items.flatMap((x) => [x.act, x.est]).filter((v) => v != null);
  const max = Math.max(...vals.map(Math.abs), 1e-9);
  const W = 680, H = 230, B = 40, T = 22, bw = Math.min(70, (W - 20) / items.length - 14);
  const step = (W - 20) / items.length;
  const y = (v) => T + (1 - Math.max(0, v) / max) * (H - T - B);
  let g = `<line x1="10" x2="${W - 10}" y1="${H - B}" y2="${H - B}" stroke="var(--border)"/>`;
  items.forEach((x, i) => {
    const cx = 10 + step * i + step / 2;
    if (x.act != null) {
      g += `<rect x="${cx - bw / 2}" y="${y(x.act)}" width="${bw}" height="${H - B - y(x.act)}" rx="4" fill="var(--primary)"><title>${esc(x.label)} 실제 ${fmt(x.act)}</title></rect>`;
      g += `<text x="${cx}" y="${y(x.act) - 5}" text-anchor="middle" style="fill:var(--text);font-weight:600">${esc(fmt(x.act))}</text>`;
    }
    if (x.est != null && x.future) {
      g += `<rect x="${cx - bw / 2}" y="${y(x.est)}" width="${bw}" height="${H - B - y(x.est)}" rx="4" fill="var(--primary)" opacity=".25" stroke="var(--primary)" stroke-dasharray="4 3"><title>${esc(x.label)} 컨센서스 ${fmt(x.est)}</title></rect>`;
      g += `<text x="${cx}" y="${y(x.est) - 5}" text-anchor="middle">${esc(fmt(x.est))}</text>`;
    } else if (x.est != null) {
      const beat = x.act != null ? x.act >= x.est : null;
      g += `<line x1="${cx - bw / 2 - 4}" x2="${cx + bw / 2 + 4}" y1="${y(x.est)}" y2="${y(x.est)}" stroke="${beat === false ? 'var(--down)' : 'var(--warn)'}" stroke-width="2.5"><title>컨센서스 ${fmt(x.est)}</title></line>`;
      if (x.act != null && x.est) g += `<text x="${cx}" y="${H - B + 30}" text-anchor="middle" class="${beat ? 'up' : 'down'}" style="fill:${beat ? 'var(--up)' : 'var(--down)'}">${beat ? '상회' : '하회'} ${(((x.act - x.est) / Math.abs(x.est)) * 100).toFixed(1)}%</text>`;
    }
    g += `<text x="${cx}" y="${H - B + 16}" text-anchor="middle">${esc(x.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;font-size:11px;fill:var(--muted)">${g}</svg>
    <div class="small muted">■ 실제 실적 &nbsp; ▨ 컨센서스(예상) &nbsp; ━ 발표 직전 컨센서스${field === 'rev' && period === 'q' ? ' · 지난 분기 매출 컨센서스는 제공되지 않습니다' : ''}</div>`;
}

// 다른 화면에서 종목 상세를 팝업으로 열기
export function openStockModal(sym) {
  const { form } = openModal({ title: '종목 상세', body: '<div data-stock></div>', wide: true });
  renderStock(form.querySelector('[data-stock]'), sym);
}
