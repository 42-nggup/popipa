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
    addEventListener() {}, focus() {}, select() {}, matches: () => false,
    closest() { return this; },   /* 事件委托靠它找到 [data-act]，桩里返回自己就够 */
    setAttribute() {}, remove() {}, appendChild() {}, querySelector: () => null
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
const handlers = { click: [] };
const sandbox = {
  console, Math, JSON, Date, Number, String, Array, Object, Boolean, RegExp, Error, isNaN,
  document: {
    getElementById: id => (els[id] || (els[id] = mkEl(id))),
    querySelector: () => null,          /* 组件定向更新在桩里走兜底渲染 */
    createElement: () => mkEl('tmp'),
    body: mkEl('body'),
    addEventListener: (t, fn) => { if (t === 'click') handlers.click.push(fn); },
    activeElement: null, documentElement: { dataset: {} }
  },
  localStorage: {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; }
  },
  bootstrap: { Modal: FakeModal },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, confirm: () => true
};
sandbox.document.body.dataset.page = 'banks';   /* 测试跑主界面+选题页的启动逻辑 */
sandbox.window = sandbox;                 // app.data.js 里用 window.BANKS
vm.createContext(sandbox);
vm.runInContext(dataSrc + '\n' + logicSrc + `
globalThis.__hook = { S, stats, isCorrect, hasAnswer, startSession, pickKey, submitCurrent, redoCurrent,
  jump, go, step, finish, pickBank, doLogin, retryWrong,
  tickAuto, QMAP, BANKS, bankById, bankQuestionIds, LETTERS, render, renderQuiz, roundDone,
  store, KEY, userOf, users, userTable, migrateUsers, roundsOf, pushRound,
  favIds, isFav, toggleFavId, toggleFav,
  wrongIds, sanitizeSession, historyOf, loadProgress, lastName,
  applyTheme, theme, toggleTheme, navTargetScroll, scrollNavToCurrent, toggleQmap, restoreQmapScroll, pageMode,
  QINDEX, chipCounts, refreshSetup, scopeBaseIds,
  getAuto: () => autoJump,
  exportPng, shareCardHtml, shareRecord, dateStamp,
  getToast: () => toastEl.textContent,
  shareHtml: () => shareBodyEl.innerHTML,
  shareShown: () => shareModalEl.classList.contains('show'),
  };`, sandbox);
const H = sandbox.__hook;

let pass = 0, fail = 0;
const ok = (name, cond) => cond ? (pass++, console.log('  \u2713 ' + name))
                                : (fail++, console.log('  \u2717 ' + name));
const section = t => console.log('\n' + t);
/* 真的走一遍 app.js 注册的事件委托 */
const fire = (act, data) => {
  const el = mkEl('clicked');
  el.dataset = Object.assign({ act }, data || {});
  handlers.click.forEach(fn => fn({ target: el }));
  return el;
};

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

section('11. 「下一题」= 提交 + 判题');
H.S.view = 'setup';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.mode = 'order';
H.startSession();
const ord = H.S.session.order;
const wrongOf11 = q => H.LETTERS.split('').slice(0, q.options.length).find(k => q.answer.indexOf(k) < 0);

/* 答对：提交后立即进入下一题 */
const sIdx = ord.findIndex(id => H.QMAP[id].type === 'single');
H.jump(sIdx);
H.pickKey(H.QMAP[ord[sIdx]].answer[0]);
H.step(1);
ok('单选答对：提交本题并立即进入下一题',
   H.S.session.submitted[ord[sIdx]] === true && H.S.session.idx === sIdx + 1);
ok('单选答对：不留下自动跳转倒计时', H.getAuto() === null);

/* 答错：与「提交答案」完全一致 */
const wIdx2 = ord.findIndex((id, i) => i > sIdx + 1 && H.QMAP[id].type === 'single');
H.jump(wIdx2);
H.pickKey(wrongOf11(H.QMAP[ord[wIdx2]]));
H.step(1);
ok('单选答错：提交后留在本题看解析',
   H.S.session.submitted[ord[wIdx2]] === true && H.S.session.idx === wIdx2);
ok('单选答错：和提交答案一样启动 10 秒自动跳转',
   !!H.getAuto() && H.getAuto().sec === 10 && H.getAuto().target === wIdx2 + 1);

/* 没作答：直接切题 */
const uIdx = ord.findIndex((id, i) => i > wIdx2 + 1 && H.QMAP[id].type === 'single');
H.jump(uIdx);
H.step(1);
ok('没作答：直接进入下一题，不提交也不算错',
   !H.S.session.submitted[ord[uIdx]] && H.S.session.idx === uIdx + 1);

