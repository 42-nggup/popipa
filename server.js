#!/usr/bin/env node
/* popipa 本地服务器（零依赖）：静态页面 + 数据落盘
   用法：node server.js [端口]        默认 http://localhost:8000/

   环境变量：
     PORT          端口，默认 8000
     HOST          监听地址，默认 127.0.0.1（只给本机用）
     POPIPA_STATE  数据文件路径，默认 data/state.json
     POPIPA_ROOT   静态文件目录，默认 dist/（没有构建时退回 src/）

   为什么需要它：
   1. 多页面版靠 localStorage 在页面间共享登录态和进度，
      而浏览器在 file:// 下会按“每个文件一个 origin”隔离 localStorage。
   2. /api/state 把浏览器里的 popipa:* 数据落盘，清缓存 / 换浏览器后能自动恢复。
      数据文件是 { version, updatedAt, keys: { key: { v, at } } }，
      按 key 的写入时间 at 做 last-write-wins 合并。 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = __dirname;
function defaultRoot() {
  if (process.env.POPIPA_ROOT) return path.resolve(process.env.POPIPA_ROOT);
  const dist = path.join(PROJECT_ROOT, 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) return dist;
  const src = path.join(PROJECT_ROOT, 'src');
  if (fs.existsSync(path.join(src, 'index.html'))) return src;
  return PROJECT_ROOT;
}
const ROOT = defaultRoot();
const PORT = Number(process.env.PORT || process.argv[2] || 8000);
const HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_STATE_FILE = path.join(PROJECT_ROOT, 'data', 'state.json');
const STATE_FILE = path.resolve(process.env.POPIPA_STATE || DEFAULT_STATE_FILE);
const STATE_BAK = STATE_FILE + '.bak';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_KEY_LENGTH = 80;
const MAX_VALUE_LENGTH = 2 * 1024 * 1024;
const MAX_KEYS = 5000;
const MAX_REQUEST_KEYS = 2000;
const MAX_FUTURE_SKEW = 7 * 24 * 60 * 60 * 1000;
const API_PATH = '/api/state';
/* 数据文件不允许当静态资源下载：默认路径和 POPIPA_STATE 指向的路径都挡住，
   .bak / .tmp 一并挡住，避免数据文件被直接下载。 */
function isStateFile(file) {
  return [STATE_FILE, DEFAULT_STATE_FILE].some(f =>
    file === f || file === f + '.bak' || file === f + '.tmp');
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

/* ============ 数据文件 ============
   只保存需要跨浏览器共享的键：当前登录（popipa:user）和本机主题（popipa:theme）
   留在各自浏览器里，不落盘。 */
function isSyncKey(k) {
  if (typeof k !== 'string' || k.length === 0 || k.length > MAX_KEY_LENGTH) return false;
  if (k === 'popipa:users' || k === 'popipa:last') return true;
  if (k.indexOf('popipa:u:') !== 0) return false;
  const name = k.slice(9);
  /* 每用户表只允许普通昵称，不允许控制字符、路径分隔符 */
  return name.length > 0 && name.length <= 64 &&
    !/[\u0000-\u001f\u007f/\\]/.test(name);
}
function emptyState() { return { version: 1, updatedAt: 0, keys: {} }; }
function parseState(raw) {
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object' || !s.keys || typeof s.keys !== 'object') return null;
    const keys = {};
    Object.keys(s.keys).forEach(k => {
      const e = s.keys[k];
      if (!isSyncKey(k) || !e || typeof e !== 'object' || !('v' in e)) return;
      const at = Number(e.at);
      const v = e.v === null ? null : e.v;
      if (!Number.isFinite(at) || at < 0) return;
      if (v !== null && typeof v !== 'string') return;
      keys[k] = { v: v, at: at };
    });
    return { version: 1, updatedAt: Number(s.updatedAt) || 0, keys: keys };
  } catch (e) { return null; }
}
function readStateFile(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}
function loadState() {
  const mainRaw = readStateFile(STATE_FILE);
  if (mainRaw != null) {
    const main = parseState(mainRaw);
    if (main) return main;
    console.error('popipa: 数据文件损坏，尝试从 .bak 恢复：' + STATE_FILE);
  }
  const bakRaw = readStateFile(STATE_BAK);
  if (bakRaw != null) {
    const bak = parseState(bakRaw);
    if (bak) {
      console.error('popipa: 已从备份恢复：' + STATE_BAK);
      return bak;
    }
  }
  return emptyState();
}
let state = loadState();

