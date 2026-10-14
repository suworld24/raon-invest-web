const express = require('express');
const cookieSession = require('cookie-session');
const crypto = require('crypto');
const path = require('path');
const store = require('./lib/store');
const market = require('./lib/market');

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
const DOC_KEYS = new Set(['portfolio', 'watch', 'sectors', 'notes', 'calendar', 'screener', 'ranking', 'prefs']);
const SYMBOL_RE = /^[A-Za-z0-9.\-=^]{1,20}$/;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cookieSession({
  name: 'kk_sess',
  keys: [SESSION_SECRET],
  maxAge: 30 * 24 * 3600e3,
  sameSite: 'lax',
  secure: IS_PROD,
  httpOnly: true,
}));
app.use(express.json({ limit: '5mb' }));

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
app.use(express.static(publicDir, { index: false, maxAge: IS_PROD ? '1h' : 0 }));

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
}).catch((err) => {
  console.error('저장소 초기화 실패', err);
  process.exit(1);
});
