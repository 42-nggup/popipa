/* =========================================================
   popipa · 演示页逻辑
   ---------------------------------------------------------
   模块划分（同一事实只写一处）：
     1. 工具函数        util
     2. 判分            grade   —— 全站唯一的对错判断来源
     3. 统计            stats   —— 由答题状态推导，不做累加
     4. 存储            store   —— localStorage
     5. 状态            S
     6. 渲染            renderLogin / renderBanks / renderSetup
                        / renderQuiz / renderResult
     7. 交互规则        rules   —— 未提交就切题怎么办 / 提交后自动跳转
     8. 事件与初始化
   ========================================================= */
'use strict';

/* 说明：本文件是一个整体脚本，所有函数共享同一个作用域，
   便于答题页 / 结果页 / 事件处理复用同一套判分与统计逻辑。 */

/* ============ 1. 工具函数 ============ */
/* ============ 0. 页面路由 ============
   index.html = 登录页；banks.html = 主界面 + 选题页；quiz.html = 做题页（含结果）。
   同一份 app.js 在三个页面复用，靠 body[data-page] 决定启动视图。 */
const PAGE = (document.body && document.body.dataset && document.body.dataset.page) || 'login';
/* file:// 下浏览器按文件隔离 localStorage（登录态传不过去），所以退回单页内切换；
   HTTP 下 localStorage 同源共享，才走真正的三页跳转。 */
function pageMode(protocol) { return protocol === 'file:' ? 'spa' : 'pages'; }
const FILE_MODE = pageMode(typeof location !== 'undefined' && location ? location.protocol : '') === 'spa';
function goPage(url, view) {
  if (!FILE_MODE && typeof location !== 'undefined' && location && typeof location.href === 'string') {
    location.href = url;
    return;
  }
  if (view) { S.view = view; render(); }
}
const app = document.getElementById('app');
const topbar = document.getElementById('top');
const toastEl = document.getElementById('toast');
const shareModalEl = document.getElementById('shareModal');
const shareBodyEl = document.getElementById('shareBody');