/* 多选答对：同样直接走 */
const m11a = ord.findIndex((id, i) => i > uIdx + 1 && H.QMAP[id].type === 'multiple');
H.jump(mIdx);
H.QMAP[ord[m11a]].answer.forEach(k => H.pickKey(k));
H.step(1);
ok('多选答对：提交并立即进入下一题',
   H.S.session.submitted[ord[m11a]] === true && H.S.session.idx === m11a + 1);

/* 多选答错：留在本题 */
const m11b = ord.findIndex((id, i) => i > m11a + 1 && H.QMAP[id].type === 'multiple');
H.jump(m11b);
H.pickKey(H.QMAP[ord[m11b]].answer[0]);
H.step(1);
ok('多选答错：留在本题并锁定答案',
   H.S.session.submitted[ord[m11b]] === true && H.S.session.idx === m11b);
H.step(1);
ok('已提交后：再点下一题直接前进', H.S.session.idx === m11b + 1);

/* 上一题：不会顺手提交 */
const backIdx = ord.findIndex((id, i) => i > m11b + 1 && H.QMAP[id].type === 'single');
H.jump(backIdx);
H.pickKey(wrongOf11(H.QMAP[ord[backIdx]]));
H.step(-1);
ok('上一题：只回退，不提交', H.S.session.idx === backIdx - 1 && !H.S.session.submitted[ord[backIdx]]);

section('12. 提交后 3 秒 / 10 秒自动跳转');
H.startSession();
const ord2 = H.S.session.order;
const wrongKeyOf = q => H.LETTERS.split('').slice(0, q.options.length).find(k => q.answer.indexOf(k) < 0);

H.jump(0);
H.pickKey(H.QMAP[ord2[0]].answer[0]);
H.submitCurrent();
let auto = H.getAuto();
ok('答对：3 秒后跳转', !!auto && auto.sec === 3 && auto.target === 1 && auto.qid === ord2[0]);
ok('倒计时期间页面显示剩余秒数', H.S.session.submitted[ord2[0]] === true);

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


/* ===================== 本轮三项 ===================== */

section('18. 答题卡右侧的展开按钮');
H.S.user = '小明'; H.S.view = 'setup'; H.S.bankId = 'web';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.wrongOnly = false;
H.startSession();
ok('新一局默认收起', H.S.qmapOpen === false);
ok('答题卡容器旁边有展开按钮', els['app'].innerHTML.indexOf('data-act="qmap-toggle"') >= 0 &&
   els['app'].innerHTML.indexOf('qmap-wrap') >= 0);
fire('qmap-toggle');
ok('点一下展开成多行网格', H.S.qmapOpen === true && els['app'].innerHTML.indexOf('qmap open') >= 0);
fire('qmap-toggle');
ok('再点一下收起', H.S.qmapOpen === false && els['app'].innerHTML.indexOf('qmap open') === -1);

section('19. 答对绿色与选项字母方块一致');
const cssSrc = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
ok('.qmap b.ok 与 .opt.ok .k 用的是同一个实心 success 绿',
   /\.qmap b\.ok\{[^}]*background:var\(--bs-success\)[^}]*color:var\(--bs-white\)/.test(cssSrc) &&
   /\.opt\.ok \.k\{[^}]*background:var\(--bs-success\)/.test(cssSrc));
ok('展开态是多行网格（flex-wrap）', /\.qmap\.open\{[^}]*flex-wrap:wrap/.test(cssSrc));

section('20. 导出 PNG 分享图');
H.startSession();
H.jump(0);
H.QMAP[H.S.session.order[0]].answer.forEach(k => H.pickKey(k));
H.submitCurrent(false);
H.finish();
const rec = H.shareRecord();
ok('分享卡数据齐全（总题/答对/答错/未答/正确率）',
   rec.total === H.S.session.order.length && typeof rec.rate === 'number' &&
   rec.correct + rec.wrong === rec.total - rec.unanswered);
const card = H.shareCardHtml(rec);
ok('分享卡里有品牌与四项统计', card.indexOf('popipa') >= 0 && card.indexOf('总题数') >= 0 &&
   card.indexOf('答对') >= 0 && card.indexOf('答错') >= 0 && card.indexOf('未答') >= 0);
let threwPng = null;
try { H.exportPng(); } catch (e) { threwPng = e; }
ok('html2canvas 缺失时不出异常', threwPng === null);
ok('并给出可读提示', H.getToast().indexOf('分享图') >= 0);
/* 装上假 html2canvas，验证成功路径（同步 thenable，方便断言） */
sandbox.html2canvas = () => ({
  then(cb) { cb({ toDataURL: () => 'data:image/png;base64,AAA' }); return { catch() {} }; }
});
H.exportPng();
ok('生成后弹出预览 Modal', H.shareShown() === true);
ok('预览里是 PNG dataURL', H.shareHtml().indexOf('data:image/png;base64') >= 0);
ok('预览里有下载按钮', H.shareHtml().indexOf('download="popipa-') >= 0);


/* ===================== 分支 B：用户表拆分 ===================== */

