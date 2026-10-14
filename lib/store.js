// 사용자 · 개인 기록 · 시장 자료 · 변화 기록 · 첨부파일 저장소
// DATABASE_URL 이 있으면 Postgres, 없으면 data/ 폴더의 JSON 파일 (로컬 개발용)
const fs = require('fs');
const path = require('path');

let impl;

function pgStore(url) {
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
  return {
    kind: 'postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT,
          name TEXT,
          picture TEXT,
          created_at TIMESTAMPTZ DEFAULT now(),
          last_login TIMESTAMPTZ DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS user_docs (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now(),
          PRIMARY KEY (user_id, key)
        );
        CREATE TABLE IF NOT EXISTS market_kv (
          key TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS change_log (
          id BIGSERIAL PRIMARY KEY,
          sym TEXT NOT NULL,
          kind TEXT NOT NULL,
          at TIMESTAMPTZ DEFAULT now(),
          data JSONB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS change_log_sym_at ON change_log (sym, at DESC);
        CREATE TABLE IF NOT EXISTS user_files (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          industry TEXT,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL,
          data BYTEA NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS user_files_user ON user_files (user_id);`);
    },
    async upsertUser(u) {
      await pool.query(
        `INSERT INTO users (id, email, name, picture) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET email=$2, name=$3, picture=$4, last_login=now()`,
        [u.id, u.email, u.name, u.picture]);
    },
    async getUser(id) {
      const r = await pool.query('SELECT id, email, name, picture FROM users WHERE id=$1', [id]);
      return r.rows[0] || null;
    },
    async getDocs(uid) {
      const r = await pool.query('SELECT key, data, updated_at FROM user_docs WHERE user_id=$1', [uid]);
      const out = {};
      for (const row of r.rows) out[row.key] = row.data;
      return out;
    },
    async putDoc(uid, key, data) {
      await pool.query(
        `INSERT INTO user_docs (user_id, key, data, updated_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (user_id, key) DO UPDATE SET data=$3, updated_at=now()`,
        [uid, key, JSON.stringify(data)]);
    },
    // 모든 사용자의 특정 기록 (관심·보유 종목 수집용)
    async allDocs(key) {
      const r = await pool.query('SELECT data FROM user_docs WHERE key=$1', [key]);
      return r.rows.map((x) => x.data);
    },
    async getKV(key) {
      const r = await pool.query('SELECT data, updated_at FROM market_kv WHERE key=$1', [key]);
      return r.rows[0]?.data || null;
    },
    async putKV(key, data) {
      await pool.query(
        `INSERT INTO market_kv (key, data, updated_at) VALUES ($1,$2,now())
         ON CONFLICT (key) DO UPDATE SET data=$2, updated_at=now()`,
        [key, JSON.stringify(data)]);
    },
    async addChanges(list) {
      for (const c of list) {
        await pool.query('INSERT INTO change_log (sym, kind, data) VALUES ($1,$2,$3)', [c.sym, c.kind, JSON.stringify(c.data)]);
      }
    },
    async getChanges(syms, sinceIso) {
      if (!syms.length) return [];
      const r = await pool.query(
        'SELECT id, sym, kind, at, data FROM change_log WHERE sym = ANY($1) AND at >= $2 ORDER BY at DESC LIMIT 500',
        [syms, sinceIso]);
      return r.rows.map((x) => ({ id: String(x.id), sym: x.sym, kind: x.kind, at: x.at.toISOString(), data: x.data }));
    },
    async listFiles(uid) {
      const r = await pool.query('SELECT id, title, industry, mime, size, created_at FROM user_files WHERE user_id=$1 ORDER BY created_at DESC', [uid]);
      return r.rows.map((x) => ({ ...x, created_at: x.created_at.toISOString() }));
    },
    async addFile(uid, f) {
      await pool.query('INSERT INTO user_files (id, user_id, title, industry, mime, size, data) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [f.id, uid, f.title, f.industry, f.mime, f.size, f.data]);
    },
    async getFile(uid, id) {
      const r = await pool.query('SELECT id, title, mime, data FROM user_files WHERE user_id=$1 AND id=$2', [uid, id]);
      return r.rows[0] || null;
    },
    async updateFile(uid, id, patch) {
      await pool.query('UPDATE user_files SET title=COALESCE($3,title), industry=COALESCE($4,industry) WHERE user_id=$1 AND id=$2',
        [uid, id, patch.title ?? null, patch.industry ?? null]);
    },
    async deleteFile(uid, id) {
      await pool.query('DELETE FROM user_files WHERE user_id=$1 AND id=$2', [uid, id]);
    },
  };
}

function fileStore(dir) {
  const file = path.join(dir, 'local-db.json');
  let db = { users: {}, docs: {}, changes: [], files: {} };
  const save = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(db));
    fs.renameSync(file + '.tmp', file);
  };
  const kvFile = (key) => path.join(dir, `kv-${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  return {
    kind: 'file',
    async init() {
      try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* 새 파일 */ }
    },
    async upsertUser(u) { db.users[u.id] = { ...db.users[u.id], ...u }; save(); },
    async getUser(id) { return db.users[id] || null; },
    async getDocs(uid) { return { ...(db.docs[uid] || {}) }; },
    async putDoc(uid, key, data) { (db.docs[uid] ||= {})[key] = data; save(); },
    async allDocs(key) { return Object.values(db.docs).map((d) => d[key]).filter(Boolean); },
    async getKV(key) { try { return JSON.parse(fs.readFileSync(kvFile(key), 'utf8')); } catch { return null; } },
    async putKV(key, data) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(kvFile(key), JSON.stringify(data)); },
    async addChanges(list) {
      for (const c of list) db.changes.push({ id: String(Date.now()) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), ...c });
      db.changes = db.changes.slice(-5000);
      save();
    },
    async getChanges(syms, sinceIso) {
      const set = new Set(syms);
      return db.changes.filter((c) => set.has(c.sym) && c.at >= sinceIso).reverse().slice(0, 500);
    },
    async listFiles(uid) {
      return Object.values(db.files[uid] || {}).map(({ data, ...meta }) => meta).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
    async addFile(uid, f) {
      (db.files[uid] ||= {})[f.id] = { id: f.id, title: f.title, industry: f.industry, mime: f.mime, size: f.size, data: f.data.toString('base64'), created_at: new Date().toISOString() };
      save();
    },
    async getFile(uid, id) {
      const f = db.files[uid]?.[id];
      return f ? { id: f.id, title: f.title, mime: f.mime, data: Buffer.from(f.data, 'base64') } : null;
    },
    async updateFile(uid, id, patch) {
      const f = db.files[uid]?.[id];
      if (f) { if (patch.title != null) f.title = patch.title; if (patch.industry != null) f.industry = patch.industry; save(); }
    },
    async deleteFile(uid, id) { if (db.files[uid]) { delete db.files[uid][id]; save(); } },
  };
}

impl = process.env.DATABASE_URL
  ? pgStore(process.env.DATABASE_URL)
  : fileStore(path.join(__dirname, '..', 'data'));

module.exports = impl;
