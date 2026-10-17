/* =========================================================
   逻辑自测（Node 运行，不需要浏览器）：node tests/logic.test.js
   用极简 DOM 桩把 app.js 跑起来，重点验证题面里的底线：
   "同一道题重复点几次提交，成绩不能跟着变。"
   ========================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const dataSrc = fs.readFileSync(path.join(root, 'app.data.js'), 'utf8');
const logicSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

/* ---- 极简 DOM 桩 ---- */
const els = {};
const mkEl = id => {
  const classes = new Set();
  return {
    id, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false,
    dataset: {}, style: {},
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: c => classes.has(c),
      toggle: (c, on) => { (on === undefined ? !classes.has(c) : on) ? classes.add(c) : classes.delete(c); }
    },
    addEventListener() {}, focus() {}, select() {}, matches: () => false, closest: () => null,
    setAttribute() {}
  };
};
/* 假 bootstrap.Modal：真组件靠 .show 类 + hidden.bs.modal 事件，这里只模仿类切换 */
function FakeModal(el) {
  this.el = el;
  this.show = () => el.classList.add('show');
  this.hide = () => el.classList.remove('show');
}
FakeModal.getOrCreateInstance = el => (el.__m || (el.__m = new FakeModal(el)));
const storage = {};
const sandbox = {
  console, Math, JSON, Date, Number, String, Array, Object, Boolean, RegExp, Error, isNaN,
  document: {
    getElementById: id => (els[id] || (els[id] = mkEl(id))),
    addEventListener() {}, activeElement: null, documentElement: { dataset: {} }
  },
  localStorage: {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; }
  },
  bootstrap: { Modal: FakeModal },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, confirm: () => true
};
sandbox.window = sandbox;                 // demo.data.js 里用 window.BANKS
vm.createContext(sandbox);
vm.runInContext(dataSrc + '\n' + logicSrc + `
globalThis.__hook = { S, stats, isCorrect, hasAnswer, startSession, pickKey, submitCurrent, redoCurrent,
  jump, go, step, finish, pickBank, doLogin, retryWrong, closeDialog, askUnsubmitted,
  tickAuto, QMAP, bankById, bankQuestionIds, LETTERS, render,
  store, KEY, userOf, users, wrongIds, sanitizeSession, historyOf, loadProgress, lastName,
  applyTheme, theme, toggleTheme, navTargetScroll,
  getAuto: () => autoJump, askShown: () => askModalEl.classList.contains('show'),
  dialogHtml: () => dialogEl.innerHTML };`, sandbox);
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
const recs = H.historyOf('小明');
ok('成绩已写进这个用户的历史', recs.length >= 1 && recs[0].total === H.S.session.order.length);
ok('记录里的正确率与统计一致', recs[0].correct === H.stats(H.S.session).correct);

section('11. 未提交就点「下一题」');
H.S.view = 'setup';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.mode = 'order';
H.startSession();
const ord = H.S.session.order;
const sIdx = ord.findIndex(id => H.QMAP[id].type === 'single');
H.jump(sIdx);
H.pickKey(H.QMAP[ord[sIdx]].answer[0]);
ok('单选题：选了但没提交', H.hasAnswer(H.QMAP[ord[sIdx]], H.S.session.answers[ord[sIdx]]) && !H.S.session.submitted[ord[sIdx]]);
H.step(1);
ok('单选：自动提交并进入下一题', H.S.session.submitted[ord[sIdx]] === true && H.S.session.idx === sIdx + 1);
ok('单选：自动提交不启动倒计时', H.getAuto() === null);

const mIdx2 = ord.findIndex((id, i) => i > sIdx && H.QMAP[id].type === 'multiple');
H.jump(mIdx2);
H.pickKey(H.QMAP[ord[mIdx2]].answer[0]);
H.closeDialog();
ok('多选：弹窗默认是关的', H.askShown() === false);
H.step(1);
ok('多选：不自动提交、停在原题', H.S.session.submitted[ord[mIdx2]] !== true && H.S.session.idx === mIdx2);
ok('多选：弹出询问框且带「不再提醒」', H.askShown() === true && H.dialogHtml().indexOf('不再提醒') >= 0);
H.closeDialog(); H.go(1);
ok('选「不提交，继续」后进入下一题', H.S.session.idx === mIdx2 + 1 && !H.S.session.submitted[ord[mIdx2]]);

const mIdx3 = ord.findIndex((id, i) => i > mIdx2 + 1 && H.QMAP[id].type === 'multiple');
H.jump(mIdx3);
H.pickKey(H.QMAP[ord[mIdx3]].answer[0]);
H.S.noPrompt = true;                        /* 相当于在提示框上勾了「不再提醒」 */
H.step(1);
ok('开启「不再提醒」后：多选也直接提交', H.S.session.submitted[ord[mIdx3]] === true && H.S.session.idx === mIdx3 + 1);
ok('开启后：不再弹询问框', H.askShown() === false);
H.S.noPrompt = false;

section('12. 提交后 3 秒 / 10 秒自动跳转');
H.startSession();
const ord2 = H.S.session.order;
const wrongKeyOf = q => H.LETTERS.split('').slice(0, q.options.length).find(k => q.answer.indexOf(k) < 0);