section('21. 用户表只记身份，业务数据进每用户表');
const idx = H.users();
ok('用户表条目只有 name / lastLogin',
   Object.keys(idx['小明']).sort().join(',') === 'lastLogin,name');
const t13 = H.userTable('小明');
ok('每用户表里有主题/进度/错题/收藏/成绩/逐轮记录',
   ['theme','books','wrong','fav','history','rounds'].every(k => k in t13));
ok('主题存在每用户表里', t13.theme === 'light' || t13.theme === 'dark');
ok('两张表合并后仍是完整用户',
   H.userOf('小明').lastLogin > 0 && Array.isArray(H.userOf('小明').history) &&
   Array.isArray(H.userOf('小明').rounds));

section('22. 逐轮记录：交卷落快照，回看数字不变');
const rounds = H.roundsOf('小明');
ok('已经落了逐轮记录', rounds.length >= 1);
const r0 = rounds[0];
ok('快照含逐题作答（题号/答案/提交状态）',
   Array.isArray(r0.order) && r0.order.length > 0 &&
   !!r0.answers && !!r0.submitted);
ok('快照含用时', typeof r0.seconds === 'number' && r0.seconds >= 0 &&
   typeof r0.startedAt === 'number' && typeof r0.finishedAt === 'number');
ok('快照含汇总（总题数/答对/答错/未答/正确率）',
   r0.total === r0.order.length && r0.correct + r0.wrong === r0.total - r0.unanswered &&
   typeof r0.rate === 'number' && typeof r0.score === 'number');
ok('快照是独立副本：改动当前会话不影响已存记录',
   (function () {
     const saved = JSON.stringify(r0.answers);
     H.S.session.answers[r0.order[0]] = ['__changed__'];
     const same = JSON.stringify(H.roundsOf('小明')[0].answers) === saved;
     delete H.S.session.answers[r0.order[0]];
     return same;
   })());

section('23. 旧结构迁移：业务字段搬进每用户表');
const legacy = {};
legacy['老用户'] = {
  name: '老用户', lastLogin: 123, theme: 'dark',
  books: { web: { order: ['x'] } }, wrong: { q1: 1 },
  history: [{ rate: 50 }], fav: { q2: 2 }
};
H.store.set(H.KEY.users, legacy);
H.migrateUsers();
ok('用户表只剩身份字段',
   Object.keys(H.users()['老用户']).sort().join(',') === 'lastLogin,name');
const tOld = H.userTable('老用户');
ok('主题/进度/错题/收藏/成绩都搬进了每用户表',
   tOld.theme === 'dark' && !!tOld.books.web && tOld.wrong.q1 === 1 &&
   tOld.fav.q2 === 2 && tOld.history.length === 1);
ok('再跑一次迁移不会重复搬', H.migrateUsers() === false);


section('24. 收藏写进每用户表，跨场次保留');
H.S.user = '小明'; H.S.view = 'setup'; H.S.bankId = 'web';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.wrongOnly = false;
H.startSession();
const favQid = H.S.session.order[0];
H.jump(0);
H.toggleFav();
ok('收藏写进了每用户表', H.isFav('小明', favQid) === true &&
   H.userTable('小明').fav[favQid] > 0);
ok('按题库统计收藏数', H.favIds('小明', 'web').indexOf(favQid) >= 0);
H.startSession();                                  /* 重开一局 */
H.jump(H.S.session.order.indexOf(favQid));
H.render();
ok('重开一局后星星还在', els['app'].innerHTML.indexOf('bi-star-fill') >= 0);
ok('stats() 的收藏数按用户表算', H.stats(H.S.session).fav === 1);
H.toggleFav();
ok('再点一次取消收藏', H.isFav('小明', favQid) === false);


section('25. 「再练一遍没做对的」入口');
H.S.user = '小明'; H.S.view = 'setup'; H.S.bankId = 'web';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.wrongOnly = false;
H.startSession();
const ord25 = H.S.session.order;
const w25 = ord25.findIndex(id => H.QMAP[id].type === 'single');
H.jump(w25);
H.pickKey(H.LETTERS.split('').slice(0, H.QMAP[ord25[w25]].options.length)
  .find(k => H.QMAP[ord25[w25]].answer.indexOf(k) < 0));
H.submitCurrent(false);
const wrongSet = H.S.session.order.filter(id =>
  H.S.session.submitted[id] && !H.isCorrect(H.QMAP[id], H.S.session.answers[id]));
const oldId = H.S.session.id;
H.finish();
ok('结果页有入口按钮', els['app'].innerHTML.indexOf('再练一遍没做对的') >= 0);
const oldRound = JSON.parse(JSON.stringify(H.roundsOf('小明')[0]));
fire('retry-wrong');
ok('进入新的一轮（新 session id）', H.S.view === 'quiz' && H.S.session.id !== oldId);
ok('新轮只含这一轮没做对的题',
   H.S.session.order.length === wrongSet.length &&
   H.S.session.order.every(id => wrongSet.indexOf(id) >= 0));
