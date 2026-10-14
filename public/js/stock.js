// 종목 상세: 가격 차트 · 밸류에이션 · 재무 · 컨센서스 · 실적 · 내부자 거래 · 회사 소개 · 메모 · 가격 알림
import { state, update, updateQuiet, market, esc, fmtNum, fmtPct, fmtCap, cls, watchAll, toggleWatch, openModal, toast } from './core.js';
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
  <p class="small muted">자료: Yahoo Finance (지연 시세 · 재무는 최근 공시 기준)</p>`;

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

// 다른 화면에서 종목 상세를 팝업으로 열기
export function openStockModal(sym) {
  const { form } = openModal({ title: '종목 상세', body: '<div data-stock></div>', wide: true });
  renderStock(form.querySelector('[data-stock]'), sym);
}