function saveState() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  /* 只有当前文件本身是好的才备份，避免把损坏内容盖到好备份上 */
  try {
    if (fs.existsSync(STATE_FILE)) {
      const cur = fs.readFileSync(STATE_FILE, 'utf8');
      JSON.parse(cur);
      fs.writeFileSync(STATE_BAK, cur, { mode: 0o600 });
    }
  } catch (e) {}
  fs.renameSync(tmp, STATE_FILE);
}

/* 按 key 合并：at 大的赢；at 相同则后到的新值赢（同一毫秒内的连续写入） */
function mergeKeys(incoming) {
  let changed = false;
  Object.keys(incoming || {}).forEach(k => {
    if (!isSyncKey(k)) return;
    const e = incoming[k];
    if (!e || typeof e !== 'object' || Array.isArray(e) || !('v' in e)) return;
    const at = Number(e.at);
    const v = e.v === null ? null : e.v;
    if (!Number.isFinite(at) || at < 0) return;
    /* 防止恶意写入超远未来的时间戳，把 key 永久锁死 */
    if (at > Date.now() + MAX_FUTURE_SKEW) return;
    if (v !== null) {
      if (typeof v !== 'string' || v.length > MAX_VALUE_LENGTH) return;
      /* 业务值统一是 JSON 字符串；非法 JSON 直接拒绝 */
      try { JSON.parse(v); } catch (e) { return; }
    }
    if (!state.keys[k] && Object.keys(state.keys).length >= MAX_KEYS) return;
    const prev = state.keys[k];
    if (prev && Number(prev.at) > at) return;
    if (prev && prev.at === at && prev.v === v) return;
    state.keys[k] = { v: v, at: at };
    changed = true;
  });
  if (changed) state.updatedAt = Date.now();
  return changed;
}

function publicState() {
  return { ok: true, updatedAt: state.updatedAt, keys: state.keys };
}
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
function sendText(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) {
      const err = new Error('too large'); err.code = 413; reject(err); return;
    }
    let size = 0, done = false;
    const chunks = [];
    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        done = true;
        const err = new Error('too large'); err.code = 413;
        req.resume();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', err => { if (!done) { done = true; reject(err); } });
  });
}

/* ============ HTTP ============ */
http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (e) { sendText(res, 400, 'bad request'); return; }

  if (urlPath === API_PATH) {
    if (req.method === 'GET') { sendJson(res, 200, publicState()); return; }
    if (req.method === 'PUT' || req.method === 'POST') {
      readBody(req).then(body => {
        let data;
        try { data = JSON.parse(body || '{}'); }
        catch (e) { sendJson(res, 400, { ok: false, error: 'bad json' }); return; }
        if (!data || typeof data !== 'object' || !data.keys ||
            typeof data.keys !== 'object' || Array.isArray(data.keys)) {
          sendJson(res, 400, { ok: false, error: 'keys required' });
          return;
        }
        if (Object.keys(data.keys).length > MAX_REQUEST_KEYS) {
          sendJson(res, 413, { ok: false, error: 'too many keys' });
          return;
        }
        try {
          if (mergeKeys(data.keys)) saveState();
        } catch (e) {
          console.error('popipa: 保存数据失败：' + e.message);
          sendJson(res, 500, { ok: false, error: 'save failed' });
          return;
        }
        sendJson(res, 200, publicState());
      }).catch(err => {
        if (err && err.code === 413) { sendJson(res, 413, { ok: false, error: 'too large' }); return; }
        sendJson(res, 400, { ok: false, error: 'bad request' });
      });
      return;
    }
    res.writeHead(405, { Allow: 'GET, PUT, POST' });
    res.end('method not allowed');
    return;
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    sendText(res, 403, 'forbidden');
    return;
  }
  /* 数据文件不允许当静态资源下载（默认路径和自定义路径都挡） */
  if (isStateFile(file)) {
    sendText(res, 404, '404 ' + urlPath);
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      sendText(res, 404, '404 ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}).listen(PORT, HOST, () => {
  console.log('popipa: http://localhost:' + PORT + '/');
  console.log('popipa: 数据文件 ' + STATE_FILE + '（自动保存）');
});