const stillOld = H.roundsOf('小明')[0];
ok('旧一轮的逐题记录与数字原样保留',
   stillOld.id === oldRound.id && stillOld.rate === oldRound.rate &&
   stillOld.correct === oldRound.correct && stillOld.wrong === oldRound.wrong &&
   JSON.stringify(stillOld.answers) === JSON.stringify(oldRound.answers));

section('26. 全对时入口置灰');
H.startSession();
const only = H.S.session.order[0];
H.S.session.order = [only];
H.S.session.answers = {}; H.S.session.submitted = {};
H.S.session.answers[only] = H.QMAP[only].answer.slice();
H.S.session.submitted[only] = true;
H.S.view = 'result';
H.render();
ok('没有答错的题时入口被禁用', /data-act="retry-wrong"[^>]*disabled/.test(els['app'].innerHTML));

section('27. 答题卡滑动位置保持');
H.S.view = 'setup'; H.S.bankId = 'web';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.startSession();
els['qmap'].scrollLeft = 480;
H.render();                                  /* 重绘前记住 480 */
ok('重绘前记住了滑动位置', H.S.qmapScroll === 480);
els['qmap'].scrollLeft = 0;                  /* 模拟整页重绘把位置冲成 0 */
H.renderQuiz();                              /* 只重绘答题页 */
ok('重绘后从上次位置继续，而不是从 0 滑过来', els['qmap'].scrollLeft === 480);

section('28. 展开键与答题卡等高');
ok('容器用 stretch 让按钮和 qmap 同高',
   /\.qmap-wrap\{[^}]*align-items:stretch/.test(cssSrc));
ok('按钮不再写死高度', /\.qmap-expand\{[^}]*height:auto/.test(cssSrc));
ok('按钮与 grid 内容框等高，底部留出滚动条位置',
   /\.qmap-wrap\{[^}]*padding:\.85rem 0 0/.test(cssSrc) &&
   /\.qmap\{[^}]*padding:0 2px 10px/.test(cssSrc));
ok('展开键不随滚动条区域一起下延', /\.qmap-expand\{[^}]*margin-bottom:10px/.test(cssSrc));


section('29. 最后一题只留一个交卷按钮');
H.S.user = '小明'; H.S.view = 'setup'; H.S.bankId = 'web';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.wrongOnly = false;
H.startSession();
const lastIdx = H.S.session.order.length - 1;
H.jump(lastIdx);
H.render();
let html29 = els['app'].innerHTML;
ok('最后一题只有一个交卷按钮',
   (html29.match(/data-act="finish"/g) || []).length === 1);
ok('不再出现「交卷看结果」', html29.indexOf('交卷看结果') === -1);
H.jump(0);
H.render();
html29 = els['app'].innerHTML;
ok('非最后一题仍有「下一题」和「交卷」',
   html29.indexOf('data-act="next"') >= 0 &&
   (html29.match(/data-act="finish"/g) || []).length === 1);

section('30. 展开态也自动定位（竖向 35%）');
H.S.qmapOpen = true;
const qm30 = els['qmap'];
qm30.getBoundingClientRect = () => ({ left: 0, top: 0 });
qm30.querySelector = () => ({ getBoundingClientRect: () => ({ left: 0, top: 600 }) });
qm30.clientHeight = 300;
qm30.scrollHeight = 1200;
qm30.scrollTop = 0;
H.scrollNavToCurrent();
ok('展开时把当前题竖向定位到 35%（600 - 300×0.35 = 495）', qm30.scrollTop === 495);
H.S.qmapOpen = false;

section('31. Toast 跟随主题 / 品牌可点回选题页');
ok('Toast 背景与文字跟随主题（不再反色）',
   /\.popipa-toast\{[^}]*background:var\(--bs-body-bg\)[^}]*color:var\(--bs-body-color\)/.test(cssSrc));
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
ok('品牌名绑定了返回选题页的动作',
   /navbar-brand[^>]*data-act="back-banks"/.test(htmlSrc));
H.S.view = 'banks';
fire('back-banks');
ok('已在选题页时点品牌无副作用', H.S.view === 'banks');
H.startSession();
fire('back-banks');
ok('答题中点品牌会回到选题页', H.S.view === 'banks');


section('32. 选题页重构');
H.S.user = '小明'; H.S.view = 'banks';
H.render();
const bh = els['app'].innerHTML;
ok('题目卡改成响应式网格', bh.indexOf('bank-grid') >= 0 &&
   (bh.match(/bank-card/g) || []).length >= H.BANKS.length);
ok('每张卡都能进入题库',
   (bh.match(/class="card bank-card"/g) || []).length === H.BANKS.length &&
   (bh.match(/data-act="pick-bank"/g) || []).length >= H.BANKS.length);