const TYPE_LABEL = {
  single: { text: '单选题', cls: '' },
  multiple: { text: '多选题', cls: 'm' },
  judge: { text: '判断题', cls: 'j' },
  fill: { text: '填空题', cls: 'f' }
};
const QTYPE_LIST = ['single', 'multiple', 'judge', 'fill'];
function selectedTypes() { return Array.isArray(S.types) ? S.types : QTYPE_LIST; }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* 轻量 Markdown 渲染：代码块 + 行内代码 + 加粗
   题库题干/选项里会出现 ```java 代码块、`code` 和 **强调**，统一在这里处理 */
function fmt(s) {
  const blocks = [];
  let out = String(s == null ? '' : s).replace(/```[^\n]*\n?([\s\S]*?)```/g, (m, code) => {
    blocks.push('<pre class="code"><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
    return '\u0000' + (blocks.length - 1) + '\u0000';
  });
  out = esc(out);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/[ \t]*\n[ \t]*/g, '<br>');
  return out.replace(/(?:<br>)*\u0000(\d+)\u0000(?:<br>)*/g, (m, i) => blocks[+i]);
}
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}
function fmtTime(ms) {
  if (ms == null || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? m + ' 分 ' + (s % 60) + ' 秒' : s + ' 秒';
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const LETTERS = 'ABCDEFGH';

/* ============ 2. 判分（唯一来源） ============ */
function norm(v) {
  return String(v == null ? '' : v).trim().toLowerCase()
    .replace(/\s+/g, '').replace(/[，,、;；]/g, '');
}
/* q: 题目；picked: 选择题为字母数组，填空题为字符串 */
function isCorrect(q, picked) {
  if (picked == null) return false;
  if (q.type === 'fill') {
    const s = Array.isArray(picked) ? picked.join('') : picked;
    if (!norm(s)) return false;
    return q.answer.some(a => norm(a) === norm(s));
  }
  const p = Array.isArray(picked) ? picked : [picked];
  if (p.length === 0 || p.length !== q.answer.length) return false;
  return p.slice().sort().join(',') === q.answer.slice().sort().join(',');
}
/* 题目是否已作答（用于"提交"前的校验） */
function hasAnswer(q, picked) {
  if (q.type === 'fill') {
    const s = Array.isArray(picked) ? picked.join('') : picked;
    return !!norm(s);
  }
  return Array.isArray(picked) && picked.length > 0;
}
/* 正确答案的可读文本，答题页与结果页共用 */
function answerText(q) {
  if (q.type === 'fill') return q.answer[0];
  return q.answer.map(k => k + '．' + (q.options[LETTERS.indexOf(k)] || '')).join('　');
}
function pickedText(q, picked) {
  if (!hasAnswer(q, picked)) return '未作答';
  if (q.type === 'fill') return Array.isArray(picked) ? picked.join('') : String(picked);
  return picked.slice().sort().join('、');
}

/* ============ 3. 统计（推导，不累加） ============ */
function stats(s) {
  let answered = 0, correct = 0, wrong = 0;
  s.order.forEach(id => {
    if (s.submitted[id]) {
      answered++;
      if (isCorrect(QMAP[id], s.answers[id])) correct++; else wrong++;
    }
  });
  const total = s.order.length;
  const fav = favCountIn(s.order);      /* 收藏是用户级的，不跟场次走 */
  return {
    total, answered, correct, wrong, fav,
    unanswered: total - answered,
    rate: answered ? Math.round(correct / answered * 100) : 0, // 正确率（按已作答）
    score: total ? Math.round(correct / total * 100) : 0       // 得分（按总题数）
  };
}

/* ============ 4. 存储（用户表） ============
   只维护两张表：
     popipa:users  用户表，一人一条：
                     name / lastLogin  最近一次谁登录了、什么时候
                     theme             这个用户用暗色还是浅色
                     books[banksId]    上次答到哪里（整个 session）
                     wrong[qid]        错题本，答对后自动移除
                     history[]         历次成绩
     popipa:last   最近一次登录的昵称（退出登录也不清，用于回填表单）
   之前那套 popipa:progress:<user>:<bank> 已经废弃：它不会校验题号，
   题库一换版本，残留的旧题号就会让 stats() 里的 QMAP[id] 变成 undefined
   而报错。现在统一收进用户表，并在读取时校验题号。 */
const KEY = {
  user: 'popipa:user',    /* 当前登录的是谁（退出登录会清）*/
  last: 'popipa:last',    /* 最近一次登录过谁（不清）*/
  users: 'popipa:users',  /* 用户表：只记 name / lastLogin */
  utable: 'popipa:u:',    /* 每个用户一张表：popipa:u:<昵称> */
  theme: 'popipa:theme'
};
/* 每用户表里放的业务数据：成绩、逐题记录、进度、用时、收藏 */
const USER_FIELDS = ['theme', 'books', 'wrong', 'fav', 'history', 'rounds'];
const ROUNDS_MAX = 20;
const store = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
/* 轻量化：清掉已经被取代的本机键。老版的进度是 popipa:progress:<用户>:<题库>，
   旧版"本机记录"是 popipa:records——现在都收进用户表了，留着只会占地方。 */
function clearLegacy() {
  const kill = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.indexOf('popipa:progress:') === 0 || k === 'popipa:records')) kill.push(k);
    }
    kill.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* 隐私模式下 localStorage 不可用，忽略 */ }
  return kill;
}

/* ---- 用户表 ---- */
function blankUser(name) {
  return {
    name: name, lastLogin: 0,
    theme: null,        /* 明暗主题 */
    books: {},          /* 进度：每个题库上次答到哪里 */
    wrong: {},          /* 错题本 */
    fav: {},            /* 收藏 */
    history: [],        /* 成绩摘要 */
    rounds: []          /* 逐轮记录：逐题作答 + 用时 + 汇总 */
  };
}
function users() {
  const u = store.get(KEY.users, {});
  return u && typeof u === 'object' && !Array.isArray(u) ? u : {};
}
function userTable(name) { return store.get(KEY.utable + name, {}); }
function saveUserTable(name, t) { store.set(KEY.utable + name, t); }
function userOf(name) {
  if (!name) return blankUser(null);
  const rec = users()[name] || {};
  const t = userTable(name);
  const base = blankUser(name);
  /* 补齐字段，旧数据少字段也不会崩 */
  return Object.assign(base, t, {
    name: name,
    lastLogin: rec.lastLogin || 0,
    books: t.books && typeof t.books === 'object' ? t.books : {},
    wrong: t.wrong && typeof t.wrong === 'object' ? t.wrong : {},
    fav: t.fav && typeof t.fav === 'object' ? t.fav : {},
    history: Array.isArray(t.history) ? t.history : [],
    rounds: Array.isArray(t.rounds) ? t.rounds : []
  });
}
function saveUser(name, u) {
  if (!name) return;
  /* 用户表只留身份信息 */
  const all = users();
  all[name] = { name: name, lastLogin: u.lastLogin || 0 };
  store.set(KEY.users, all);
  /* 其余全部写进这个用户自己的表 */
  const t = {};
  USER_FIELDS.forEach(k => { t[k] = u[k]; });
  saveUserTable(name, t);
}
/* 旧结构迁移：业务字段从 popipa:users 搬到 popipa:u:<昵称>，用户表只留身份 */
function migrateUsers() {
  const all = users();
  let changed = false;
  Object.keys(all).forEach(name => {
    const rec = all[name];
    if (!rec || typeof rec !== 'object') return;
    const t = userTable(name);
    let moved = false;
    USER_FIELDS.forEach(k => {
      if (rec[k] !== undefined) {
        if (t[k] === undefined) t[k] = rec[k];
        delete rec[k];
        moved = true;
      }
    });
    if (moved) {
      saveUserTable(name, t);
      all[name] = { name: rec.name || name, lastLogin: rec.lastLogin || 0 };
      changed = true;
    }
  });
  if (changed) store.set(KEY.users, all);
  return changed;
}
/* 登录：记下"最近一次谁登录了" */
function rememberLogin(name) {
  const u = userOf(name);
  u.name = name;
  u.lastLogin = Date.now();
  saveUser(name, u);
  store.set(KEY.user, name);
  store.set(KEY.last, name);
  return u;
}
function lastName() {
  const v = store.get(KEY.last, null);
  return v == null || v === '' ? null : String(v);
}

/* ---- 答题进度 ---- */
function saveProgress() {
  if (!S.user || !S.session) return;
  const u = userOf(S.user);
  u.books[S.session.bankId] = S.session;
  saveUser(S.user, u);
}
function clearProgress(bankId) {
  if (!S.user) return;
  const u = userOf(S.user);
  delete u.books[bankId];
  saveUser(S.user, u);
}
/* 读取进度时按当前题库校验题号：换题库 / 换版本后残留的旧题号必须丢掉，
   否则 QMAP[id] 是 undefined，一进选题页就会报错（用户名 "11" 那个 bug）。*/
function sanitizeSession(p, bankId) {
  if (!p || !Array.isArray(p.order)) return null;
  const order = p.order.filter(id => QMAP[id] && QPOS[id].bankId === bankId);
  if (!order.length) return null;
  const keep = {};
  order.forEach(id => { keep[id] = 1; });
  const pick = obj => {
    const out = {};
    Object.keys(obj || {}).forEach(id => { if (keep[id]) out[id] = obj[id]; });
    return out;
  };
  const s = Object.assign({}, p, {
    order: order, answers: pick(p.answers), submitted: pick(p.submitted), fav: pick(p.fav)
  });
  s.idx = Math.min(Math.max(0, s.idx | 0), order.length - 1);
  s.finished = false;
  return s;
}
function loadProgress(user, bankId) {
  return sanitizeSession(userOf(user).books[bankId], bankId);
}

/* ---- 错题本：答错的记下，答对的移除，所以它只会随着刷题变小 ---- */
function wrongIds(user, bankId) {
  const w = userOf(user).wrong;
  return Object.keys(w).filter(id => QMAP[id] && (!bankId || QPOS[id].bankId === bankId));
}
function syncWrong(user, session) {
  const u = userOf(user);
  const now = Date.now();
  session.order.forEach(id => {
    if (!session.submitted[id]) return;
    if (isCorrect(QMAP[id], session.answers[id])) delete u.wrong[id];
    else u.wrong[id] = now;
  });
  saveUser(user, u);
}

/* ---- 收藏：存在每用户表里，跨场次保留（答对答错都不掉）---- */
/* 当前范围的基础集合：错题集 / 收藏集 / 整个题库（走索引） */
function scopeBaseIds(bank) {
  if (S.wrongOnly) return wrongIds(S.user, bank.id);
  if (S.favOnly) return favIds(S.user, bank.id);
  return QINDEX[bank.id] ? QINDEX[bank.id].all : bankQuestionIds(bank);
}
/* chips 上的可用题数（交叉计数）：
   - 章节 n：当前集合 + 已选题型下，这一章有多少题（不看章节是否勾选）
   - 题型 n：当前集合 + 已选章节下，这一题型有多少题（不看题型是否勾选） */
function chipCounts(bank) {
  const base = scopeBaseIds(bank);
  const types = selectedTypes();
  const chapters = {}, byType = {};
  base.forEach(id => {
    const q = QMAP[id], pos = QPOS[id];
    if (!q || !pos) return;
    if (types.indexOf(q.type) >= 0) {
      chapters[pos.chapterId] = (chapters[pos.chapterId] || 0) + 1;
    }
    if (S.chapters.indexOf(pos.chapterId) >= 0) {
      byType[q.type] = (byType[q.type] || 0) + 1;
    }
  });
  return { chapters, types: byType };
}

/* 收藏集/错题集里再按当前选中的章节与题型过滤 */
function collectionIds(bankId) {
  const base = S.wrongOnly ? wrongIds(S.user, bankId)
    : S.favOnly ? favIds(S.user, bankId) : null;
  if (!base) return null;
  const types = selectedTypes();
  return base.filter(id => {
    const pos = QPOS[id], q = QMAP[id];
    return pos && q && S.chapters.indexOf(pos.chapterId) >= 0 && types.indexOf(q.type) >= 0;
  });
}
function favIds(user, bankId) {
  const f = userOf(user).fav;
  return Object.keys(f).filter(id => QMAP[id] && (!bankId || QPOS[id].bankId === bankId));
}
function isFav(user, qid) { return !!userOf(user).fav[qid]; }
function toggleFavId(user, qid) {
  const u = userOf(user);
  if (u.fav[qid]) delete u.fav[qid]; else u.fav[qid] = Date.now();
  saveUser(user, u);
  return !!u.fav[qid];
}
function favCountIn(order) {
  return S.user ? order.filter(id => isFav(S.user, id)).length : 0;
}

/* ---- 逐轮记录：每轮交卷时落一份快照（逐题作答 + 用时 + 汇总）----
   回看时数字直接取快照，不受题库改版影响。 */
function pushRound(user, session) {
  const st = stats(session);
  const u = userOf(user);
  const rec = {
    id: session.id,
    bankId: session.bankId, bankName: session.bankName,
    order: session.order.slice(),
    answers: Object.assign({}, session.answers),
    submitted: Object.assign({}, session.submitted),
    fav: Object.assign({}, session.fav),
    startedAt: session.startedAt,
    finishedAt: session.finishedAt || Date.now(),
    seconds: Math.round(((session.finishedAt || Date.now()) - session.startedAt) / 1000),
    total: st.total, correct: st.correct, wrong: st.wrong,
    unanswered: st.unanswered, rate: st.rate, score: st.score
  };
  u.rounds = [rec].concat(u.rounds || []).slice(0, ROUNDS_MAX);
  saveUser(user, u);
  return rec;
}
function roundsOf(user) { return userOf(user).rounds || []; }

/* ---- 成绩历史（现在是每人一份，不再是一个本机大杂烩）---- */
function historyOf(user) { return userOf(user).history; }
function pushHistory(user, rec) {
  const u = userOf(user);
  u.history = [rec].concat(u.history).slice(0, 20);
  saveUser(user, u);
}

/* ---- 主题：没登录时用本机默认，登录后用这个用户自己的 ---- */
function systemTheme() {
  return (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'dark' : 'light';
}
function theme() {
  const own = S.user ? userOf(S.user).theme : null;
  return own || store.get(KEY.theme, null) || systemTheme();
}
function applyTheme(t) {
  S.theme = t === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.bsTheme = S.theme;   /* Bootstrap 认这个属性 */
  store.set(KEY.theme, S.theme);          /* 本机默认值，登录页也用它 */
  if (S.user) { const u = userOf(S.user); u.theme = S.theme; saveUser(S.user, u); }
  renderThemeBtn();
}
function toggleTheme() {
  applyTheme(theme() === 'dark' ? 'light' : 'dark');
  toast(S.theme === 'dark' ? '已切到深色' : '已切到浅色');
}

/* ============ 5. 题库索引与状态 ============ */
const QMAP = {};   // qid -> Question
const QPOS = {};   // qid -> { bankId, bankName, chapterId, chapterName }
(BANKS || []).forEach(bank => {
  bank.chapters.forEach(ch => {
    ch.questions.forEach(q => {
      QMAP[q.id] = q;
      QPOS[q.id] = { bankId: bank.id, bankName: bank.name, chapterId: ch.id, chapterName: ch.name };
    });
  });
});

/* 题库索引：bankId -> { all, byChapter, byType }，值都是题号数组。
   组卷页筛选、chips 计数都走这里，不再每次遍历全题库。 */
const QINDEX = {};
(BANKS || []).forEach(bank => {
  const idx = { all: [], byChapter: {}, byType: {} };
  QTYPE_LIST.forEach(t => { idx.byType[t] = []; });
  bank.chapters.forEach(ch => {
    const arr = idx.byChapter[ch.id] = [];
    ch.questions.forEach(q => {
      if (!q.answer.length) return;
      arr.push(q.id);
      idx.all.push(q.id);
      if (idx.byType[q.type]) idx.byType[q.type].push(q.id);
    });
  });
  QINDEX[bank.id] = idx;
});
function bankById(id) { return (BANKS || []).find(b => b.id === id); }
function bankQuestionIds(bank) {
  /* 只返回可判分的题（答案缺失的脏数据不进入练习，另行提示） */
  const ids = [];
  bank.chapters.forEach(ch => ch.questions.forEach(q => { if (q.answer.length) ids.push(q.id); }));
  return ids;
}
/* 题库图标：题库 JSON 里存的是 emoji，这里统一映射到 Bootstrap Icons */
function bankIcon(id) {
  return ({ java: 'bi-cup-hot', web: 'bi-window-stack' })[id] || 'bi-collection';
}
function countLegacy(bank) {
  let n = 0;
  bank.chapters.forEach(ch => ch.questions.forEach(q => { if (!q.answer.length) n++; }));
  return n;
}

/* 当前登录的是谁。老数据里可能是数字（比如以前把 11 存成了 number），
   统一转成字符串，免得后面 S.user.slice 之类的地方挂掉 */
function nameOrNull(v) { return v == null || v === '' ? null : String(v); }

const S = {
  user: nameOrNull(store.get(KEY.user, null)),
  view: 'login',
  bankId: null,
  chapters: [],       // 组卷时选中的章节
  types: QTYPE_LIST.slice(),   // 组卷时选中的题型
  mode: 'order',      // order | random
  wrongOnly: false,   // 只练错题集
  favOnly: false,     // 只练收藏集
  theme: 'light',
  session: null,
  reviewTab: 'all',
  reviewOpen: {},
  roundOpen: {},     // 选题页：展开的历史轮次
  qmapOpen: false,   // 答题卡是否展开成多行网格
  qmapScroll: 0,     // 答题卡上次的横向滑动位置
  finishAt: 0
};

/* 主题按钮放在 #app 外面，所以所有页面都在同一个位置 */
function renderThemeBtn() {
  const btn = document.getElementById('themeBtn');
  if (!btn) return;
  const dark = S.theme === 'dark';
  const tip = dark ? '切换到浅色' : '切换到深色';
  btn.innerHTML = '<i class="bi ' + (dark ? 'bi-sun' : 'bi-moon-stars') + '"></i>';
  btn.title = tip;
  btn.setAttribute('aria-label', tip);
}

/* ============ 6. 渲染 ============ */
function render() {
  /* 切题会整页重绘，先把答题卡当前的滑动位置记下来，避免每次都从左端重新滑 */
  const qm = document.getElementById('qmap');
  if (qm && !S.qmapOpen && typeof qm.scrollLeft === 'number') S.qmapScroll = qm.scrollLeft;
  renderThemeBtn();
  if (S.view === 'login' || !S.user) return renderLogin();
  topbar.hidden = false;
  document.getElementById('whoBox').hidden = false;
  document.getElementById('whoName').textContent = S.user;
  document.getElementById('avatar').textContent = S.user.slice(0, 1).toUpperCase();
  if (S.view === 'banks') return renderBanks();
  if (S.view === 'setup') return renderSetup();
  if (S.view === 'quiz') return renderQuiz();
  if (S.view === 'result') return renderResult();
}

/* ---- 6.1 登录主页 ---- */
function renderLogin() {
  topbar.hidden = false;                       /* 登录页也保留顶栏：主题开关在 navbar 里 */
  document.getElementById('whoBox').hidden = true;
  const last = lastName();          /* 只用来回填昵称，不再列出"本机记录" */
  app.innerHTML =
    '<div class="hero">' +
      '<div class="logo-big"><i class="bi bi-lightning-charge-fill"></i></div>' +
      '<h1 class="fw-bold">popipa</h1>' +
      '<p class="text-body-secondary">挑一套题库，答完立刻知道对错，随时看得见自己的进度。</p>' +
    '</div>' +
    '<div class="card login-box shadow-sm">' +
      '<div class="card-body p-4">' +
        '<div class="mb-3 text-start">' +
          '<label class="form-label small fw-semibold" for="nick">你的昵称</label>' +
          '<input class="form-control" id="nick" maxlength="16" placeholder="例如：小明" autocomplete="off"' +
            (last ? ' value="' + esc(last) + '"' : '') + '>' +
          '<div class="invalid-feedback" id="nickErr">请输入 1~16 个字符的昵称</div>' +
        '</div>' +
        '<button class="btn btn-primary w-100" data-act="login">' +
          '<i class="bi bi-box-arrow-in-right me-1"></i>开始刷题</button>' +
      '</div>' +
    '</div>';
  const nick = document.getElementById('nick');
  if (nick) { nick.focus(); if (nick.select) nick.select(); }
}
function doLogin() {
  const nick = document.getElementById('nick');
  const err = document.getElementById('nickErr');
  const v = (nick.value || '').trim();
  if (!v || v.length > 16) {
    err.classList.add('d-block'); nick.classList.add('is-invalid'); nick.focus(); return;
  }
  err.classList.remove('d-block'); nick.classList.remove('is-invalid');
  S.user = v;
  rememberLogin(v);            /* 记下"最近一次谁登录了" */
  applyTheme(theme());         /* 换成这个用户自己的主题 */
  goPage('banks.html', 'banks');
}

/* ---- 6.2 选题界面 ---- */
function rateBadge(rate) {
  return rate >= 80 ? 'text-bg-success' : rate >= 60 ? 'text-bg-warning' : 'text-bg-danger';
}

/* ---- 6.2 选题界面 ---- */
function renderBanks() {
  const list = BANKS || [];
  const rounds = roundsOf(S.user);
  const totalQ = list.reduce((n, b) => n + bankQuestionIds(b).length, 0);
  const cards = list.map(bank => {
    const total = bankQuestionIds(bank).length;
    const legacy = countLegacy(bank);
    const prog = loadProgress(S.user, bank.id);
    const wrong = wrongIds(S.user, bank.id).length;
    const fav = favIds(S.user, bank.id).length;
    const mine = rounds.filter(r => r.bankId === bank.id);
    const last = mine[0];
    const counts = { single: 0, multiple: 0, judge: 0, fill: 0 };
    bank.chapters.forEach(ch => ch.questions.forEach(q => counts[q.type]++));
    const st = prog ? stats(prog) : null;
    const pct = st ? Math.round(st.answered / st.total * 100) : 0;
    return '<div class="card bank-card" data-act="pick-bank" data-id="' + bank.id + '">' +
      '<div class="card-body p-3 p-sm-4">' +
        '<div class="d-flex align-items-start gap-3">' +
          '<span class="bank-ico"><i class="bi ' + bankIcon(bank.id) + '"></i></span>' +
          '<div class="flex-grow-1 min-w-0">' +
            '<div class="d-flex align-items-center gap-2">' +
              '<h2 class="h6 fw-bold mb-0 text-truncate">' + esc(bank.name) + '</h2>' +
            '</div>' +
            '<div class="small text-body-secondary text-truncate">' + esc(bank.desc) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bank-meta">' +
          '<span><i class="bi bi-collection"></i>' + total + ' 题</span>' +
          '<span><i class="bi bi-list-ol"></i>' + bank.chapters.length + ' 章</span>' +
          '<span><i class="bi bi-ui-checks"></i>单选 ' + counts.single + ' · 多选 ' + counts.multiple +
            ' · 判断 ' + counts.judge + (counts.fill ? ' · 填空 ' + counts.fill : '') + '</span>' +
        '</div>' +
        (st
          ? '<div class="bank-status"><span class="small text-body-secondary">' +
              '<i class="bi bi-play-circle me-1"></i>答到第 ' + st.answered + ' 题 · ' + pct + '%</span></div>'
          : last
            ? '<div class="bank-status"><span class="badge rounded-pill ' + rateBadge(last.rate) + '">' +
                '上次 ' + last.rate + '%</span></div>'
            : '') +
        '<div class="d-flex flex-wrap align-items-center gap-1 mt-3">' +
          '<button class="btn btn-sm btn-outline-danger" data-act="pick-bank" data-id="' + bank.id +
            '" data-scope="wrong"' + (wrong ? '' : ' disabled') +
            ' title="' + (wrong ? '只练这本题库的错题集' : '错题集是空的') + '">' +
            '<i class="bi bi-journal-bookmark me-1"></i>错题集 ' + wrong + '</button>' +
          '<button class="btn btn-sm btn-outline-warning" data-act="pick-bank" data-id="' + bank.id +
            '" data-scope="fav"' + (fav ? '' : ' disabled') +
            ' title="' + (fav ? '只练这本题库的收藏' : '收藏是空的') + '">' +
            '<i class="bi bi-star me-1"></i>收藏 ' + fav + '</button>' +
          (legacy ? '<span class="badge rounded-pill text-bg-secondary">' +
            '<i class="bi bi-exclamation-triangle me-1"></i>' + legacy + ' 题缺答案</span>' : '') +
          '<span class="btn btn-sm btn-primary ms-auto">开始练习<i class="bi bi-arrow-right ms-1"></i></span>' +
        '</div>' +
      '</div></div>';
  }).join('');
  app.innerHTML =
    '<div class="banks-head">' +
      '<div><h1 class="h3 fw-bold mb-1">选择题库</h1>' +
      '<p class="text-body-secondary mb-0">共 ' + list.length + ' 个题库 · ' + totalQ + ' 道题</p></div>' +
      (rounds.length ? '<span class="badge rounded-pill text-bg-secondary">' +
        '<i class="bi bi-clock-history me-1"></i>已记录 ' + rounds.length + ' 轮</span>' : '') +
    '</div>' +
    '<div class="bank-grid">' + cards + '</div>' +
    renderRounds();
}

/* ---- 6.2.1 历史轮次回看（原地展开，不跳页）----
   只展示已作答的题：题号 / 用户答案 / 正确答案 / 解析；最后一行是汇总。
   题干解析现查 QMAP，查不到的题号跳过，但汇总数字仍取快照，保证"数字不变"。 */
function fmtWhen(ms) {
  const d = new Date(ms || 0), p = n => (n < 10 ? '0' : '') + n;
  return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function roundDone(r) {
  return (r.order || []).filter(qid => r.submitted && r.submitted[qid]);
}
function renderRoundBody(r) {
  const rows = roundDone(r).map(qid => {
    const q = QMAP[qid];
    if (!q) return '';
    const ok = isCorrect(q, r.answers[qid]);
    return '<tr>' +
      '<td class="text-body-secondary">' + (r.order.indexOf(qid) + 1) + '</td>' +
      '<td class="' + (ok ? '' : 'text-danger') + '">' + esc(pickedText(q, r.answers[qid])) +
        ' <i class="bi ' + (ok ? 'bi-check-circle-fill text-success' : 'bi-x-circle-fill text-danger') + '"></i></td>' +
      '<td class="text-success">' + esc(answerText(q).replace(/\s+/g, ' ').trim()) + '</td>' +
      '<td class="text-body-secondary">' + (q.analysis ? fmt(q.analysis) : '—') + '</td>' +
      '</tr>';
  }).join('');
  const sum = '<tr class="round-sum"><td colspan="4">' +
    '总题数 <b>' + r.total + '</b>　答错 <b class="text-danger">' + r.wrong + '</b>　' +
    '答对 <b class="text-success">' + r.correct + '</b>　未答 <b>' + r.unanswered + '</b>　' +
    '正确率 <b>' + r.rate + '%</b></td></tr>';
  return '<div class="table-responsive"><table class="table table-sm align-middle round-table mb-0">' +
    '<thead><tr><th style="width:4.5rem">题号</th><th style="width:9rem">用户答案</th>' +
    '<th style="width:9rem">正确答案</th><th>解析</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="4" class="text-body-secondary">这一轮没有作答记录</td></tr>') +
    sum + '</tbody></table></div>';
}
function renderRounds() {
  const list = roundsOf(S.user);
  if (!list.length) return '';
  const cards = list.map((r, i) => {
    const open = !!S.roundOpen[r.id];
    return '<div class="card round-card shadow-sm mb-2">' +
      '<div class="card-body py-2 d-flex flex-wrap align-items-center gap-2 gap-sm-3 round-head"' +
        ' data-act="round-toggle" data-round="' + esc(r.id) + '" data-bs-toggle="collapse"' +
        ' data-bs-target="#roundBody' + i + '" role="button"' +
        ' aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="roundBody' + i + '">' +
        '<span class="badge rounded-pill text-bg-secondary">' + esc(r.bankName) + '</span>' +
        '<span class="small text-body-secondary"><i class="bi bi-clock me-1"></i>' +
          fmtWhen(r.finishedAt || r.startedAt) + '</span>' +
        '<span class="small text-body-secondary">得分 ' + r.score + '</span>' +
        '<span class="small text-body-secondary">用时 ' + fmtTime((r.seconds || 0) * 1000) + '</span>' +
        '<span class="ms-auto d-flex align-items-center gap-2">' +
          '<b class="' + (r.rate >= 80 ? 'text-success' : r.rate >= 60 ? 'text-warning' : 'text-danger') + '">' +
            r.rate + '%</b>' +
          '<i class="bi ' + (open ? 'bi-chevron-up' : 'bi-chevron-down') +
            ' text-body-secondary round-cx"></i>' +
        '</span>' +
      '</div>' +
      '<div class="collapse' + (open ? ' show' : '') + '" id="roundBody' + i + '">' +
        '<div class="card-body pt-0">' + renderRoundBody(r) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  return '<section class="rounds">' +
    '<div class="d-flex align-items-baseline gap-2 mb-2 flex-wrap">' +
      '<h2 class="h6 fw-bold mb-0"><i class="bi bi-clock-history me-1"></i>我的成绩历史</h2>' +
      '<span class="small text-body-secondary">共 ' + list.length + ' 轮，点开看逐题记录</span>' +
    '</div>' + cards + '</section>';
}

function pickBank(id, scope) {
  const bank = bankById(id);
  if (!bank) return;
  const want = (scope === 'wrong' || scope === 'fav') ? scope : 'chapters';
  S.bankId = id;
  S.chapters = bank.chapters.map(c => c.id);
  S.types = QTYPE_LIST.slice();
  S.mode = 'order';
  S.wrongOnly = want === 'wrong' && wrongIds(S.user, id).length > 0;
  S.favOnly = want === 'fav' && favIds(S.user, id).length > 0;
  if (want === 'wrong' && !S.wrongOnly) toast('错题集是空的，先按章节练一练');
  if (want === 'fav' && !S.favOnly) toast('收藏集是空的，先刷几道题吧');
  S.view = 'setup';
  render();
}

/* ---- 6.3 组卷面板 ---- */
/* ---- 6.3 组卷面板 ---- */
function setupPicked(bank) {
  if (S.wrongOnly || S.favOnly) return collectionIds(bank.id).length;
  const types = selectedTypes();
  return bank.chapters.filter(ch => S.chapters.indexOf(ch.id) >= 0)
    .reduce((n, ch) => n + ch.questions.filter(q =>
      q.answer.length && types.indexOf(q.type) >= 0).length, 0);
}
/* 组卷页的开关都是定向刷新：只改相关类名/数字，不重绘整页 */
function refreshSetup() {
  const bank = bankById(S.bankId);
  if (!bank) return;
  const picked = setupPicked(bank);
  const byId = id => document.getElementById(id);
  const count = byId('setupCount');
  if (count) count.textContent = picked;
  const sel = byId('setupChapters');
  if (sel) sel.textContent = S.chapters.length;
  const startBtn = byId('setupStart');
  if (startBtn) startBtn.disabled = !picked;

  const range = byId('rangeChips');
  if (range && range.children) {
    const scope = S.wrongOnly ? 'wrong' : S.favOnly ? 'fav' : 'chapters';
    Array.prototype.forEach.call(range.children, b => {
      const on = b.dataset.scope === scope;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  const cc = chipCounts(bank);
  const chapters = byId('chapterChips');
  if (chapters && chapters.children) {
    Array.prototype.forEach.call(chapters.children, b => {
      const on = S.chapters.indexOf(b.dataset.id) >= 0;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      const n = b.querySelector && b.querySelector('.n');
      if (n) n.textContent = String(cc.chapters[b.dataset.id] || 0);
    });
  }
  const typeBox = byId('typeChips');
  if (typeBox && typeBox.children) {
    const types = selectedTypes();
    Array.prototype.forEach.call(typeBox.children, b => {
      const on = types.indexOf(b.dataset.type) >= 0;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      const n = b.querySelector && b.querySelector('.n');
      if (n) n.textContent = String(cc.types[b.dataset.type] || 0);
    });
  }
  const seg = byId('modeSeg');
  if (seg && seg.children) {
    Array.prototype.forEach.call(seg.children, b => {
      b.classList.toggle('on', b.dataset.mode === S.mode);
    });
  }
  const hint = byId('chapterHint');
  if (hint) hint.textContent = (S.wrongOnly || S.favOnly)
    ? '只练' + (S.wrongOnly ? '错题集' : '收藏集') + '，仍可再筛章节'
    : '只选中的章节会进入本次练习';
}
function renderSetup() {
  const bank = bankById(S.bankId);
  if (!bank) { S.view = 'banks'; return render(); }
  const wCount = wrongIds(S.user, bank.id).length;
  const favCount = favIds(S.user, bank.id).length;
  const collection = S.wrongOnly || S.favOnly;
  const prog = loadProgress(S.user, bank.id);
  const prev = prog ? stats(prog).answered : 0;
  const cc = chipCounts(bank);
  const typeChips = QTYPE_LIST.map(t => {
    const on = selectedTypes().indexOf(t) >= 0;
    const n = cc.types[t] || 0;
    return '<button class="chip' + (on ? ' on' : '') + '" data-act="toggle-type" data-type="' + t + '"' +
      ' role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' +
      '>' + TYPE_LABEL[t].text +
      '<span class="n">' + n + '</span></button>';
  }).join('');
  const chips = bank.chapters.map(ch => {
    const on = S.chapters.indexOf(ch.id) >= 0;
    return '<button class="chip' + (on ? ' on' : '') + '" data-act="toggle-chapter" data-id="' + ch.id + '"' +
      ' role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' +
      '>' + esc(ch.name) + '<span class="n">' + (cc.chapters[ch.id] || 0) + '</span></button>';
  }).join('');
  app.innerHTML =
    '<div class="setup-head">' +
      '<button class="btn btn-sm btn-outline-secondary" data-act="back-banks">' +
        '<i class="bi bi-arrow-left me-1"></i>题库</button>' +
      '<div class="ms-2 min-w-0">' +
        '<h1 class="h4 fw-bold mb-0 text-truncate">' + esc(bank.name) + '</h1>' +
        '<p class="small text-body-secondary mb-0">选择章节与出题顺序，然后开始</p>' +
      '</div>' +
    '</div>' +
    '<div class="setup-grid">' +
      '<div class="card setup-main shadow-sm"><div class="card-body p-4">' +
        '<section>' +
          '<h2 class="h6 fw-bold"><i class="bi bi-funnel me-1"></i>练习范围</h2>' +
          '<p class="hint">错题集会攒着答错的题、答对后自动移出；只练错题/收藏时，仍可按章节和题型再筛。</p>' +
          '<div class="chips" id="rangeChips">' +
            '<button class="chip' + (!collection ? ' on' : '') + '" data-act="wrong-only" data-scope="chapters"' +
              ' role="switch" aria-checked="' + (!collection ? 'true' : 'false') + '">按章节练</button>' +
            '<button class="chip' + (S.wrongOnly ? ' on' : '') + '" data-act="wrong-only" data-scope="wrong"' +
              ' role="switch" aria-checked="' + (S.wrongOnly ? 'true' : 'false') + '"' +
              (wCount ? '' : ' disabled') + '>只练错题集（' + wCount + ' 道）</button>' +
            '<button class="chip' + (S.favOnly ? ' on' : '') + '" data-act="wrong-only" data-scope="fav"' +
              ' role="switch" aria-checked="' + (S.favOnly ? 'true' : 'false') + '"' +
              (favCount ? '' : ' disabled') + '>只练收藏集（' + favCount + ' 道）</button>' +
          '</div>' +
        '</section>' +
        '<hr class="my-4">' +
        '<div class="row g-4">' +
          '<div class="col-md-6">' +
            '<section>' +
              '<div class="d-flex align-items-baseline gap-2 flex-wrap">' +
                '<h2 class="h6 fw-bold mb-0"><i class="bi bi-list-check me-1"></i>章节</h2>' +
                '<span class="small text-body-secondary" id="chapterHint">' +
                  ((S.wrongOnly || S.favOnly ? '只练' + (S.wrongOnly ? '错题集' : '收藏集') + '，仍可再筛章节' : '只选中的章节会进入本次练习')) + '</span>' +
              '</div>' +
              '<div class="chips mt-2" id="chapterChips">' + chips + '</div>' +
            '</section>' +
          '</div>' +
          '<div class="col-md-6">' +
            '<section>' +
              '<div class="d-flex align-items-baseline gap-2 flex-wrap">' +
                '<h2 class="h6 fw-bold mb-0"><i class="bi bi-ui-checks me-1"></i>题型</h2>' +
                '<span class="small text-body-secondary">只选中的题型会进入本次练习</span>' +
              '</div>' +
              '<div class="chips mt-2" id="typeChips">' + typeChips + '</div>' +
            '</section>' +
          '</div>' +
        '</div>' +
        '<hr class="my-4">' +
        '<section>' +
          '<h2 class="h6 fw-bold"><i class="bi bi-shuffle me-1"></i>出题顺序</h2>' +
          '<p class="hint">顺序即按题库原顺序；随机适合反复刷。</p>' +
          '<div class="seg" id="modeSeg">' +
            '<button class="' + (S.mode === 'order' ? 'on' : '') + '" data-act="mode" data-mode="order">' +
              '<i class="bi bi-list-ol me-1"></i>顺序</button>' +
            '<button class="' + (S.mode === 'random' ? 'on' : '') + '" data-act="mode" data-mode="random">' +
              '<i class="bi bi-shuffle me-1"></i>随机</button>' +
          '</div>' +
        '</section>' +
      '</div></div>' +
      '<aside class="card setup-side shadow-sm"><div class="card-body p-4">' +
        '<div class="setup-sum-label">本次将出</div>' +
        '<div class="setup-sum"><b id="setupCount">' + setupPicked(bank) + '</b> 道题</div>' +
        '<ul class="setup-facts">' +
          '<li><i class="bi bi-list-check"></i>已选章节 <b id="setupChapters">' + S.chapters.length + '</b> / ' +
            bank.chapters.length + '</li>' +
          '<li><i class="bi bi-journal-bookmark"></i>错题本 <b>' + wCount + '</b> 道</li>' +
          '<li><i class="bi bi-star"></i>收藏 <b>' + favCount + '</b> 道</li>' +
          (prog ? '<li><i class="bi bi-play-circle"></i>上次答到第 <b>' + prev + '</b> 题</li>' : '') +
        '</ul>' +
        '<button class="btn btn-primary w-100" data-act="start" id="setupStart"' +
          (setupPicked(bank) ? '' : ' disabled') + '>' +
          '<i class="bi bi-play-fill me-1"></i>开始答题</button>' +
        (prog ? '<button class="btn btn-outline-secondary w-100 mt-2" data-act="resume">' +
          '<i class="bi bi-play-fill me-1"></i>继续上次</button>' : '') +
        '<button class="btn btn-outline-secondary w-100 mt-2" data-act="back-banks">' +
          '<i class="bi bi-arrow-left me-1"></i>返回题库</button>' +
      '</div></aside>' +
    '</div>';
  refreshSetup();
}

/* ---- 6.4 组卷 / 开始练习 ---- */
function startSession() {
  const bank = bankById(S.bankId);
  if (!bank) { S.view = 'banks'; return render(); }
  let ids = [];
  if (S.wrongOnly || S.favOnly) {
    ids = collectionIds(bank.id);
    if (!ids.length) { toast('这个范围里没有题，换个章节或题型试试'); return; }
  } else {
    const types = selectedTypes();
    const idx = QINDEX[bank.id];
    S.chapters.forEach(chId => {
      (idx && idx.byChapter[chId] ? idx.byChapter[chId] : []).forEach(id => {
        if (types.indexOf(QMAP[id].type) >= 0) ids.push(id);
      });
    });
    if (!ids.length) { toast('请至少选择一个章节'); return; }
  }
  if (S.mode === 'random') ids = shuffle(ids);
  S.qmapOpen = false;
  S.qmapScroll = 0;                      /* 新一局答题卡默认收起 */
  S.session = {
    id: 's' + Date.now(),
    bankId: bank.id,
    bankName: bank.name + (S.wrongOnly ? ' · 错题集' : S.favOnly ? ' · 收藏集' : ''),
    chapters: S.chapters.slice(), types: selectedTypes().slice(), mode: S.mode,
    order: ids, idx: 0,
    answers: {}, submitted: {}, fav: {},
    startedAt: Date.now(), finishedAt: 0, finished: false
  };
  saveProgress();
  goPage('quiz.html?bank=' + encodeURIComponent(bank.id), 'quiz');
}
function resumeSession() {
  const p = loadProgress(S.user, S.bankId);
  if (!p) { toast('没有可继续的记录'); return; }
  p.finished = false;
  S.qmapOpen = false;
  S.qmapScroll = 0;
  S.session = p;
  goPage('quiz.html?bank=' + encodeURIComponent(S.bankId), 'quiz');
  toast('已回到上次的位置');
}

/* ---- 6.5 答题界面 ---- */
function renderQuiz() {
  const s = S.session;
  if (!s) { S.view = 'banks'; return render(); }
  const st = stats(s);
  const qid = s.order[s.idx];
  const q = QMAP[qid];
  const t = TYPE_LABEL[q.type];
  const done = !!s.submitted[qid];
  const picked = s.answers[qid];
  const ok = done && isCorrect(q, picked);

  /* 题干 + 作答区 */
  let body = '';
  if (q.type === 'fill') {
    const val = picked == null ? '' : (Array.isArray(picked) ? picked.join('') : picked);
    body = '<input class="fill' + (done ? ' locked' : '') + '" id="fill" data-fill ' +
      (done ? 'disabled' : '') + ' autocomplete="off" ' +
      'placeholder="在这里输入答案，回车提交" value="' + esc(val) + '">';
  } else {
    body = q.options.map((txt, i) => {
      const k = LETTERS[i];
      const sel = Array.isArray(picked) && picked.indexOf(k) >= 0;
      let cls = 'opt';
      if (done) {
        if (q.answer.indexOf(k) >= 0) cls += ' ok';
        else if (sel) cls += ' no';
        cls += ' locked';
      } else if (sel) cls += ' sel';
      return '<div class="' + cls + '" data-act="pick" data-key="' + k + '">' +
        '<span class="k">' + k + '</span><span class="t">' + fmt(txt) + '</span></div>';
    }).join('');
  }

  /* 判题反馈（答题页与结果页共用 answerText / pickedText） */
  let tip = '';
  if (done) {
    const counting = autoJump && autoJump.qid === qid;   // 只有刚提交、且还有下一题时才有倒计时
    tip = '<div class="alert ' + (ok ? 'alert-success' : 'alert-danger') + ' mt-3">' +
      '<div class="fw-bold">' + (ok ? '<i class="bi bi-check-circle-fill me-1"></i>答对了' : '<i class="bi bi-x-circle-fill me-1"></i>答错了') + '</div>' +
      (ok ? '' : '<div>正确答案：' + esc(answerText(q).replace(/\s+/g, ' ').trim()) + '</div>') +
      '<div class="small">你的答案：' + esc(pickedText(q, picked)) + '</div>' +
      (q.analysis ? '<div class="ana">解析：' + fmt(q.analysis) + '</div>' : '') +
      (counting ? '<div class="autojump"><i class="bi bi-hourglass-split me-1"></i><b id="autojump">' + autoJump.sec + '</b> 秒后自动进入下一题' +
        '<button class="btn btn-sm btn-outline-secondary" data-act="cancel-auto">取消跳转</button></div>' : '') +
      '</div>';
  }

  /* 答题卡：同一局且题数没变就复用已有节点——切题不重建格子，滚动位置也不丢 */
  let reuseMap = document.getElementById('qmap');
  if (reuseMap && (!reuseMap.children || reuseMap.children.length !== s.order.length ||
      reuseMap.dataset.session !== String(s.id))) reuseMap = null;
  if (reuseMap && reuseMap.parentNode) reuseMap.parentNode.removeChild(reuseMap);

  const nav = reuseMap ? '' : s.order.map((id, i) => {
    const d = !!s.submitted[id];
    const c = d ? (isCorrect(QMAP[id], s.answers[id]) ? 'ok' : 'no') : '';
    return '<b class="' + c + (i === s.idx ? ' cur' : '') + '" data-act="jump" data-i="' + i + '">' +
      (i + 1) + '</b>';
  }).join('');

  const isLast = s.idx === s.order.length - 1;
  const isFirst = s.idx === 0;

  app.innerHTML =
    '<div class="qbar">' +
      '<span class="stat">第 <b>' + (s.idx + 1) + '</b> / ' + s.order.length + ' 题</span>' +
      '<span class="stat"><i class="dot" style="background:var(--bs-secondary-bg)"></i>已答 <b>' + st.answered + '</b></span>' +
      '<span class="stat"><i class="dot" style="background:var(--bs-success)"></i>答对 <b>' + st.correct + '</b></span>' +
      '<span class="stat"><i class="dot" style="background:var(--bs-danger)"></i>答错 <b>' + st.wrong + '</b></span>' +
      '<span class="stat">正确率 <b>' + st.rate + '%</b></span>' +
      '<span class="stat" style="margin-left:auto"><i class="bi bi-stopwatch me-1"></i><b id="elapsed">0 秒</b></span>' +
    '</div>' +
    '<div class="progress mb-3" style="height:6px" role="progressbar" aria-label="答题进度">' +
      '<div class="progress-bar" style="width:' + (st.answered / st.total * 100) + '%"></div></div>' +
    '<div class="card qcard">' +
      '<div class="qhead">' +
        '<span class="badge ' + t.cls + '">' + t.text + '</span>' +
        '<span class="qno">' + esc(QPOS[qid].chapterName) + '</span>' +
        '<button class="fav ' + (isFav(S.user, qid) ? 'on' : '') + '" data-act="fav" title="收藏本题"' +
          ' aria-pressed="' + (isFav(S.user, qid) ? 'true' : 'false') + '">' +
          (isFav(S.user, qid) ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>') + '</button>' +
      '</div>' +
      '<h2 class="stem">' + fmt(q.stem) + '</h2>' +
      body + tip +
      '<div class="d-flex flex-wrap gap-2 mt-3">' +
        (done
          ? '<button class="btn btn-outline-secondary" data-act="redo">重做本题</button>'
          : '<button class="btn btn-primary flex-grow-1" data-act="submit">提交答案</button>') +
        '<button class="btn btn-outline-secondary" data-act="prev" ' + (isFirst ? 'disabled' : '') + '>上一题</button>' +
        (isLast
          /* 最后一题没有下一题：只留一个「交卷」，放在下一题的位置；不再重复放两个交卷按钮 */
          ? '<button class="btn btn-primary" data-act="finish">交卷</button>'
          : '<button class="btn btn-outline-secondary" data-act="next">下一题</button>' +
            '<button class="btn btn-outline-secondary" data-act="finish">交卷</button>') +
      '</div>' +
    '</div>' +
    '<div class="qmap-wrap' + (S.qmapOpen ? ' open' : '') + '">' +
      '<div class="qmap' + (S.qmapOpen ? ' open' : '') + '" id="qmap" data-session="' + esc(s.id) + '">' +
        nav + '</div>' +
      '<button class="qmap-expand" type="button" data-act="qmap-toggle"' +
        ' aria-expanded="' + (S.qmapOpen ? 'true' : 'false') + '"' +
        ' title="' + (S.qmapOpen ? '收起答题卡' : '展开答题卡') + '"' +
        ' aria-label="' + (S.qmapOpen ? '收起答题卡' : '展开答题卡') + '">' +
        '<i class="bi ' + (S.qmapOpen ? 'bi-chevron-up' : 'bi-chevron-down') + '"></i></button>' +
    '</div>' +
    '<div class="kbdhint">快捷键：<span class="kbd">←</span> <span class="kbd">→</span> 切题 · ' +
      '<span class="kbd">1</span>~<span class="kbd">4</span> 选项 · ' +
      '<span class="kbd">Enter</span> 提交 · <span class="kbd">F</span> 收藏</div>';
  /* 复用的节点重新插回去，只更新每个格子的状态类（结构不动） */
  if (reuseMap) {
    const slot = document.getElementById('qmap');
    if (slot && slot.parentNode) {
      reuseMap.className = 'qmap' + (S.qmapOpen ? ' open' : '');
      reuseMap.dataset.session = String(s.id);
      const kids = reuseMap.children;
      for (let i = 0; i < kids.length; i++) {
        const qid2 = s.order[i];
        kids[i].className = (s.submitted[qid2]
          ? (isCorrect(QMAP[qid2], s.answers[qid2]) ? 'ok' : 'no') : '') +
          (i === s.idx ? ' cur' : '');
      }
      slot.parentNode.replaceChild(reuseMap, slot);
    }
  }
  restoreQmapScroll();
  scrollNavToCurrent();
  tickTimer();
}

/* ---- 答题卡自动定位 ----
   把当前题滚到导航条“中部稍偏左”（35% 处）；
   两段到头时交给夹取，所以开头和结尾不会硬顶 */
const NAV_ANCHOR = 0.35;
function navTargetScroll(curLeft, boxW, totalW) {
  const max = totalW - boxW;
  if (max <= 0) return 0;
  return Math.max(0, Math.min(max, curLeft - boxW * NAV_ANCHOR));
}
/* 先把答题卡放回上次的滑动位置，再算"把当前题滑到 35%"的新目标：
   这样切换题目时是从上一次的位置继续平移，而不是每次都从最左边滑过来。 */
function restoreQmapScroll() {
  const box = document.getElementById('qmap');
  if (!box || S.qmapOpen || typeof box.scrollLeft !== 'number') return;
  const prev = S.qmapScroll || 0;
  if (!prev) return;
  const smooth = box.style ? box.style.scrollBehavior : '';
  if (box.style) box.style.scrollBehavior = 'auto';   /* 归位这一步不要动画 */
  box.scrollLeft = prev;
  void box.scrollWidth;                               /* 强制回流，后续动画从新位置起算 */
  if (box.style) box.style.scrollBehavior = smooth;
}
function scrollNavToCurrent() {
  const box = document.getElementById('qmap');
  if (!box || !box.querySelector || !box.getBoundingClientRect) return;
  const cur = box.querySelector('.cur');
  if (!cur || !cur.getBoundingClientRect) return;
  const boxRect = box.getBoundingClientRect();
  const curRect = cur.getBoundingClientRect();
  if (S.qmapOpen) {
    /* 展开态是多行网格：竖直方向用同一套 35% 规则，把当前题定位到可视区偏上 */
    const curTop = curRect.top - boxRect.top + (box.scrollTop || 0);
    box.scrollTop = navTargetScroll(curTop, box.clientHeight, box.scrollHeight);
  } else {
    const curLeft = curRect.left - boxRect.left + (box.scrollLeft || 0);
    box.scrollLeft = navTargetScroll(curLeft, box.clientWidth, box.scrollWidth);
  }
}

/* ---- 6.6 答题操作 ---- */
function pickKey(k) {
  const s = S.session, qid = s.order[s.idx], q = QMAP[qid];
  if (s.submitted[qid]) return;               /* 已提交则锁定，改不了也重复加分不了 */
  if (q.type === 'multiple') {
    const a = Array.isArray(s.answers[qid]) ? s.answers[qid].slice() : [];
    const i = a.indexOf(k);
    if (i >= 0) a.splice(i, 1); else a.push(k);
    s.answers[qid] = a;
  } else {
    s.answers[qid] = [k];                     /* 单选 / 判断：互斥 */
  }
  saveProgress();
  /* 只切选项的选中态，不重绘整页（避免答题时闪烁） */
  const opts = (typeof document.querySelectorAll === 'function')
    ? document.querySelectorAll('.opt[data-act="pick"]') : null;
  if (opts && opts.length) {
    Array.prototype.forEach.call(opts, el => {
      const key = el.dataset.key;
      const sel = Array.isArray(s.answers[qid]) && s.answers[qid].indexOf(key) >= 0;
      el.classList.toggle('sel', sel);
    });
  } else {
    render();
  }
}
/* 提交本题。arm 为 false 时不启动 3s/10s 自动跳转（用于「提交并继续」这类马上就要切题的场景） */
function submitCurrent(arm) {
  const s = S.session, qid = s.order[s.idx], q = QMAP[qid];
  if (s.submitted[qid]) return false;         /* 幂等：手抖多点几次，成绩不变 */
  if (!hasAnswer(q, s.answers[qid])) { toast('请先作答'); return false; }
  s.submitted[qid] = true;
  if (arm === false) autoJump = null; else armAuto();
  saveProgress();
  render();
  return true;
}
function redoCurrent() {
  const s = S.session, qid = s.order[s.idx];
  autoJump = null;
  delete s.submitted[qid];
  delete s.answers[qid];
  saveProgress();
  render();
  toast('已重置本题');
}
function toggleFav() {
  const s = S.session, qid = s.order[s.idx];
  const on = toggleFavId(S.user, qid);   /* 收藏记在每用户表，跨场次保留 */
  if (on) s.fav[qid] = true; else delete s.fav[qid];
  saveProgress();
  /* 只更新这颗星星，不重绘整页 */
  const btn = document.querySelector('.fav[data-act="fav"]');
  if (btn) {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.innerHTML = '<i class="bi ' + (on ? 'bi-star-fill' : 'bi-star') + '"></i>';
  }
  toast(on ? '已加入收藏' : '已取消收藏');
}
/* 答题卡展开/收起：只切 class 和箭头，不重绘整页 */
function toggleQmap() {
  const box0 = document.getElementById('qmap');
  /* 收起状态下先把当前横向位置记住，这样展开再关闭时能回到原处 */
  if (box0 && !S.qmapOpen && typeof box0.scrollLeft === 'number') S.qmapScroll = box0.scrollLeft;
  S.qmapOpen = !S.qmapOpen;
  const wrap = document.querySelector('.qmap-wrap');
  const box = document.getElementById('qmap');
  const btn = wrap && wrap.querySelector('.qmap-expand');
  if (!wrap || !box || !btn) { render(); return; }   /* 极端情况兜底 */
  wrap.classList.toggle('open', S.qmapOpen);
  box.classList.toggle('open', S.qmapOpen);
  btn.setAttribute('aria-expanded', S.qmapOpen ? 'true' : 'false');
  const tip = S.qmapOpen ? '收起答题卡' : '展开答题卡';
  btn.title = tip;
  btn.setAttribute('aria-label', tip);
  const icon = btn.querySelector('i');
  if (icon) icon.className = 'bi ' + (S.qmapOpen ? 'bi-chevron-up' : 'bi-chevron-down');
  /* 展开态是网格、没有横向滚动；关闭时先瞬间回到上次位置，再从这里滑向当前题 */
  if (!S.qmapOpen) restoreQmapScroll();
  scrollNavToCurrent();
}
function go(delta) {
  const s = S.session;
  const n = s.idx + delta;
  if (n < 0 || n >= s.order.length) return;   /* 边界检查，修掉原型越界的崩溃 */
  autoJump = null;
  s.idx = n;
  saveProgress();
  render();
}
function jump(i) {
  const s = S.session;
  if (i < 0 || i >= s.order.length) return;
  autoJump = null;
  s.idx = i;
  saveProgress();
  render();
}

/* ---- 6.6.1 规则一：选了答案但没提交就点「下一题」----
   单选题 / 判断题：自动提交（答案唯一，提交符合用户预期）
   多选题 / 填空题：先问一句，提示框上可以勾「不再提醒」       */
/* ---- 6.6.1 规则一：「下一题」= 提交 + 判题 ----
   没作答 / 已提交：直接切下一题；
   有答案但没提交：视同点「提交答案」——
     答对：提交后立刻进入下一题；
     答错：与提交答案完全一致（留在本题看正确答案与解析，10 秒后自动跳）。 */
function step(delta) {
  if (delta < 0) { go(delta); return; }
  const s = S.session, qid = s.order[s.idx], q = QMAP[qid];
  if (!s.submitted[qid] && hasAnswer(q, s.answers[qid])) {
    const correct = isCorrect(q, s.answers[qid]);
    submitCurrent();                 /* 走和「提交答案」同一条路径 */
    if (correct) { autoJump = null; go(1); }
    return;
  }
  go(delta);
}

/* ---- 6.6.2 规则二：提交后自动进入下一题（答对 3 秒，答错 10 秒）----
   计时器只存内存，任何一次切题 / 重做都会取消它；最后一题不自动跳，免得误触交卷 */
let autoJump = null;   /* { qid, target, sec, at } */
function armAuto() {
  const s = S.session, qid = s.order[s.idx];
  if (s.idx >= s.order.length - 1) { autoJump = null; return; }
  const sec = isCorrect(QMAP[qid], s.answers[qid]) ? 3 : 10;
  autoJump = { qid, target: s.idx + 1, sec, at: Date.now() + sec * 1000 };
}
function tickAuto() {
  if (!autoJump) return;
  if (S.view !== 'quiz' || !S.session) { autoJump = null; return; }
  const left = Math.max(0, Math.ceil((autoJump.at - Date.now()) / 1000));
  const el = document.getElementById('autojump');
  if (el) el.textContent = left;
  if (left <= 0) { const t = autoJump.target; autoJump = null; jump(t); }
}
/* 交卷：当前题有答案但没提交时，先按「提交答案」提交，再交卷；
   没作答或已提交则和「下一题」一样直接放行 */
function submitAndFinish() {
  const s = S.session;
  if (!s) return;
  const qid = s.order[s.idx], q = QMAP[qid];
  if (!s.submitted[qid] && hasAnswer(q, s.answers[qid])) submitCurrent(false);
  finish();
}
function finish() {
  autoJump = null;
  const s = S.session, st = stats(s);
  if (st.unanswered > 0 &&
      !confirm('还有 ' + st.unanswered + ' 题没有作答。未作答不计入正确率，确定交卷吗？')) { render(); return; }
  s.finished = true;
  s.finishedAt = Date.now();
  pushHistory(S.user, {
    bankName: s.bankName, total: st.total,
    correct: st.correct, wrong: st.wrong, rate: st.rate, score: st.score,
    seconds: Math.round((s.finishedAt - s.startedAt) / 1000),
    at: new Date().toISOString()
  });
  pushRound(S.user, s);      /* 逐轮记录：逐题作答 + 用时 + 汇总，供回看 */
  syncWrong(S.user, s);      /* 错题本：答错的记下，答对的移除 */
  clearProgress(s.bankId);   /* 交了卷就不再是"上次答到哪" */
  S.view = 'result';
  S.reviewTab = 'all';
  S.reviewOpen = {};
  render();
}

/* ---- 6.7 结果 / 分数统计界面 ---- */
function renderResult() {
  const s = S.session;
  if (!s) { S.view = 'banks'; return render(); }
  const st = stats(s);
  const used = (s.finishedAt || Date.now()) - s.startedAt;
  const tone = st.rate >= 80 ? 'success' : st.rate >= 60 ? 'warning' : 'danger';
  const color = 'var(--bs-' + tone + ')';          /* 环形图用实心色 */
  const toneText = 'var(--bs-' + tone + '-text-emphasis)';    /* 数字用文字色，深色下才够亮 */
  const deg = Math.round(st.rate * 3.6);
  const verdict = st.rate >= 80 ? '很稳，继续保持！' : st.rate >= 60 ? '及格线以上，再刷一遍更稳。' : '基础还需巩固，建议专攻错题。';

  const tabs = [
    ['all', '全部 ' + st.total],
    ['wrong', '错题 ' + st.wrong],
    ['unanswered', '未作答 ' + st.unanswered],
    ['fav', '收藏 ' + st.fav]
  ].map(([k, label]) =>
    '<li class="nav-item"><button class="nav-link ' + (S.reviewTab === k ? 'active' : '') + '" data-act="tab" data-tab="' + k + '">' +
    label + '</button></li>').join('');

  const ids = s.order.filter(qid => {
    if (S.reviewTab === 'wrong') return s.submitted[qid] && !isCorrect(QMAP[qid], s.answers[qid]);
    if (S.reviewTab === 'unanswered') return !s.submitted[qid];
    if (S.reviewTab === 'fav') return isFav(S.user, qid);
    return true;
  });

  const list = ids.length ? ids.map(qid => {
    const q = QMAP[qid];
    const n = s.order.indexOf(qid) + 1;
    const done = !!s.submitted[qid];
    const ok = done && isCorrect(q, s.answers[qid]);
    const stCls = !done ? 's' : ok ? 'y' : 'n';
    const stTxt = !done ? '未答' : ok ? '正确' : '错误';
    const open = !!S.reviewOpen[qid];
    return '<div class="card rev' + (open ? ' open' : '') + '">' +
      '<div class="rev-h" data-act="toggle-rev" data-qid="' + qid + '">' +
        '<span class="ix">第 ' + n + ' 题</span>' +
        '<span class="st ' + stCls + '">' + stTxt + '</span>' +
        '<span class="sm">' + esc(q.stem) + '</span>' +
        (isFav(S.user, qid) ? '<i class="bi bi-star-fill"></i>' : '') +
        '<i class="bi bi-chevron-down cx"></i>' +
      '</div>' +
      '<div class="rev-b">' +
        '<div class="q">' + fmt(q.stem) + '</div>' +
        '<div class="line">题型：' + TYPE_LABEL[q.type].text + '　章节：' + esc(QPOS[qid].chapterName) + '</div>' +
        '<div class="line">你的答案：<b>' + esc(pickedText(q, s.answers[qid])) + '</b></div>' +
        '<div class="line">正确答案：<b style="color:var(--bs-success-text-emphasis)">' +
          esc(answerText(q).replace(/\s+/g, ' ').trim()) + '</b></div>' +
        (q.analysis ? '<div class="line" style="margin-top:6px">解析：' + fmt(q.analysis) + '</div>' : '') +
      '</div></div>';
  }).join('') : '<div class="card empty"><div class="e-ico"><i class="bi bi-emoji-smile"></i></div>这个分类下没有题目</div>';

  app.innerHTML =
    '<h1>答题结果<span class="sub">' + esc(s.bankName) + ' · ' + esc(s.mode === 'random' ? '随机顺序' : '顺序作答') + '</span></h1>' +
    '<div class="card score-hero">' +
      '<div class="ring" style="background:conic-gradient(' + color + ' ' + deg + 'deg,var(--bs-secondary-bg) ' + deg + 'deg)">' +
        '<div class="in"><div><div class="v" style="color:' + toneText + '">' + st.rate + '%</div>' +
        '<div class="u">正确率</div></div></div>' +
      '</div>' +
      '<div class="hero-txt">' +
        '<h2>得分 ' + st.score + ' 分</h2>' +
        '<p>' + verdict + '　用时 ' + fmtTime(used) + '</p>' +
        '<div class="d-flex flex-wrap align-items-center gap-2 mt-3">' +
          '<button class="btn btn-outline-primary" data-act="retry-wrong"' +
            (st.wrong ? '' : ' disabled') +
            ' title="' + (st.wrong ? '把这一轮答错的题抽出来再练一遍' : '这一轮没有答错的题，不需要重练') + '">' +
            '<i class="bi bi-arrow-repeat me-1"></i>再练一遍没做对的</button>' +
          '<button class="btn btn-outline-secondary" data-act="again">再刷一遍</button>' +
          '<button class="btn btn-primary" data-act="share-png">' +
            '<i class="bi bi-download me-1"></i>导出分享图</button>' +
          '<button class="btn btn-outline-secondary" data-act="back-banks">返回题库</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="grid">' +
      '<div class="card num c-pri"><div class="v">' + st.total + '</div><div class="l">总题数</div></div>' +
      '<div class="card num"><div class="v">' + st.answered + '</div><div class="l">已作答</div></div>' +
      '<div class="card num c-ok"><div class="v">' + st.correct + '</div><div class="l">答对</div></div>' +
      '<div class="card num c-bad"><div class="v">' + st.wrong + '</div><div class="l">答错</div></div>' +
      '<div class="card num c-mut"><div class="v">' + st.unanswered + '</div><div class="l">未作答</div></div>' +
      '<div class="card num"><div class="v">' + st.fav + '</div><div class="l">收藏</div></div>' +
    '</div>' +
    '<ul class="nav nav-pills gap-1 my-4">' + tabs + '</ul>' +
    list;
}
function retryWrong() {
  const s = S.session;
  autoJump = null;
  S.qmapOpen = false;
  S.qmapScroll = 0;
  const ids = s.order.filter(qid => s.submitted[qid] && !isCorrect(QMAP[qid], s.answers[qid]));
  if (!ids.length) { toast('这一轮没有答错的题'); return; }
  /* 新的一轮用新的 session id：上一轮已在交卷时落进 rounds，数字不会被覆盖 */
  S.session = {
    id: 's' + Date.now(), bankId: s.bankId, bankName: s.bankName + ' · 再练没做对的',
    chapters: s.chapters.slice(), mode: 'order',
    order: ids, idx: 0, answers: {}, submitted: {}, fav: {},
    startedAt: Date.now(), finishedAt: 0, finished: false
  };
  saveProgress();
  S.view = 'quiz';
  render();
}
function again() {
  const s = S.session;
  autoJump = null;
  S.qmapOpen = false;
  S.qmapScroll = 0;
  S.session = {
    id: 's' + Date.now(), bankId: s.bankId, bankName: s.bankName,
    chapters: s.chapters.slice(), mode: s.mode,
    order: s.mode === 'random' ? shuffle(s.order) : s.order.slice(),
    idx: 0, answers: {}, submitted: {}, fav: {},
    startedAt: Date.now(), finishedAt: 0, finished: false
  };
  saveProgress();
  S.view = 'quiz';
  render();
}

/* ---- 6.7.1 导出分享图 ----
   不截结果页本身：页面有 radial-gradient 背景和 fixed 定位，html2canvas 容易糊；
   单独画一张固定宽度的干净卡片，导出效果稳定。 */
function shareCardHtml(rec) {
  const tone = rec.rate >= 80 ? 'success' : rec.rate >= 60 ? 'warning' : 'danger';
  const deg = Math.round(rec.rate * 3.6);
  return '<div class="share-card" style="width:560px;background:var(--bs-body-bg);color:var(--bs-body-color)">' +
      '<div class="d-flex align-items-center gap-2">' +
        '<span class="brand-logo">pi</span>' +
        '<span class="fw-bold fs-5">popipa</span>' +
        '<span class="ms-auto small text-body-secondary">' + esc(rec.date) + '</span>' +
      '</div>' +
      '<div class="d-flex align-items-center gap-4 mt-3">' +
        '<div class="ring" style="background:conic-gradient(var(--bs-' + tone + ') ' + deg +
          'deg,var(--bs-secondary-bg) ' + deg + 'deg)">' +
          '<div class="in"><div><div class="v" style="color:var(--bs-' + tone + '-text-emphasis)">' +
            rec.rate + '%</div><div class="u">正确率</div></div></div>' +
        '</div>' +
        '<div>' +
          '<div class="h5 fw-bold mb-1">' + esc(rec.bankName) + '</div>' +
          '<div class="small text-body-secondary mb-2">得分 ' + rec.score + ' 分 · 用时 ' + esc(rec.used) + '</div>' +
          '<div class="d-flex flex-wrap gap-3 small">' +
            '<span>总题数 <b>' + rec.total + '</b></span>' +
            '<span>答对 <b class="text-success">' + rec.correct + '</b></span>' +
            '<span>答错 <b class="text-danger">' + rec.wrong + '</b></span>' +
            '<span>未答 <b>' + rec.unanswered + '</b></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="small text-body-secondary mt-3 pt-3 border-top">' +
        esc(rec.user) + ' · 📢U咩哇帕瓦📢</div>' +
    '</div>';
}
function dateStamp(ms) {
  const d = new Date(ms || Date.now()), p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function shareRecord() {
  const s = S.session, st = stats(s);
  return {
    user: S.user || '匿名',
    bankName: s.bankName, total: st.total, correct: st.correct, wrong: st.wrong,
    unanswered: st.unanswered, rate: st.rate, score: st.score,
    used: fmtTime((s.finishedAt || Date.now()) - s.startedAt),
    date: dateStamp(Date.now())
  };
}
function exportPng() {
  const s = S.session;
  if (!s) { toast('没有可导出的成绩'); return; }
  if (typeof html2canvas !== 'function') { toast('分享图组件没加载，请检查 vendor/html2canvas.min.js'); return; }
  const rec = shareRecord();
  const holder = document.createElement('div');
  holder.innerHTML = shareCardHtml(rec);
  document.body.appendChild(holder);
  const drop = () => { if (holder.remove) holder.remove(); };
  const done = url => {
    drop();
    shareBodyEl.innerHTML =
      '<div class="modal-header">' +
        '<h5 class="modal-title"><i class="bi bi-image me-2"></i>分享图已生成</h5>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="关闭"></button>' +
      '</div>' +
      '<div class="modal-body"><div class="share-wrap">' +
        '<img alt="答题成绩分享图" src="' + url + '"></div></div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-outline-secondary" data-bs-dismiss="modal">关闭</button>' +
        '<a class="btn btn-primary" data-act="share-dl" download="popipa-' + rec.rate + '分-' +
          esc(rec.date) + '.png" href="' + url + '">' +
          '<i class="bi bi-download me-1"></i>下载 PNG</a>' +
      '</div>';
    bootstrap.Modal.getOrCreateInstance(shareModalEl).show();
  };
  const fail = () => { drop(); toast('生成分享图失败，请重试'); };
  try {
    /* backgroundColor 交给卡片自己的 --bs-body-bg，深色模式下也是深底 */
    const p = html2canvas(holder.firstChild, { scale: 2, backgroundColor: null, logging: false });
    if (p && typeof p.then === 'function') p.then(cv => done(cv.toDataURL('image/png'))).catch(fail);
    else done(p.toDataURL('image/png'));
  } catch (e) { fail(); }
}

/* ---- 6.8 计时器 ---- */
let timer = null;
function tickTimer() {
  const el = document.getElementById('elapsed');
  if (!el || !S.session) return;
  const end = S.session.finishedAt || Date.now();
  el.textContent = fmtTime(end - S.session.startedAt);
}
clearInterval(timer);
timer = setInterval(() => { if (S.view === 'quiz') tickTimer(); tickAuto(); }, 1000);

/* ============ 7. 事件 ============ */
document.addEventListener('click', function (e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  /* 导航类链接（比如顶栏品牌）不跳转，交给下面的动作处理；下载链接保持默认 */
  if (el.tagName === 'A' && !(el.hasAttribute && el.hasAttribute('download'))) e.preventDefault();
  const act = el.dataset.act;
  switch (act) {
    case 'login': doLogin(); break;
    case 'logout':
      if (S.view === 'quiz' && !confirm('正在答题，退出后进度会保留在本地。确定退出登录吗？')) return;
      S.user = null; S.session = null; store.del(KEY.user);
      applyTheme(theme());     /* 回到本机默认主题 */
      goPage('index.html', 'login'); break;
    case 'pick-bank': pickBank(el.dataset.id, el.dataset.scope); break;
    case 'toggle-chapter': {
      const id = el.dataset.id, i = S.chapters.indexOf(id);
      if (i >= 0) S.chapters.splice(i, 1); else S.chapters.push(id);
      refreshSetup(); break;
    }
    case 'toggle-type': {
      const t = el.dataset.type;
      const list = selectedTypes().slice();
      const i = list.indexOf(t);
      if (i >= 0) list.splice(i, 1); else list.push(t);
      S.types = list;
      refreshSetup(); break;
    }
    case 'mode': S.mode = el.dataset.mode; refreshSetup(); break;
    case 'wrong-only': {
      const scope = el.dataset.scope || (el.dataset.on === '1' ? 'wrong' : 'chapters');
      S.wrongOnly = scope === 'wrong';
      S.favOnly = scope === 'fav';
      refreshSetup(); break;
    }
    case 'theme': toggleTheme(); break;
    case 'back-banks':
      if (S.view === 'quiz' && !confirm('返回会保存当前进度，确定离开吗？')) return;
      S.session = null;
      if (PAGE === 'quiz' && !FILE_MODE) { goPage('banks.html', 'banks'); break; }
      S.view = 'banks'; render(); break;
    case 'start': startSession(); break;
    case 'resume': resumeSession(); break;
    case 'pick': pickKey(el.dataset.key); break;
    case 'submit': submitCurrent(); break;
    case 'redo': redoCurrent(); break;
    case 'fav': toggleFav(); break;
    case 'qmap-toggle': toggleQmap(); break;
    case 'share-png': exportPng(); break;
    case 'share-dl': bootstrap.Modal.getOrCreateInstance(shareModalEl).hide(); break;
    case 'prev': step(-1); break;
    case 'next': step(1); break;
    case 'jump': jump(Number(el.dataset.i)); break;
    case 'cancel-auto': autoJump = null; render(); toast('已取消自动跳转'); break;
    case 'finish': submitAndFinish(); break;
    case 'tab': S.reviewTab = el.dataset.tab; S.reviewOpen = {}; render(); break;
    case 'toggle-rev': {
      const qid = el.dataset.qid;
      if (S.reviewOpen[qid]) delete S.reviewOpen[qid]; else S.reviewOpen[qid] = true;
      /* 只切当前卡片的 open 类，不重绘整页 */
      const card = el.parentNode;
      if (card && card.classList) card.classList.toggle('open', !!S.reviewOpen[qid]);
      break;
    }
    case 'round-toggle': {
      const id = el.dataset.round;
      if (S.roundOpen[id]) delete S.roundOpen[id]; else S.roundOpen[id] = true;
      /* 展开/收起交给 Bootstrap collapse，只同步箭头 */
      const box = el.parentNode && el.parentNode.querySelector('.collapse');
      const open = box && box.classList.contains('show');
      const cx = el.querySelector('.round-cx');
      if (cx) cx.className = 'bi ' + (open ? 'bi-chevron-up' : 'bi-chevron-down') +
        ' text-body-secondary round-cx';
      break;
    }
    case 'retry-wrong': retryWrong(); break;
    case 'again': again(); break;
  }
});

/* 填空题：输入即存，避免重渲染丢焦点 */
document.getElementById('app').addEventListener('input', function (e) {
  if (!e.target.matches('[data-fill]')) return;
  const s = S.session;
  if (!s) return;
  const qid = s.order[s.idx];
  if (s.submitted[qid]) return;
  s.answers[qid] = e.target.value;
  saveProgress();
});

/* 快捷键 */
document.addEventListener('keydown', function (e) {
  if (S.view !== 'quiz' || !S.session) return;
  const typing = /input|textarea/i.test((document.activeElement || {}).tagName || '');
  const s = S.session, qid = s.order[s.idx], q = QMAP[qid];
  if (e.key === 'ArrowLeft') { step(-1); return; }
  if (e.key === 'ArrowRight') { step(1); return; }
  if (e.key === 'f' || e.key === 'F') { if (!typing) toggleFav(); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (s.submitted[qid]) { s.idx < s.order.length - 1 ? step(1) : finish(); }
    else submitCurrent();
    return;
  }
  if (!typing && q.type !== 'fill' && /^[1-8]$/.test(e.key)) {
    const k = LETTERS[Number(e.key) - 1];
    if (k && q.options[Number(e.key) - 1] !== undefined) pickKey(k);
  }
});

/* ============ 8. 启动 ============ */
function boot() {
  clearLegacy();         /* 清掉被取代的本机键，保持轻量 */
  migrateUsers();        /* 旧用户表里的业务字段搬进每用户自己的表 */
  applyTheme(theme());   /* 页面一加载就把主题定下来，避免闪一下浅色 */
  if (PAGE === 'login') { S.view = 'login'; render(); return; }
  if (!S.user) {
    if (FILE_MODE) { try { location.replace('index.html'); } catch (e) {} return; }
    goPage('index.html', 'login');
    return;
  }
  if (PAGE === 'banks') { S.view = 'banks'; render(); return; }
  if (PAGE === 'quiz') {
    /* 做题页靠 ?bank= 找到这局没答完的进度；没有就回主界面 */
    let bankId = null;
    try { bankId = new URLSearchParams(location.search).get('bank'); } catch (e) {}
    const prog = bankId ? loadProgress(S.user, bankId) : null;
    if (!prog) { goPage('banks.html', 'banks'); return; }
    S.qmapOpen = false;
    S.qmapScroll = 0;
    S.session = prog;
    S.view = 'quiz';
    render();
  }
}
boot();
