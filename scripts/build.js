#!/usr/bin/env node
/* 把 src/ 里的运行文件复制到 dist/，并带上根目录的 server.js。
   用法：node scripts/build.js
   说明：CSS 由 npm run build:css 先编译到 src/assets/app.css；
   这个脚本不做编译，只负责组装可部署目录。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const name of fs.readdirSync(SRC)) {
  if (name === 'tailwind.css') continue;   // 源样式不进入部署产物
  if (name === 'demo') continue;           // app-shell 只用于本地开发演示
  fs.cpSync(path.join(SRC, name), path.join(DIST, name), { recursive: true });
}

fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(DIST, 'server.js'));

console.log('popipa: 已生成 dist/');
console.log('popipa: 静态文件来自 src/，服务端来自 server.js');
