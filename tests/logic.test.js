/* =========================================================
   逻辑自测（Node 运行，不需要浏览器）：node tests/logic.test.js
   用极简 DOM 桩把 demo.js 跑起来，重点验证题面里的底线：
   "同一道题重复点几次提交，成绩不能跟着变。"
   ========================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const dataSrc = fs.readFileSync(path.join(root, 'demo.data.js'), 'utf8');
const logicSrc = fs.readFileSync(path.join(root, 'demo.js'), 'utf8');

/* ---- 极简 DOM 桩 ---- */
const els = {};
const mkEl = id => ({
  id, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false,
  dataset: {}, style: {},
  classList: { add() {}, remove() {}, contains: () => false },
  addEventListener() {}, focus() {}, matches: () => false, closest: () => null, setAttribute() {}
});
const storage = {};
const sandbox = {
  console, Math, JSON, Date, Number, String, Array, Object, Boolean, RegExp, Error, isNaN,
  document: { getElementById: id => (els[id] || (els[id] = mkEl(id))), addEventListener() {}, activeElement: null },
  localStorage: {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; }
  },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, confirm: () => true
};
sandbox.window = sandbox;                 // demo.data.js 里用 window.BANKS
vm.createContext(sandbox);
vm.runInContext(dataSrc + '\n' + logicSrc + `
globalThis.__hook = { S, stats, isCorrect, startSession, pickKey, submitCurrent, redoCurrent,
  jump, finish, pickBank, doLogin, retryWrong, QMAP, bankById, bankQuestionIds, LETTERS,
  loadRecords };`, sandbox);
const H = sandbox.__hook;

let pass = 0, fail = 0;
const ok = (name, cond) => cond ? (pass++, console.log('  \u2713 ' + name))
                                : (fail++, console.log('  \u2717 ' + name));
const section = t => console.log('\n' + t);

section('1. 登录与选题');
els['nick'].value = '小明';
H.doLogin();
ok('登录后进入选题页', H.S.view === 'banks' && H.S.user === '小明');
H.pickBank('web');
ok('选择题库后进入组卷页', H.S.view === 'setup');
ok('默认选中全部章节', H.S.chapters.length === H.bankById('web').chapters.length);

section('2. 题库数据完整性（解析产物）');
const web = H.bankById('web');
const allQ = web.chapters.flatMap(c => c.questions);
ok('Web 题库保留 119 题（已剔除 1 道无选项脏题）', allQ.length === 119);
ok('每道题都有答案', allQ.every(q => q.answer.length > 0));
ok('答案字母都在选项范围内', allQ.every(q => q.answer.every(a => a >= 'A' && a < String.fromCharCode(65 + q.options.length))));
ok('每道题至少 2 个选项', allQ.every(q => q.options.length >= 2));
const gradable = H.bankQuestionIds(web);
ok('可判分题数 = 全部题数', gradable.length === allQ.length);

section('3. 开始答题');
H.startSession();
ok('练习已开始', H.S.view === 'quiz' && H.S.session.order.length === gradable.length);

section('4. 单选：重复提交不改变成绩（底线要求）');
const qid0 = H.S.session.order[0];
const q0 = H.QMAP[qid0];
ok('第 1 题是单选题', q0.type === 'single');
H.pickKey(q0.answer[0]);
H.submitCurrent();
const st1 = H.stats(H.S.session);
ok('提交后答对数 = 1', st1.correct === 1 && st1.answered === 1);
H.submitCurrent(); H.submitCurrent(); H.submitCurrent();
const st2 = H.stats(H.S.session);
ok('再点 3 次提交，答对数仍是 1', st2.correct === 1 && st2.answered === 1);
ok('正确率仍为 100%，没有跳到 400%', st2.rate === 100);

section('5. 提交后答案锁定');
const before = H.S.session.answers[qid0].slice();
const other = [...H.LETTERS].slice(0, q0.options.length).find(k => q0.answer.indexOf(k) < 0);
H.pickKey(other);
ok('提交后再点别的选项，答案不变', JSON.stringify(H.S.session.answers[qid0]) === JSON.stringify(before));

section('6. 重做本题');
H.redoCurrent();
ok('重做后回到未提交状态', !H.S.session.submitted[qid0] && !H.S.session.answers[qid0]);
H.pickKey(q0.answer[0]); H.submitCurrent();
ok('重做答对后，正确数依然是 1（没有累加）', H.stats(H.S.session).correct === 1);

section('7. 多选：与勾选顺序无关');
const mIdx = H.S.session.order.findIndex(id => id !== qid0 && H.QMAP[id].type === 'multiple');
H.jump(mIdx);
const qm = H.QMAP[H.S.session.order[mIdx]];
ok('多选只勾一个不判对', !H.isCorrect(qm, [qm.answer[0]]));
qm.answer.slice().reverse().forEach(k => H.pickKey(k));
ok('乱序勾满全部选项判对', H.isCorrect(qm, H.S.session.answers[qm.id]));

section('8. 填空题判分（题型保留，当前题库暂无填空题）');
const qf = { type: 'fill', answer: ['final'], options: [] };
ok('忽略大小写与首尾空格', H.isCorrect(qf, '  Final '));
ok('错误答案判错', !H.isCorrect(qf, 'static'));
ok('空白答案判错', !H.isCorrect(qf, '   '));

section('9. 未作答不算答错');
const st = H.stats(H.S.session);
ok('未作答 = 总题数 - 已作答', st.unanswered === st.total - st.answered);
ok('答对 + 答错 = 已作答', st.correct + st.wrong === st.answered);

section('10. 交卷与成绩记录');
H.finish();
ok('进入结果页', H.S.view === 'result' && H.S.session.finished === true);
const recs = H.loadRecords();
ok('成绩已写入历史记录', recs.length >= 1 && recs[0].total === H.S.session.order.length);
ok('记录里的正确率与统计一致', recs[0].correct === H.stats(H.S.session).correct);

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
