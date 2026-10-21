#!/usr/bin/env node
/* 从 npm 依赖生成 src/vendor/：
   Bootstrap Icons 的 CSS + 字体，以及 html2canvas 的浏览器版本。
   这些文件不提交到仓库，npm install / 构建时再生成。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'src', 'vendor');
const BI = path.join(ROOT, 'node_modules', 'bootstrap-icons', 'font');
const H2C = path.join(ROOT, 'node_modules', 'html2canvas', 'dist', 'html2canvas.min.js');

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

fs.copyFileSync(path.join(BI, 'bootstrap-icons.min.css'), path.join(DEST, 'bootstrap-icons.min.css'));
fs.cpSync(path.join(BI, 'fonts'), path.join(DEST, 'fonts'), { recursive: true });
fs.copyFileSync(H2C, path.join(DEST, 'html2canvas.min.js'));

console.log('popipa: 已从 npm 依赖生成 src/vendor/');