ok('卡片上有题数/章节/开始练习', bh.indexOf('开始练习') >= 0 && bh.indexOf(' 章') >= 0);
ok('卡片状态合并成一行', /class="bank-status"/.test(bh));
ok('未完成进度优先显示答到第 N 题', /答到第 \d+ 题 · \d+%/.test(bh));
ok('不再有独立的 .bank-progress', bh.indexOf('bank-progress') < 0);

section('33. rounds 回看：原地展开的逐题表格');
const r33 = H.roundsOf('小明')[0];
const ans33 = H.roundsOf('小明').reduce((n, r) =>
  n + r.order.filter(q => r.submitted[q]).length, 0);
H.S.roundOpen = {};
H.render();
const rh = els['app'].innerHTML;
ok('成绩历史列出轮次', rh.indexOf('我的成绩历史') >= 0 && rh.indexOf('round-card') >= 0);
ok('展开区是四列表格',
   rh.indexOf('题号') >= 0 && rh.indexOf('用户答案') >= 0 &&
   rh.indexOf('正确答案') >= 0 && rh.indexOf('解析') >= 0);
ok('明细只含已作答的题',
   (rh.match(/bi-(check|x)-circle-fill/g) || []).length === ans33);
ok('最后一行是汇总五数',
   rh.indexOf('round-sum') >= 0 && rh.indexOf('总题数') >= 0 &&
   rh.indexOf('答错') >= 0 && rh.indexOf('答对') >= 0 &&
   rh.indexOf('未答') >= 0 && rh.indexOf('正确率') >= 0);
fire('round-toggle', { round: r33.id });
ok('点击轮次会记录展开状态', H.S.roundOpen[r33.id] === true);
H.render();
ok('展开状态在重绘后保留', els['app'].innerHTML.indexOf('collapse show') >= 0);


section('34. 主题开关进 navbar / 组件定向更新');
ok('主题开关在 navbar 里（用户区之外，登录页也可见）',
   /id="themeBtn"[\s\S]{0,400}id="whoBox"/.test(htmlSrc));
ok('不再有独立浮动的主题按钮', htmlSrc.indexOf('class="theme-btn" id="themeBtn"') === -1);
H.S.user = null; H.S.view = 'login';
H.render();
ok('登录页也显示 navbar（品牌 + 主题），但隐藏用户区',
   els['top'].hidden === false && els['whoBox'].hidden === true);
H.S.user = '小明'; H.S.view = 'banks';
H.render();
ok('登录后显示用户区', els['whoBox'].hidden === false);

/* 收藏只改星星本身，不重绘整页 */
H.S.view = 'setup'; H.S.bankId = 'web';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.startSession();
const beforeHtml = els['app'].innerHTML;
H.toggleFav();
ok('收藏不触发整页重绘', els['app'].innerHTML === beforeHtml);


section('35. 组卷页重构 + 定向刷新');
H.S.user = '小明';
H.pickBank('web');
H.render();
const sh = els['app'].innerHTML;
ok('双栏布局：主面板 + 侧栏摘要',
   sh.indexOf('setup-grid') >= 0 && sh.indexOf('setup-side') >= 0);
ok('侧栏有题数与开始按钮',
   sh.indexOf('id="setupCount"') >= 0 && sh.indexOf('id="setupStart"') >= 0);
ok('章节 chip 带 aria 状态', /role="switch" aria-checked=/.test(sh));

const before35 = els['app'].innerHTML;
const ch35 = H.bankById('web').chapters[0].id;
const wasOn35 = H.S.chapters.indexOf(ch35) >= 0;
fire('toggle-chapter', { id: ch35 });
ok('章节切换是定向更新（不重绘整页）',
   els['app'].innerHTML === before35 &&
   (H.S.chapters.indexOf(ch35) >= 0) !== wasOn35);
fire('mode', { mode: 'random' });
ok('出题顺序也是定向更新', els['app'].innerHTML === before35 && H.S.mode === 'random');
H.S.mode = 'order';


section('36. qmap 关闭时先归位，不从最左侧滑');
const qmBox = mkEl('qmap');
qmBox.scrollLeft = 0;                 /* 展开时横向位置是 0 */
const qmBtn = mkEl('qmap-expand');
const qmWrap = mkEl('qmap-wrap');
qmWrap.querySelector = () => qmBtn;
const realQS = sandbox.document.querySelector;
const realGE = sandbox.document.getElementById;
sandbox.document.querySelector = () => qmWrap;
sandbox.document.getElementById = id => (id === 'qmap' ? qmBox : (els[id] || (els[id] = mkEl(id))));
H.S.qmapOpen = true;
H.S.qmapScroll = 480;                 /* 展开前记住的横向位置 */
H.toggleQmap();
ok('关闭时先瞬间回到上次位置，再定位当前题', qmBox.scrollLeft === 480);
ok('状态已切回收起', H.S.qmapOpen === false);
sandbox.document.querySelector = realQS;
sandbox.document.getElementById = realGE;


