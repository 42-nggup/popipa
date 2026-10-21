#!/usr/bin/env node
/* =========================================================
   题库解析器：Markdown -> JSON
   ---------------------------------------------------------
   用法：node scripts/parse-banks.js
   输入：docs/raw/*.md
   输出：
     data/web.json    单个题库
     data/java.json   单个题库
     data/banks.json  合并后的题库数组（前端/接口可直接用）
     docs/parse-report.md  本次解析发现的所有问题与处理方式
     src/app.data.js  由 JSON 生成的 window.BANKS（供 file:// 直接打开用）
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'docs', 'raw');
const OUT = path.join(ROOT, 'data');
const SRC = path.join(ROOT, 'src');
const REPORT_OUT = path.join(ROOT, 'docs');

/* 每个源文件的元信息 */
const META = {
  'Web题库.md': { id: 'web', icon: '🌐' },
  'Java题库.md': { id: 'java', icon: '☕' }
};

/* ---------------------------------------------------------
   人工确认过的修正 / 剔除规则
   （这些是"题目内容"层面唯一的改动，全部记录在 parse-report.md）
   --------------------------------------------------------- */
const FIXES = {
  'Web题库.md#80': {
    answer: ['B'],
    reason: '原始答案写作 "E"，但该题只有 A~D 四个选项。依据解析「unshift() 在数组开头添加元素」修正为 B。'
  },
  'Java题库.md#71': {
    answer: ['B'],
    reason: '原始题目缺失「**答案**」行。依据解析「final 修饰的变量一旦赋值就不能再修改，用于定义常量」修正为 B。'
  }
};
const DROPS = {
  'Web题库.md#31': '原始题目丢失了全部选项（只剩下答案 A 与解析），没有任何可选项、无法作答，予以剔除。'
};

const TYPE_MAP = { '单选题': 'single', '多选题': 'multiple', '判断题': 'judge' };

