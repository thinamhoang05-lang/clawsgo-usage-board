const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Locate the newest ClawsGO Chromium local-storage leveldb directory. */
function findLocalStorageDir() {
  const root = path.join(process.env.APPDATA || '', 'ClawsGO');
  if (!fs.existsSync(root)) return null;
  const candidates = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(root, ent.name, 'Local Storage', 'leveldb');
    if (fs.existsSync(path.join(dir, 'CURRENT'))) {
      let mtime = 0;
      try {
        mtime = fs.statSync(path.join(dir, 'CURRENT')).mtimeMs;
      } catch {}
      candidates.push({ dir, mtime });
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] ? candidates[0].dir : null;
}

function decodeValue(buf) {
  if (buf.length === 0) return '';
  const body = buf.subarray(1);
  let text = body.toString('utf8');
  if (text.includes('\u0000') || text.includes('\uFFFD')) {
    const alt = body.toString('utf16le');
    if (!alt.includes('\uFFFD')) text = alt;
  }
  return text;
}

/** Read chrome localStorage key/values from a copied leveldb (safe while app runs). */
async function readLocalStorage() {
  const src = findLocalStorageDir();
  if (!src) throw new Error('未找到 ClawsGO 的本地存储目录');

  const tmp = path.join(os.tmpdir(), 'clawsgo-hud-ls');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === 'LOCK' || name === 'LOG' || name === 'LOG.old') continue;
    try {
      const s = path.join(src, name);
      if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(tmp, name));
    } catch {
      /* file busy: ignore, retry next time */
    }
  }

  const { ClassicLevel } = require('classic-level');
  const db = new ClassicLevel(tmp, { createIfMissing: false });
  await db.open();
  const map = {};
  try {
    for await (const [k, v] of db.iterator({ keyEncoding: 'buffer', valueEncoding: 'buffer' })) {
      const key = k.toString('latin1');
      const idx = key.indexOf('\u0000\u0001');
      if (idx < 0) continue;
      map[key.slice(idx + 2)] = decodeValue(v);
    }
  } finally {
    await db.close().catch(() => {});
  }
  return map;
}

async function readAuthFromApp() {
  const ls = await readLocalStorage();
  const token = ls.clawsgo_token;
  const teamId = ls.clawsgo_team;
  if (!token) throw new Error('ClawsGO 里没有找到登录 token（可能尚未登录）');
  let models = [];
  try {
    const parsed = JSON.parse(ls.clawsgo_models || '{}');
    models = parsed.menu || [];
  } catch {}
  return { token, teamId, models };
}

module.exports = { findLocalStorageDir, readLocalStorage, readAuthFromApp };
