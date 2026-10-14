const express = require('express');
const cookieSession = require('cookie-session');
const crypto = require('crypto');
const path = require('path');
const compression = require('compression');
const store = require('./lib/store');
const market = require('./lib/market');
const sync = require('./lib/sync');
const rank = require('./lib/rank');

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const DEV_LOGIN = !IS_PROD && process.env.DEV_LOGIN === '1';
const ALLOWED = (process.env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[경고] SESSION_SECRET 이 없어 임시 키를 사용합니다. 서버가 재시작되면 다시 로그인해야 합니다.');
}

// 사용자 기록 키 (이 외의 키는 저장하지 않음)
const DOC_KEYS = new Set(['portfolio', 'watch', 'sectors', 'industries', 'notes', 'calendar', 'screener', 'ranking', 'prefs']);
const SYMBOL_RE = /^[A-Za-z0-9.\-=^]{1,20}$/;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.use(cookieSession({
  name: 'kk_sess',
  keys: [SESSION_SECRET],
  maxAge: 30 * 24 * 3600e3,
  sameSite: 'lax',
  secure: IS_PROD,
  httpOnly: true,
}));
// 첨부파일 업로드는 자체 한도(12MB)로 따로 읽음
const jsonBody = express.json({ limit: '5mb' });
app.use((req, res, next) => (req.method === 'POST' && req.path === '/api/files' ? next() : jsonBody(req, res, next)));

const publicDir = path.join(__dirname, 'public');
const page = (name) => path.join(publicDir, name);

// ---------- 화면 ----------
app.get('/', (req, res) => {
  if (!req.session?.uid) return res.redirect('/login');
  res.sendFile(page('app.html'));
});
app.get('/login', (req, res) => {
  if (req.session?.uid) return res.redirect('/');
  res.sendFile(page('login.html'));
});
app.get('/healthz', (req, res) => res.json({ ok: true, store: store.kind }));
// 화면 파일은 매번 변경 여부를 확인(ETag) — 업데이트 직후 옛 파일과 새 파일이 섞이지 않도록
app.use(express.static(publicDir, { index: false, maxAge: 0 }));

// ---------- 로그인 ----------
app.get('/auth/config', (req, res) => res.json({ google: !!(GOOGLE_ID && GOOGLE_SECRET), dev: DEV_LOGIN }));

app.get('/auth/google', (req, res) => {
  if (!GOOGLE_ID || !GOOGLE_SECRET) return res.redirect('/login?error=setup');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: GOOGLE_ID,
    redirect_uri: `${BASE_URL}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) throw new Error('state');
    req.session.oauthState = null;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_ID,
        client_secret: GOOGLE_SECRET,
        redirect_uri: `${BASE_URL}/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const token = await tokenRes.json();
    if (!token.access_token) throw new Error('token');
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const info = await infoRes.json();
    if (!info.sub || info.email_verified === false) throw new Error('userinfo');
    const email = String(info.email || '').toLowerCase();
    if (ALLOWED.length && !ALLOWED.includes(email)) return res.redirect('/login?error=denied');
    const user = { id: `g:${info.sub}`, email, name: info.name || email, picture: info.picture || '' };
    await store.upsertUser(user);
    req.session.uid = user.id;
    res.redirect('/');
  } catch (err) {
    console.error('로그인 실패', err.message);
    res.redirect('/login?error=failed');
  }
});

app.get('/auth/dev', async (req, res) => {
  if (!DEV_LOGIN) return res.status(404).end();
  const user = { id: 'dev:local', email: 'dev@localhost', name: '로컬 테스트', picture: '' };
  await store.upsertUser(user);
  req.session.uid = user.id;
  res.redirect('/');
});

app.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// ---------- API ----------
const api = express.Router();
api.use((req, res, next) => {
  if (!req.session?.uid) return res.status(401).json({ error: 'login' });
  next();
});
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(req.path, err.message);
  res.status(502).json({ error: err.message });
});
const parseSymbols = (raw, max = 400) => [...new Set(String(raw || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL_RE.test(s)))].slice(0, max);

api.get('/me', wrap(async (req, res) => {
  const u = await store.getUser(req.session.uid);
  res.json(u || { id: req.session.uid });
}));

api.get('/state', wrap(async (req, res) => {
  res.json(await store.getDocs(req.session.uid));
}));

api.put('/state/:key', wrap(async (req, res) => {
  const { key } = req.params;
  if (!DOC_KEYS.has(key)) return res.status(400).json({ error: 'key' });
  if (!req.body || typeof req.body.data !== 'object') return res.status(400).json({ error: 'data' });
  await store.putDoc(req.session.uid, key, req.body.data);
  res.json({ ok: true, savedAt: new Date().toISOString() });
}));

api.get('/market/screener', wrap(async (req, res) => {
  res.set('Cache-Control', 'private, max-age=600');
  res.json(await market.screener());
}));

api.get('/market/quotes', wrap(async (req, res) => {
  res.json(await market.quotes(parseSymbols(req.query.symbols, 200)));
}));

api.get('/market/history', wrap(async (req, res) => {
  res.json(await market.histories(parseSymbols(req.query.symbols), String(req.query.range || '1y')));
}));

api.get('/market/fundamentals', wrap(async (req, res) => {
  res.json(await market.fundamentalsMany(parseSymbols(req.query.symbols, 120)));
}));