/* ---------------- 解析 Markdown ---------------- */
function parseMarkdown(file, text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const questions = [];
  let meta = { name: null, summary: null };
  let chapter = null, cur = null, fence = false, target = null;

  function finalize() {
    if (!cur) return;
    cur.stem = cur.stemLines.join('\n').trim();
    cur.options.forEach(o => { o.text = o.lines.join('\n').trim(); });
    cur.analysis = cur.analysisLines.join('\n').trim();
    questions.push(cur);
    cur = null; target = null;
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');          // 每行先去行尾空白（含 \r 与多余空格）

    /* 代码围栏内部原样保留（题干 / 选项里可能有 ```java 代码块） */
    if (/^\s*```/.test(line)) {
      fence = !fence;
      if (target) target.lines.push(line);
      continue;
    }
    if (fence) { if (target) target.lines.push(line); continue; }

    let m;
    if ((m = line.match(/^###\s+(\d+)\.\s*(.+)$/))) {
      finalize();
      cur = { no: +m[1], typeRaw: m[2].trim(), stemLines: [], options: [],
              answerRaw: null, analysisLines: [] };
      target = { lines: cur.stemLines };
      continue;
    }
    if ((m = line.match(/^##\s+(.+)$/))) { finalize(); chapter = m[1].trim(); continue; }

    if (!cur) {
      if ((m = line.match(/^#\s+(.+)$/))) meta.name = m[1].trim();
      else if ((m = line.match(/^>\s*(.+)$/))) meta.summary = m[1].trim();
      continue;
    }

    if (/^---\s*$/.test(line)) { finalize(); continue; }
    if ((m = line.match(/^\*\*答案\*\*\s*[：:]\s*(.*)$/))) {
      cur.answerRaw = m[1].trim(); target = { lines: [] }; continue;
    }
    if ((m = line.match(/^\*\*解析\*\*\s*[：:]\s*(.*)$/))) {
      cur.analysisLines = [m[1].trim()];
      target = { lines: cur.analysisLines };
      continue;
    }
    if ((m = line.match(/^\s*-\s*([A-Za-z])\s*[.、．:：]\s*(.*)$/))) {
      const opt = { label: m[1].toUpperCase(), lines: [], text: '' };
      cur.options.push(opt);
      target = opt;
      if (m[2].trim()) opt.lines.push(m[2].trim());
      continue;
    }
    if (target) target.lines.push(line);
  }
  finalize();
  return { meta, chapterCount: countChapters(text), questions };
}

function countChapters(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').filter(l => /^##\s+/.test(l)).length;
}

/* ---------------- 规范化 ---------------- */
function parseAnswer(raw) {
  if (raw == null) return [];
  return raw.split(/[、,，;；\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
}
function makeDesc(summary, chapterCount, typeCount) {
  /* 用“实际保留的题”重新统计，不用源文件摘要：
     摘要里的数字可能包含后面被剔除的脏题（Web 题库就多了 1 道单选）。 */
  const counts = Object.entries(typeCount).map(([k, v]) => k + ' ' + v).join(' + ');
  return chapterCount + ' 个章节' + (counts ? ' · ' + counts : '');
}

/* ---------------- 主流程 ---------------- */
const banks = [];
const report = { files: [], drops: [], fixes: [], notes: [], totals: {} };

for (const file of fs.readdirSync(RAW).filter(f => f.endsWith('.md')).sort()) {
  const text = fs.readFileSync(path.join(RAW, file), 'utf8');
  const { meta, chapterCount, questions } = parseMarkdown(file, text);
  const cfg = META[file] || { id: file.replace(/\.md$/, ''), icon: '📘' };

  const kept = [];
  const typeCount = {};
  let droppedHere = 0, fixedHere = 0;

  for (const q of questions) {
    const key = file + '#' + q.no;

    if (DROPS[key]) {
      report.drops.push({ file, no: q.no, reason: DROPS[key] });
      droppedHere++;
      continue;
    }

    const type = TYPE_MAP[q.typeRaw];
    if (!type) {
      report.notes.push('未识别题型，已跳过：' + key + ' 类型="' + q.typeRaw + '"');
      droppedHere++;
      continue;
    }

    let answer = parseAnswer(q.answerRaw);
    if (q.answerRaw == null) report.notes.push(key + ' 缺少「答案」行');
    if (FIXES[key]) {
      report.fixes.push({ file, no: q.no, from: q.answerRaw || '(无)', to: FIXES[key].answer.join('、'), reason: FIXES[key].reason });
      answer = FIXES[key].answer.slice();
      fixedHere++;
    }
    if (!answer.length) { report.notes.push(key + ' 修正后仍无答案，已跳过'); droppedHere++; continue; }
    if (!q.analysis) report.notes.push(key + ' 缺少解析（判分不受影响）');
    if (q.options.some(o => /\n/.test(o.text))) report.notes.push(key + ' 选项含多行代码块，已按原样保留');

    const ci = 0; // 章节索引在下方按顺序生成，这里的 id 稍后统一补
    kept.push({
      id: cfg.id + '-q' + q.no,
      no: q.no,
      chapter: null,
      type,
      stem: q.stem,
      options: q.options.map(o => o.text),
      answer,
      analysis: q.analysis
    });
    typeCount[q.typeRaw] = (typeCount[q.typeRaw] || 0) + 1;
  }

  /* 章节归属：按出现顺序重新扫描，把题目分配到最近的 "## " 章节 */
  const chapterNames = text.replace(/\r\n?/g, '\n').split('\n')
    .filter(l => /^##\s+/.test(l)).map(l => l.replace(/^##\s+/, '').trim());
  const owner = ownerMap(text);
  const chapters = chapterNames.map((name, i) => ({
    id: cfg.id + '-c' + (i + 1), name, questions: []
  }));
  kept.forEach(q => {
    const idx = owner[q.no] != null ? owner[q.no] : 0;
    q.chapter = idx;
    q.id = cfg.id + '-c' + (idx + 1) + '-q' + q.no;
    delete q.no;
  });
  kept.forEach(q => chapters[q.chapter].questions.push({ id: q.id, type: q.type, stem: q.stem,
    options: q.options, answer: q.answer, analysis: q.analysis }));

  const bank = {
    id: cfg.id,
    name: meta.name || file.replace(/\.md$/, ''),
    desc: makeDesc(meta.summary, chapterCount, typeCount),
    icon: cfg.icon,
    source: 'docs/raw/' + file,
    chapters: chapters.filter(c => c.questions.length)
  };
  banks.push(bank);

  report.files.push({
    file, bankId: cfg.id, name: bank.name,
    parsed: questions.length, kept: kept.length, dropped: droppedHere,
    fixed: fixedHere, chapters: bank.chapters.length, typeCount
  });
}

/* 章节归属映射：题号 -> 章节下标 */
function ownerMap(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const map = {}; let ci = -1;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^##\s+/.test(line)) { ci++; continue; }
    const m = line.match(/^###\s+(\d+)\./);
    if (m && ci >= 0) { if (map[+m[1]] == null) map[+m[1]] = ci; }
  }
  return map;
}

/* ---------------- 写出 ---------------- */
const json = b => JSON.stringify(b, null, 2) + '\n';
banks.forEach(b => fs.writeFileSync(path.join(OUT, b.id + '.json'), json(b)));
fs.writeFileSync(path.join(OUT, 'banks.json'), json(banks));

/* 供 file:// 双击打开使用（fetch 本地 json 会被浏览器拦截，所以生成一份 JS 镜像） */
fs.writeFileSync(path.join(SRC, 'app.data.js'),
  '/* 自动生成，请勿手改：由 scripts/parse-banks.js 从 docs/raw/*.md 生成 */\n' +
  'window.BANKS = ' + JSON.stringify(banks, null, 2) + ';\n');

/* 解析报告 */
const L = [];
L.push('# 题库解析报告', '');
L.push('> 本文件由 `node scripts/parse-banks.js` 自动生成。记录 Markdown 题库转换为 JSON 时发现的全部问题与处理方式。', '');
L.push('## 一、总体情况', '');
L.push('| 源文件 | 题库 | 解析到 | 保留 | 剔除 | 修正 | 章节 |');
L.push('|---|---|---|---|---|---|---|');
report.files.forEach(f => {
  L.push('| ' + f.file + ' | ' + f.name + ' | ' + f.parsed + ' | ' + f.kept + ' | ' +
    f.dropped + ' | ' + f.fixed + ' | ' + f.chapters + ' |');
});
const totalKept = report.files.reduce((n, f) => n + f.kept, 0);
L.push('');
L.push('合计保留 **' + totalKept + '** 道题。', '');

L.push('## 二、剔除的题目（无法作答）', '');
L.push('| 位置 | 原因 |'); L.push('|---|---|');
report.drops.forEach(d => L.push('| ' + d.file + ' 第 ' + d.no + ' 题 | ' + d.reason + ' |'));
L.push('');

L.push('## 三、修正的题目（依据解析推断，属于对题目内容的唯一改动）', '');
L.push('| 位置 | 原答案 | 修正为 | 依据 |'); L.push('|---|---|---|---|');
report.fixes.forEach(f => L.push('| ' + f.file + ' 第 ' + f.no + ' 题 | ' + f.from + ' | ' +
  f.to + ' | ' + f.reason + ' |'));
L.push('');

L.push('## 四、全局格式清洗（不改变语义）', '');
L.push('- 统一换行符：`CRLF` → `LF`，去掉每行行尾的空白；');
L.push('- 答案行规范化：`A、C、D` → `["A","C","D"]`，并统一转为大写字母；');
L.push('- 选项标号统一为 `A/B/C/D...`，选项文本去掉首尾空白；');
L.push('- 题号重新生成稳定 id：`<题库>-c<章节号>-q<原题号>`；');
L.push('- 题干与选项中若含代码块，按原样保留（见下）。');
L.push('');

L.push('## 五、其他需要留意的地方', '');
if (report.notes.length) {
  report.notes.forEach(n => L.push('- ' + n));
} else {
  L.push('- 无');
}
L.push('');
L.push('> 说明：原始题库明确要求"不要修改题目内容"，因此除上面第三节列出的两处'
  + '（依据题目自带的解析可唯一确定答案）和第二节剔除的一道不可作答题目外，'
  + '没有对题干、选项、答案做任何改动。');
fs.writeFileSync(path.join(REPORT_OUT, 'parse-report.md'), L.join('\n') + '\n');

/* 控制台摘要 */
console.log('解析完成：');
report.files.forEach(f => console.log('  ' + f.file + ' → ' + f.bankId + '.json：解析 ' +
  f.parsed + ' 保留 ' + f.kept + ' 剔除 ' + f.dropped + ' 修正 ' + f.fixed));
console.log('  合计保留 ' + totalKept + ' 题，已写出 data/{web,java,banks}.json 与 src/app.data.js');
if (report.drops.length) console.log('  剔除 ' + report.drops.length + ' 题，修正 ' + report.fixes.length + ' 题，详见 docs/parse-report.md');
