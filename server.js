#!/usr/bin/env node
/* popipa 本地静态服务器（零依赖）
   用法：node server.js [端口]   默认 http://localhost:8000/

   为什么需要它：多页面版靠 localStorage 在页面间共享登录态和进度，
   而浏览器在 file:// 下会按“每个文件一个 origin”隔离 localStorage。
   用 http:// 打开时同源共享，三页跳转才真正成立。 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || process.argv[2] || 8000);
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

http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch (e) { res.writeHead(400); res.end('bad request'); return; }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log('popipa: http://localhost:' + PORT + '/');
});