api.get('/market/profile', wrap(async (req, res) => {
  const [symbol] = parseSymbols(req.query.symbol, 1);
  if (!symbol) return res.status(400).json({ error: 'symbol' });
  res.json(await market.profile(symbol));
}));

// ---------- 미리 계산한 지표 (기술·컨센서스) ----------
api.get('/market/metrics', wrap(async (req, res) => {
  if (req.query.symbols) {
    const syms = parseSymbols(req.query.symbols, 120);
    await Promise.all([sync.ensureTech(syms), req.query.fund === '1' ? sync.ensureFund(syms) : null]);
    return res.json(sync.metrics(syms));
  }
  res.set('Cache-Control', 'private, max-age=300');
  res.json(sync.metrics());
}));

api.get('/market/sync-status', (req, res) => res.json(sync.status()));

api.get('/market/rankings', wrap(async (req, res) => {
  const kind = req.query.kind === 'company' ? 'company' : 'industry';
  const mkt = req.query.market === 'KR' ? 'KR' : 'US';
  const mode = req.query.mode === 'week' ? 'week' : 'month';
  let items;
  if (kind === 'industry') {
    items = (mkt === 'US' ? rank.US_ETF : rank.KR_ETF).map(([s, n]) => ({ s, n }));
    await sync.ensureTech(items.map((x) => x.s));
  } else {
    const g = (mkt === 'US' ? rank.US_GROUPS : rank.KR_GROUPS)[req.query.group] || (mkt === 'US' ? rank.US_GROUPS.mega : rank.KR_GROUPS.mega);
    if (mkt === 'US') {
      const d = await market.screener();
      items = d.rows.filter((r) => r.mc >= g[0] && r.mc < g[1]).map((r) => ({ s: r.s, n: r.n }));
    } else {
      items = (await rank.krCompanies()).filter((r) => r.mc >= g[0] && r.mc < g[1]).map((r) => ({ s: r.s, n: r.n }));
    }
  }
  const tech = sync.allTech();
  const covered = items.filter((x) => tech[x.s]).length;
  res.json({ kind, market: mkt, mode, total: items.length, covered, columns: rank.rankMatrix(items, tech, mode), sync: sync.status().running });
}));

// ---------- 주요 변화 (관심·보유 종목의 전망·일정·실적 변화) ----------
api.get('/changes', wrap(async (req, res) => {
  const syms = parseSymbols(req.query.symbols, 400);
  const days = Math.min(120, Math.max(1, +req.query.days || 30));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  res.json(await store.getChanges(syms, since));
}));

// ---------- 참고자료 첨부파일 (이미지·PDF) ----------
const FILE_LIMIT = 8 * 1024 * 1024, FILE_COUNT = 10;
const FILE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
api.get('/files', wrap(async (req, res) => {
  const files = await store.listFiles(req.session.uid);
  res.json({ files, used: files.reduce((a, f) => a + f.size, 0), limit: FILE_LIMIT, maxCount: FILE_COUNT });
}));
api.post('/files', express.json({ limit: '12mb' }), wrap(async (req, res) => {
  const { title, industry, mime, data } = req.body || {};
  if (!FILE_TYPES.has(mime)) return res.status(400).json({ error: 'PNG·JPG·GIF·WebP·PDF만 올릴 수 있습니다.' });
  const buf = Buffer.from(String(data || ''), 'base64');
  if (!buf.length) return res.status(400).json({ error: '빈 파일입니다.' });
  const files = await store.listFiles(req.session.uid);
  if (files.length >= FILE_COUNT) return res.status(400).json({ error: `최대 ${FILE_COUNT}개까지 보관할 수 있습니다.` });
  const used = files.reduce((a, f) => a + f.size, 0);
  if (used + buf.length > FILE_LIMIT) return res.status(400).json({ error: '첨부파일 합계 8MB를 넘습니다.' });
  const id = crypto.randomBytes(8).toString('hex');
  await store.addFile(req.session.uid, { id, title: String(title || '제목 없음').slice(0, 120), industry: String(industry || '').slice(0, 60), mime, size: buf.length, data: buf });
  res.json({ ok: true, id });
}));
api.get('/files/:id', wrap(async (req, res) => {
  const f = await store.getFile(req.session.uid, req.params.id);
  if (!f) return res.status(404).end();
  res.set('Content-Type', f.mime);
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.title)}`);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(f.data);
}));
api.patch('/files/:id', wrap(async (req, res) => {
  await store.updateFile(req.session.uid, req.params.id, { title: req.body?.title?.slice(0, 120), industry: req.body?.industry?.slice(0, 60) });
  res.json({ ok: true });
}));
api.delete('/files/:id', wrap(async (req, res) => {
  await store.deleteFile(req.session.uid, req.params.id);
  res.json({ ok: true });
}));

api.get('/market/earnings', wrap(async (req, res) => {
  const ym = String(req.query.month || '');
  if (!/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'month' });
  res.json(await market.earningsMonth(ym));
}));

app.use('/api', api);

store.init().then(() => {
  app.listen(PORT, () => {
    console.log(`raon-invest-web → ${BASE_URL} (저장소: ${store.kind}${DEV_LOGIN ? ', 개발용 로그인 켜짐' : ''})`);
  });
  if (process.env.DISABLE_SYNC !== '1') sync.start();
}).catch((err) => {
  console.error('저장소 초기화 실패', err);
  process.exit(1);
});