H.jump(0);
H.pickKey(H.QMAP[ord2[0]].answer[0]);
H.submitCurrent();
let auto = H.getAuto();
ok('答对：3 秒后跳转', !!auto && auto.sec === 3 && auto.target === 1 && auto.qid === ord2[0]);
ok('倒计时期间页面显示剩余秒数', H.askShown() === false && H.S.session.submitted[ord2[0]] === true);

const wIdx = ord2.findIndex((id, i) => i > 0 && wrongKeyOf(H.QMAP[id]));
const wKey = wrongKeyOf(H.QMAP[ord2[wIdx]]);
H.jump(wIdx);
H.pickKey(wKey);
H.submitCurrent();
auto = H.getAuto();
ok('答错：10 秒后跳转', !!auto && auto.sec === 10 && auto.target === wIdx + 1);

H.getAuto().at = Date.now() - 1;            /* 把倒计时拨到已结束 */
H.tickAuto();
ok('倒计时结束自动跳到下一题', H.S.session.idx === wIdx + 1 && H.getAuto() === null);

H.jump(wIdx);
H.pickKey(wKey);
H.redoCurrent();
H.pickKey(wKey);
H.submitCurrent();
H.jump(0);
ok('手动切题会取消自动跳转', H.getAuto() === null);

H.jump(ord2.length - 1);
H.pickKey(H.QMAP[ord2[ord2.length - 1]].answer[0]);
H.submitCurrent();
ok('最后一题不自动跳转（避免误触交卷）', H.getAuto() === null && H.S.view === 'quiz');

section('13. 用户表：登录 / 进度 / 主题');
ok('登录后写进了用户表', H.userOf('小明').lastLogin > 0);
ok('记住了最近一次登录的是谁', H.lastName() === '小明');
ok('答题中会把进度存到这个用户名下', !!H.userOf('小明').books['web']);
H.applyTheme('dark');
ok('主题也按用户存', H.userOf('小明').theme === 'dark');
H.toggleTheme();
ok('切换主题只改这一个用户', H.userOf('小明').theme === 'light' && H.theme() === 'light');
ok('主题写到 data-bs-theme 上（Bootstrap 认的属性）', sandbox.document.documentElement.dataset.bsTheme === 'light');

section('14. 错题本：答错记下 / 答对移出');
H.S.user = '小明'; H.S.view = 'setup'; H.S.bankId = 'web';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.mode = 'order'; H.S.wrongOnly = false;
H.startSession();
const ord3 = H.S.session.order;
const wrongOf = q => H.LETTERS.split('').slice(0, q.options.length).find(k => q.answer.indexOf(k) < 0);
const wI = ord3.findIndex(id => wrongOf(H.QMAP[id]));
H.jump(wI);
H.pickKey(wrongOf(H.QMAP[ord3[wI]]));
H.submitCurrent();
const cI = ord3.findIndex((id, i) => i !== wI);
H.jump(cI);
H.QMAP[ord3[cI]].answer.forEach(k => H.pickKey(k));
H.submitCurrent();
H.finish();
const wBook = H.wrongIds('小明', 'web');
ok('答错的题进了错题本', wBook.indexOf(ord3[wI]) >= 0);
ok('答对的题不在错题本里', wBook.indexOf(ord3[cI]) === -1);
H.S.view = 'setup'; H.S.wrongOnly = true;
H.startSession();
ok('只练错题：出的题全部来自错题本', H.S.session.order.length > 0 &&
   H.S.session.order.every(id => wBook.indexOf(id) >= 0));
H.S.session.order.forEach((id, i) => {
  H.jump(i);
  H.QMAP[id].answer.forEach(k => H.pickKey(k));
  H.submitCurrent();
});
H.finish();
ok('全部答对后错题本被清空', H.wrongIds('小明', 'web').length === 0);

section('15. 旧题库残留的题号不会再让页面崩（用户名 11 那个 bug）');
const all11 = H.users();
all11['11'] = { name: '11', books: { web: { order: ['web-html-1', 'web-js-5'], idx: 1,
  answers: { 'web-html-1': ['A'] }, submitted: { 'web-html-1': true }, fav: {} } } };
H.store.set(H.KEY.users, all11);
ok('读到已不存在的题号时，这条进度直接作废', H.loadProgress('11', 'web') === null);
H.S.user = '11'; H.S.view = 'banks';
let threw = null;
try { H.render(); } catch (e) { threw = e; }
ok('带着脏进度进选题页不再抛异常', threw === null);
ok('选题页仍然渲染出来了', els['app'].innerHTML.indexOf('选择题库') >= 0);
H.S.user = '小明';

section('16. 答题卡自动定位');
ok('当前题停在导航条偏左 35% 处', H.navTargetScroll(1000, 900, 5000) === 685);
ok('刚开头时不硬顶（夹到 0）', H.navTargetScroll(10, 900, 5000) === 0);
ok('快到头时不硬顶（夹到最后）', H.navTargetScroll(4900, 900, 5000) === 4100);
ok('整条塞得下就不滚', H.navTargetScroll(100, 900, 800) === 0);

section('17. 登录页');
H.S.user = null; H.S.view = 'login';
H.render();
ok('不再有「本机记录」', els['app'].innerHTML.indexOf('本机') === -1);
ok('回填了上次登录的昵称', els['app'].innerHTML.indexOf('value="小明"') >= 0);
ok('主题按钮不在登陆页消失', els['themeBtn'].innerHTML.indexOf('bi-') >= 0);

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
