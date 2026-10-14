// 사용자 · 개인 기록 저장소
// DATABASE_URL 이 있으면 Postgres, 없으면 data/local-db.json (로컬 개발용)
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
        );`);
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
  };
}

function fileStore(file) {
  let db = { users: {}, docs: {} };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(db));
    fs.renameSync(file + '.tmp', file);
  };
  return {
    kind: 'file',
    async init() {
      try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 새 파일 */ }
    },
    async upsertUser(u) { db.users[u.id] = { ...db.users[u.id], ...u }; save(); },
    async getUser(id) { return db.users[id] || null; },
    async getDocs(uid) { return { ...(db.docs[uid] || {}) }; },
    async putDoc(uid, key, data) { (db.docs[uid] ||= {})[key] = data; save(); },
  };
}

impl = process.env.DATABASE_URL
  ? pgStore(process.env.DATABASE_URL)
  : fileStore(path.join(__dirname, '..', 'data', 'local-db.json'));

module.exports = impl;