section('37. 页面拆分：index / banks / quiz');
const idxHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bankHtml = fs.readFileSync(path.join(root, 'banks.html'), 'utf8');
const quizHtml = fs.readFileSync(path.join(root, 'quiz.html'), 'utf8');
ok('index.html 是登录页', /<body[^>]*data-page="login"/.test(idxHtml));
ok('banks.html 是主界面 + 选题页', /<body[^>]*data-page="banks"/.test(bankHtml));
ok('quiz.html 是做题页', /<body[^>]*data-page="quiz"/.test(quizHtml));
ok('三页共用 navbar（品牌 + 主题开关）',
   [idxHtml, bankHtml, quizHtml].every(h =>
     h.indexOf('navbar-brand') >= 0 && h.indexOf('id="themeBtn"') >= 0));
ok('登录页初始隐藏用户区', /id="whoBox" hidden/.test(idxHtml));
ok('主题开关在用户区之外，登录页也可见',
   /id="themeBtn"[\s\S]{0,400}id="whoBox"/.test(idxHtml));
ok('用户区隐藏不会被 Bootstrap 的 .d-flex 盖掉',
   /#whoBox\[hidden\]\{display:none !important\}/.test(cssSrc));
ok('分享图组件只在做题页加载',
   quizHtml.indexOf('html2canvas') >= 0 &&
   bankHtml.indexOf('html2canvas') === -1 && idxHtml.indexOf('html2canvas') === -1);
ok('分享预览 Modal 只在做题页',
   quizHtml.indexOf('id="shareModal"') >= 0 &&
   bankHtml.indexOf('shareModal') === -1 && idxHtml.indexOf('shareModal') === -1);


section('38. 页面模式与本地服务器');
ok('HTTP 下走真实三页跳转', H.pageMode('http:') === 'pages');
ok('HTTPS 下也走真实跳转', H.pageMode('https:') === 'pages');
ok('file:// 下退回单页视图切换（跨页存储被隔离）', H.pageMode('file:') === 'spa');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
ok('仓库自带零依赖静态服务器', /createServer/.test(serverSrc) && /\.listen\(/.test(serverSrc));


section('39. 交卷先提交当前题');
H.S.user = '小明'; H.S.view = 'setup'; H.S.bankId = 'web';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.types = ['single', 'multiple', 'judge', 'fill'];
H.S.wrongOnly = false;
H.startSession();
const last39 = H.S.session.order.length - 1;
H.jump(last39);
const lastQid = H.S.session.order[last39];
H.pickKey(H.QMAP[lastQid].answer[0]);
ok('最后一题选了答案但没提交', !H.S.session.submitted[lastQid]);
fire('finish');
ok('交卷时先提交了这道题', H.S.session.submitted[lastQid] === true);
ok('然后正常进入结果页', H.S.view === 'result');
ok('逐轮记录里这道题算已作答',
   H.roundsOf('小明')[0].submitted[lastQid] === true);

section('40. 分享图落款');
const card40 = H.shareCardHtml(H.shareRecord());
ok('落款是「用户名 · 📢U咩哇帕瓦📢」（居中点分隔）',
   card40.indexOf('小明 · 📢U咩哇帕瓦📢') >= 0);
ok('旧落款已移除', card40.indexOf('刷题吧') === -1);

section('41. 组卷页按题型筛选');
H.S.view = 'setup'; H.S.bankId = 'web';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.types = ['single', 'multiple', 'judge', 'fill'];
H.S.wrongOnly = false;
H.render();
const setup41 = els['app'].innerHTML;
ok('组卷页同时有章节与题型分类',
   setup41.indexOf('id="chapterChips"') >= 0 && setup41.indexOf('id="typeChips"') >= 0);
ok('题型 chips 带切换动作',
   (setup41.match(/data-act="toggle-type"/g) || []).length === 4);
const singles41 = H.bankById('web').chapters.reduce((n, ch) =>
  n + ch.questions.filter(q => q.type === 'single' && q.answer.length).length, 0);
H.S.types = ['single'];
H.render();
H.startSession();
ok('只出选中的题型', H.S.session.order.every(id => H.QMAP[id].type === 'single'));
ok('题量与单选筛选一致', H.S.session.order.length === singles41);
H.S.view = 'setup'; H.render();
fire('toggle-type', { type: 'single' });
ok('点题型可取消选中', H.S.types.indexOf('single') === -1);


section('42. 页面动画');
ok('有入场动画关键帧', /@keyframes rise/.test(cssSrc) && /@keyframes popIn/.test(cssSrc));
ok('题库卡、组卷页、结果页有入场动画',
   /\.bank-card\{animation:rise/.test(cssSrc) &&
   /\.setup-grid,.score-hero,.grid,.rounds\{animation:rise/.test(cssSrc));
ok('按钮/选项保留按压反馈', /\.btn:active\{transform:scale/.test(cssSrc) &&
   /\.opt:active\{transform:scale/.test(cssSrc));
ok('答题阶段不闪：题目卡与当前题都没有动画',
   !/\.qcard\{animation/.test(cssSrc) && !/\.qmap b\.cur\{animation/.test(cssSrc) &&
   !/@keyframes qcur/.test(cssSrc));
ok('尊重“减少动态效果”偏好',
   /@media \(prefers-reduced-motion: reduce\)\{[\s\S]*animation:none !important/.test(cssSrc));


section('43. Toast 出现/消失动画');
const toastRule = (cssSrc.match(/\.popipa-toast\{[^}]*\}/) || [''])[0];
ok('Toast 的过渡包含透明度与位移',
   /transition:[^;}]*opacity/.test(toastRule) && /transform/.test(toastRule));
ok('通用颜色过渡没有覆盖 Toast 动画',
   !/body,\.navbar,\.popipa-toast\{transition/.test(cssSrc));
ok('Toast 有 .show 状态', /\.popipa-toast\.show\{opacity:1/.test(cssSrc));


section('44. 题库卡上的收藏集 / 错题集入口');
const wIds44 = H.bankQuestionIds(H.bankById('web'));
H.toggleFavId('小明', wIds44[0]);
H.toggleFavId('小明', wIds44[1]);
H.S.user = '小明'; H.S.view = 'banks';
H.render();
const bh44 = els['app'].innerHTML;
ok('题库卡有错题集和收藏入口',
   bh44.indexOf('data-scope="wrong"') >= 0 && bh44.indexOf('data-scope="fav"') >= 0);
ok('入口带题库 id（按题库分类）',
   /data-act="pick-bank" data-id="web" data-scope="fav"/.test(bh44));

/* 点收藏入口：先走「开始练习」同样的路径（进组卷页），并自动勾选收藏集 */
fire('pick-bank', { id: 'web', scope: 'fav' });
ok('收藏入口进入组卷页', H.S.view === 'setup');
ok('组卷页自动勾选收藏集', H.S.favOnly === true && H.S.wrongOnly === false);
H.startSession();
const favIds44 = H.favIds('小明', 'web');
ok('开练的题全部来自收藏', H.S.session.order.length === favIds44.length &&
   H.S.session.order.every(id => favIds44.indexOf(id) >= 0));

/* 造一道错题，再验证错题集入口 */
H.S.view = 'setup'; H.S.bankId = 'web';
H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.types = ['single', 'multiple', 'judge', 'fill'];
H.S.wrongOnly = false; H.S.favOnly = false;
H.startSession();
const wrongQ44 = H.S.session.order[0];
H.jump(0);
H.pickKey(H.LETTERS.split('').slice(0, H.QMAP[wrongQ44].options.length)
  .find(k => H.QMAP[wrongQ44].answer.indexOf(k) < 0));
H.submitCurrent(false);
H.finish();
fire('pick-bank', { id: 'web', scope: 'wrong' });
ok('错题入口进入组卷页并自动勾选错题集',
   H.S.view === 'setup' && H.S.wrongOnly === true && H.S.favOnly === false);
H.startSession();
ok('开练的题全部来自错题集',
   H.S.session.order.length > 0 &&
   H.S.session.order.every(id => H.wrongIds('小明', 'web').indexOf(id) >= 0));

/* 空收藏集：不硬勾选，退回按章节练 */
H.pickBank('java', 'fav');
ok('空收藏集时退回按章节练', H.S.favOnly === false && H.S.wrongOnly === false);


/* 收藏集内仍可按章节 + 题型再筛 */
const singles44 = H.bankQuestionIds(H.bankById('web')).filter(id => H.QMAP[id].type === 'single');
H.toggleFavId('小明', singles44[0]);
H.pickBank('web', 'fav');
const chapOf44 = id => id.replace(/-q\d+$/, '');
const ch44 = chapOf44(singles44[0]);
H.S.types = ['single'];
H.S.chapters = [ch44];
H.render();
const setup44 = els['app'].innerHTML;
ok('收藏集内章节/题型没有被禁用',
   !/data-act="toggle-chapter"[^>]*disabled/.test(setup44) &&
   !/data-act="toggle-type"[^>]*disabled/.test(setup44));
H.startSession();
const expect44 = H.favIds('小明', 'web').filter(id =>
  chapOf44(id) === ch44 && H.QMAP[id].type === 'single');
ok('收藏集内可按章节 + 题型再筛', expect44.length > 0 &&
   H.S.session.order.length === expect44.length &&
   H.S.session.order.every(id => expect44.indexOf(id) >= 0));

section('45. 题库描述与实际题数一致');
const TYPE_NAME45 = { single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题' };
for (const bank of H.BANKS) {
  const cnt = { single: 0, multiple: 0, judge: 0, fill: 0 };
  bank.chapters.forEach(ch => ch.questions.forEach(q => { cnt[q.type]++; }));
  const parts = ['single', 'multiple', 'judge', 'fill']
    .filter(t => cnt[t]).map(t => TYPE_NAME45[t] + ' ' + cnt[t]);
  const expected = bank.chapters.length + ' 个章节 · ' + parts.join(' + ');
  ok(bank.id + ' 的 desc 与实际题数一致', bank.desc === expected);
}


section('46. 卡片状态行：未完成优先，否则上次成绩');
const u46 = '状态行用户';
H.S.user = u46; H.S.view = 'banks'; H.render();
ok('没有任何记录时不显示状态行', !/class="bank-status"/.test(els['app'].innerHTML));
H.pickBank('java');
H.startSession();
H.S.view = 'banks'; H.render();
const st46a = els['app'].innerHTML;
ok('有未完成进度时显示「答到第 N 题 · x%」',
   /class="bank-status"[^>]*>[\s\S]{0,200}答到第 \d+ 题 · \d+%/.test(st46a));
ok('合并后不再有独立进度条', st46a.indexOf('bank-progress') < 0);
H.finish();
H.S.view = 'banks'; H.render();
const st46b = els['app'].innerHTML;
ok('进度清掉后显示「上次 xx%」',
   /class="bank-status"[^>]*>[\s\S]{0,200}上次 \d+%/.test(st46b));


section('47. 题库索引与 chips 就地刷新');
for (const bank of H.BANKS) {
  const idx = H.QINDEX[bank.id];
  const all = H.bankQuestionIds(bank);
  ok(bank.id + ' 索引总数与题库一致', idx.all.length === all.length);
  ok(bank.id + ' 索引可按题型拼回',
     ['single', 'multiple', 'judge', 'fill']
       .reduce((n, t) => n + idx.byType[t].length, 0) === idx.all.length);
  ok(bank.id + ' 索引可按章节拼回',
     bank.chapters.reduce((n, ch) => n + idx.byChapter[ch.id].length, 0) === idx.all.length);
}

const idxUser47 = '索引用户';
H.S.user = idxUser47; H.S.wrongOnly = false; H.S.favOnly = false;
H.S.bankId = 'web'; H.S.chapters = H.bankById('web').chapters.map(c => c.id);
H.S.types = ['single', 'multiple', 'judge', 'fill'];
const cc47 = H.chipCounts(H.bankById('web'));
const sumCh47 = H.bankById('web').chapters.reduce((n, ch) => n + (cc47.chapters[ch.id] || 0), 0);
ok('无集合时章节计数之和 = 可练题数', sumCh47 === H.QINDEX.web.all.length);
ok('无集合时题型计数之和 = 可练题数',
   ['single', 'multiple', 'judge', 'fill'].reduce((n, t) => n + (cc47.types[t] || 0), 0)
   === H.QINDEX.web.all.length);

H.S.types = ['single'];
const cc47b = H.chipCounts(H.bankById('web'));
const singles47 = H.QINDEX.web.byType.single.length;
ok('切换题型后章节计数按题型收缩',
   H.bankById('web').chapters.reduce((n, ch) => n + (cc47b.chapters[ch.id] || 0), 0) === singles47);
ok('题型计数仍按章节统计（不看题型勾选）',
   (cc47b.types.multiple || 0) > 0);

/* 切到收藏集：计数只算收藏题，且不重绘整页 */
const favQ47 = H.QINDEX.web.byType.single[0];
H.toggleFavId(idxUser47, favQ47);
H.pickBank('web', 'fav');
H.S.types = ['single', 'multiple', 'judge', 'fill'];
const cc47c = H.chipCounts(H.bankById('web'));
ok('收藏集下章节计数只算收藏题',
   H.bankById('web').chapters.reduce((n, ch) => n + (cc47c.chapters[ch.id] || 0), 0)
   === H.favIds(idxUser47, 'web').length);
ok('收藏集下题型计数只算收藏题',
   ['single', 'multiple', 'judge', 'fill'].reduce((n, t) => n + (cc47c.types[t] || 0), 0)
   === H.favIds(idxUser47, 'web').length);

/* refreshSetup 只改 span.n，不重绘：用假 DOM 节点直接断言 */
const span47 = { textContent: '' };
const chip47 = { dataset: { id: 'web-c1' }, classList: { toggle() {} },
  setAttribute() {}, querySelector: () => span47 };
els['chapterChips'] = { children: [chip47] };
H.S.types = ['single'];
H.refreshSetup();
ok('refreshSetup 就地更新 chip 的 span.n',
   span47.textContent === String(H.chipCounts(H.bankById('web')).chapters['web-c1'] || 0));

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
