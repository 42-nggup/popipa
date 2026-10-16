/* =========================================================
   刷题吧 · 演示页逻辑
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
const app = document.getElementById('app');
const topbar = document.getElementById('top');
const toastEl = document.getElementById('toast');
const maskEl = document.getElementById('mask');
const dialogEl = document.getElementById('dialog');

const TYPE_LABEL = {
  single: { text: '单选题', cls: '' },
  multiple: { text: '多选题', cls: 'm' },
  judge: { text: '判断题', cls: 'j' },
  fill: { text: '填空题', cls: 'f' }
};

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
  let answered = 0, correct = 0, wrong = 0, fav = 0;
  s.order.forEach(id => {
    if (s.fav[id]) fav++;
    if (s.submitted[id]) {
      answered++;
      if (isCorrect(QMAP[id], s.answers[id])) correct++; else wrong++;
    }
  });
  const total = s.order.length;
  return {
    total, answered, correct, wrong, fav,
    unanswered: total - answered,
    rate: answered ? Math.round(correct / answered * 100) : 0, // 正确率（按已作答）
    score: total ? Math.round(correct / total * 100) : 0       // 得分（按总题数）
  };
}

/* ============ 4. 存储 ============ */
const KEY = {
  user: 'popipa:user',
  records: 'popipa:records',
  noPrompt: 'popipa:noPrompt',
  progress: (u, b) => 'popipa:progress:' + u + ':' + b
};
const store = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
function loadRecords() {
  const r = store.get(KEY.records, []);
  return Array.isArray(r) ? r : [];
}
function saveRecord(rec) {
  const list = loadRecords();
  list.unshift(rec);
  store.set(KEY.records, list.slice(0, 20));
}
function saveProgress() {
  if (S.user && S.session) store.set(KEY.progress(S.user, S.session.bankId), S.session);
}
function loadProgress(user, bankId) {
  const p = store.get(KEY.progress(user, bankId), null);
  return p && Array.isArray(p.order) && p.order.length ? p : null;
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
function bankById(id) { return (BANKS || []).find(b => b.id === id); }
function bankQuestionIds(bank) {
  /* 只返回可判分的题（答案缺失的脏数据不进入练习，另行提示） */
  const ids = [];
  bank.chapters.forEach(ch => ch.questions.forEach(q => { if (q.answer.length) ids.push(q.id); }));
  return ids;
}
function countLegacy(bank) {
  let n = 0;
  bank.chapters.forEach(ch => ch.questions.forEach(q => { if (!q.answer.length) n++; }));
  return n;
}

const S = {
  user: store.get(KEY.user, null),
  view: 'login',
  bankId: null,
  chapters: [],       // 组卷时选中的章节
  mode: 'order',      // order | random
  noPrompt: store.get(KEY.noPrompt, false),  // 未提交就切下一题时，不再询问直接提交
  session: null,
  reviewTab: 'all',
  reviewOpen: {},
  finishAt: 0
};

/* ============ 6. 渲染 ============ */
function render() {
  if (S.view === 'login' || !S.user) return renderLogin();
  topbar.hidden = false;
  document.getElementById('whoName').textContent = S.user;
  document.getElementById('avatar').textContent = S.user.slice(0, 1).toUpperCase();
  if (S.view === 'banks') return renderBanks();
  if (S.view === 'setup') return renderSetup();
  if (S.view === 'quiz') return renderQuiz();
  if (S.view === 'result') return renderResult();
}

/* ---- 6.1 登录主页 ---- */
function renderLogin() {
  topbar.hidden = true;
  const recs = loadRecords().slice(0, 5);
  let hist = '';
  if (recs.length) {
    hist = '<div class="hist"><h3>本机最近记录</h3>' + recs.map(r => {
      const cls = r.rate >= 80 ? 'good' : r.rate >= 60 ? 'mid' : 'bad';
      return '<div class="rec"><span class="r-name">' + esc(r.user) + ' · ' + esc(r.bankName) + '</span>' +
        '<span class="muted">' + r.correct + '/' + r.total + ' 题</span>' +
        '<span class="r-rate ' + cls + '">' + r.rate + '%</span></div>';
    }).join('') + '</div>';
  }
  app.innerHTML =
    '<div class="hero">' +
      '<div class="logo-big">刷</div>' +
      '<h1>刷题吧</h1>' +
      '<p>挑一套题库，答完立刻知道对错，随时看得见自己的进度。</p>' +
    '</div>' +
    '<div class="card login-box">' +
      '<div class="field">' +
        '<label for="nick">你的昵称</label>' +
        '<input class="input" id="nick" maxlength="16" placeholder="例如：小明" autocomplete="off">' +
        '<div class="err" id="nickErr">请输入 1~16 个字符的昵称</div>' +
      '</div>' +
      '<button class="btn pri" style="width:100%" data-act="login">开始刷题</button>' +
    '</div>' + hist;
  const nick = document.getElementById('nick');
  if (nick) nick.focus();
}
function doLogin() {
  const nick = document.getElementById('nick');
  const err = document.getElementById('nickErr');
  const v = (nick.value || '').trim();
  if (!v || v.length > 16) { err.classList.add('show'); nick.focus(); return; }
  err.classList.remove('show');
  S.user = v;
  store.set(KEY.user, v);
  S.view = 'banks';
  render();
}

/* ---- 6.2 选题界面 ---- */
function renderBanks() {
  const recs = loadRecords();
  const cards = (BANKS || []).map(bank => {
    const total = bankQuestionIds(bank).length;
    const legacy = countLegacy(bank);
    const prog = loadProgress(S.user, bank.id);
    let counts = { single: 0, multiple: 0, judge: 0, fill: 0 };
    bank.chapters.forEach(ch => ch.questions.forEach(q => counts[q.type]++));
    const st = prog ? stats(prog) : null;
    return '<div class="card bank" data-act="pick-bank" data-id="' + bank.id + '">' +
      '<div class="b-top"><span class="b-ico">' + bank.icon + '</span>' +
        '<div><div class="b-name">' + esc(bank.name) + '</div>' +
        '<div class="b-desc">' + esc(bank.desc) + '</div></div></div>' +
      '<div class="b-stat">' +
        '<span>共 <b>' + total + '</b> 题</span>' +
        '<span><b>' + bank.chapters.length + '</b> 个章节</span>' +
        '<span>单选 ' + counts.single + ' · 多选 ' + counts.multiple +
              ' · 判断 ' + counts.judge + ' · 填空 ' + counts.fill + '</span>' +
        (legacy ? '<span class="resume" style="color:var(--warn)">' + legacy + ' 题答案缺失（已容错）</span>' : '') +
        (st ? '<span class="resume">上次答到第 ' + (st.answered) + ' 题，继续？</span>' : '') +
      '</div>' +
      '<span class="b-go">›</span></div>';
  }).join('');
  app.innerHTML =
    '<h1>选择题库<span class="sub">共 ' + (BANKS || []).length + ' 个题库，' +
      (BANKS || []).reduce((n, b) => n + bankQuestionIds(b).length, 0) + ' 道题</span></h1>' +
    '<div style="margin-top:18px">' + cards + '</div>' +
    (recs.length ? '<div class="hist"><h3>历史成绩</h3>' + recs.map(r => {
      const cls = r.rate >= 80 ? 'good' : r.rate >= 60 ? 'mid' : 'bad';
      return '<div class="rec"><span class="r-name">' + esc(r.user) + ' · ' + esc(r.bankName) + '</span>' +
        '<span class="muted">' + esc((r.at || '').slice(5, 16).replace('T', ' ')) + '</span>' +
        '<span class="muted">' + r.correct + '/' + r.total + '</span>' +
        '<span class="r-rate ' + cls + '">' + r.rate + '%</span></div>';
    }).join('') + '</div>' : '');
}
function pickBank(id) {
  S.bankId = id;
  S.chapters = bankById(id).chapters.map(c => c.id);
  S.mode = 'order';
  S.view = 'setup';
  render();
}

/* ---- 6.3 组卷面板 ---- */
function renderSetup() {
  const bank = bankById(S.bankId);
  if (!bank) { S.view = 'banks'; return render(); }
  const chips = bank.chapters.map(ch =>
    '<button class="chip ' + (S.chapters.indexOf(ch.id) >= 0 ? 'on' : '') +
    '" data-act="toggle-chapter" data-id="' + ch.id + '">' + esc(ch.name) +
    '<span class="n">' + ch.questions.length + '</span></button>').join('');
  const picked = bank.chapters.filter(ch => S.chapters.indexOf(ch.id) >= 0)
    .reduce((n, ch) => n + ch.questions.filter(q => q.answer.length).length, 0);
  const prog = loadProgress(S.user, bank.id);
  app.innerHTML =
    '<h1>' + esc(bank.name) + '<span class="sub">选择章节与出题顺序，然后开始</span></h1>' +
    '<div class="card panel">' +
      '<h3>章节</h3><p class="hint">点一下可取消 / 选中，只有选中的章节会进入本次练习。</p>' +
      '<div class="chips">' + chips + '</div>' +
      '<div class="hr"></div>' +
      '<h3>出题顺序</h3><p class="hint">顺序即按题库原顺序；随机适合反复刷。</p>' +
      '<div class="seg">' +
        '<button class="' + (S.mode === 'order' ? 'on' : '') + '" data-act="mode" data-mode="order">顺序</button>' +
        '<button class="' + (S.mode === 'random' ? 'on' : '') + '" data-act="mode" data-mode="random">随机</button>' +
      '</div>' +
      '<div class="hr"></div>' +
      '<h3>答题设置</h3><p class="hint">多选题 / 填空题选了答案却没提交就点「下一题」时，默认会先问一句；' +
        '单选题 / 判断题则直接提交。这个开关可以改回来。</p>' +
      '<div class="chips">' +
        '<button class="chip ' + (S.noPrompt ? 'on' : '') + '" data-act="toggle-noprompt">' +
          (S.noPrompt ? '✓ ' : '') + '不再提醒，直接提交</button>' +
      '</div>' +
      '<div class="row mt"><span class="grow muted">本次将出 <b>' + picked + '</b> 道题</span>' +
        '<button class="btn" data-act="back-banks">返回</button>' +
        (prog ? '<button class="btn ghost" data-act="resume">继续上次</button>' : '') +
        '<button class="btn pri" data-act="start" ' + (picked ? '' : 'disabled') + '>开始答题</button>' +
      '</div>' +
    '</div>';
}


/* ---- 6.4 组卷 / 开始练习 ---- */
function startSession() {
  const bank = bankById(S.bankId);
  if (!bank) { S.view = 'banks'; return render(); }
  let ids = [];
  bank.chapters.forEach(ch => {
    if (S.chapters.indexOf(ch.id) < 0) return;
    ch.questions.forEach(q => { if (q.answer.length) ids.push(q.id); });
  });
  if (!ids.length) { toast('请至少选择一个章节'); return; }
  if (S.mode === 'random') ids = shuffle(ids);
  S.session = {
    id: 's' + Date.now(),
    bankId: bank.id, bankName: bank.name,
    chapters: S.chapters.slice(), mode: S.mode,
    order: ids, idx: 0,
    answers: {}, submitted: {}, fav: {},
    startedAt: Date.now(), finishedAt: 0, finished: false
  };
  saveProgress();
  S.view = 'quiz';
  render();
}
function resumeSession() {
  const p = loadProgress(S.user, S.bankId);
  if (!p) { toast('没有可继续的记录'); return; }
  p.finished = false;
  S.session = p;
  S.view = 'quiz';
  render();
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
    tip = '<div class="tip ' + (ok ? 'ok' : 'no') + '">' +
      '<div class="tt">' + (ok ? '✓ 答对了' : '✕ 答错了') + '</div>' +
      (ok ? '' : '<div>正确答案：' + esc(answerText(q).replace(/\s+/g, ' ').trim()) + '</div>') +
      '<div class="an">你的答案：' + esc(pickedText(q, picked)) + '</div>' +
      (q.analysis ? '<div class="ana">解析：' + fmt(q.analysis) + '</div>' : '') +
      (counting ? '<div class="autojump">⏳ <b id="autojump">' + autoJump.sec + '</b> 秒后自动进入下一题' +
        '<button class="btn sm ghost" data-act="cancel-auto">取消跳转</button></div>' : '') +
      '</div>';
  }

  /* 答题卡 */
  const nav = s.order.map((id, i) => {
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
      '<span class="stat"><i class="dot" style="background:var(--dot-idle)"></i>已答 <b>' + st.answered + '</b></span>' +
      '<span class="stat"><i class="dot" style="background:var(--ok)"></i>答对 <b>' + st.correct + '</b></span>' +
      '<span class="stat"><i class="dot" style="background:var(--bad)"></i>答错 <b>' + st.wrong + '</b></span>' +
      '<span class="stat">正确率 <b>' + st.rate + '%</b></span>' +
      '<span class="stat" style="margin-left:auto">⏱ <b id="elapsed">0 秒</b></span>' +
    '</div>' +
    '<div class="bar"><i style="width:' + (st.answered / st.total * 100) + '%"></i></div>' +
    '<div class="card qcard">' +
      '<div class="qhead">' +
        '<span class="badge ' + t.cls + '">' + t.text + '</span>' +
        '<span class="qno">' + esc(QPOS[qid].chapterName) + '</span>' +
        '<button class="fav ' + (s.fav[qid] ? 'on' : '') + '" data-act="fav" title="收藏本题">' +
          (s.fav[qid] ? '★' : '☆') + '</button>' +
      '</div>' +
      '<h2 class="stem">' + fmt(q.stem) + '</h2>' +
      body + tip +
      '<div class="acts">' +
        (done
          ? '<button class="btn ghost" data-act="redo">重做本题</button>'
          : '<button class="btn pri grow" data-act="submit">提交答案</button>') +
        '<button class="btn" data-act="prev" ' + (isFirst ? 'disabled' : '') + '>上一题</button>' +
        (isLast
          ? '<button class="btn pri" data-act="finish">交卷看结果</button>'
          : '<button class="btn" data-act="next">下一题</button>') +
        '<button class="btn ghost" data-act="finish">交卷</button>' +
      '</div>' +
    '</div>' +
    '<div class="nav">' + nav + '</div>' +
    '<div class="kbdhint">快捷键：<span class="kbd">←</span> <span class="kbd">→</span> 切题 · ' +
      '<span class="kbd">1</span>~<span class="kbd">4</span> 选项 · ' +
      '<span class="kbd">Enter</span> 提交 · <span class="kbd">F</span> 收藏</div>';
  tickTimer();
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
  render();
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
  if (s.fav[qid]) delete s.fav[qid]; else s.fav[qid] = true;
  saveProgress();
  render();
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
function step(delta) {
  if (delta > 0 && !leaveCurrent()) return;    /* 询问框已弹出，等用户选 */
  go(delta);
}
function leaveCurrent() {
  const s = S.session, qid = s.order[s.idx], q = QMAP[qid];
  if (s.submitted[qid]) return true;                        /* 已提交，直接走 */
  if (!hasAnswer(q, s.answers[qid])) return true;            /* 没作答，也直接走 */
  const auto = q.type === 'single' || q.type === 'judge';    /* 答案唯一的题型可以安全自动提交 */
  if (auto || S.noPrompt) {
    submitCurrent(false);
    if (!auto) toast('已按「不再提醒」自动提交本题');
    return true;
  }
  askUnsubmitted();
  return false;
}
function askUnsubmitted() {
  const q = QMAP[S.session.order[S.session.idx]];
  dialogEl.innerHTML =
    '<h3>这道题还没提交</h3>' +
    '<p>你已经选了答案，但还没点「提交答案」。' + esc(TYPE_LABEL[q.type].text) +
      '的答案可能不止一个，所以我没敢自作主张。</p>' +
    '<button class="memory' + (S.noPrompt ? ' on' : '') + '" data-act="toggle-noprompt">' +
      '<i>' + (S.noPrompt ? '✓' : '') + '</i>不再提醒，以后直接提交</button>' +
    '<div class="dlg-acts">' +
      '<button class="btn pri" data-act="dlg-submit">提交并继续</button>' +
      '<button class="btn" data-act="dlg-skip">不提交，继续</button>' +
      '<button class="btn ghost" data-act="dlg-cancel">留在此题</button>' +
    '</div>';
  maskEl.hidden = false;
}
function closeDialog() { maskEl.hidden = true; }

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
function finish() {
  autoJump = null;
  const s = S.session, st = stats(s);
  if (st.unanswered > 0 &&
      !confirm('还有 ' + st.unanswered + ' 题没有作答。未作答不计入正确率，确定交卷吗？')) { render(); return; }
  s.finished = true;
  s.finishedAt = Date.now();
  saveRecord({
    user: S.user, bankName: s.bankName, total: st.total,
    correct: st.correct, wrong: st.wrong, rate: st.rate, score: st.score,
    seconds: Math.round((s.finishedAt - s.startedAt) / 1000),
    at: new Date().toISOString()
  });
  store.del(KEY.progress(S.user, s.bankId));
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
  const color = st.rate >= 80 ? 'var(--ok)' : st.rate >= 60 ? 'var(--warn)' : 'var(--bad)';
  const deg = Math.round(st.rate * 3.6);
  const verdict = st.rate >= 80 ? '很稳，继续保持！' : st.rate >= 60 ? '及格线以上，再刷一遍更稳。' : '基础还需巩固，建议专攻错题。';

  const tabs = [
    ['all', '全部 ' + st.total],
    ['wrong', '错题 ' + st.wrong],
    ['unanswered', '未作答 ' + st.unanswered],
    ['fav', '收藏 ' + st.fav]
  ].map(([k, label]) =>
    '<button class="tab ' + (S.reviewTab === k ? 'on' : '') + '" data-act="tab" data-tab="' + k + '">' +
    label + '</button>').join('');

  const ids = s.order.filter(qid => {
    if (S.reviewTab === 'wrong') return s.submitted[qid] && !isCorrect(QMAP[qid], s.answers[qid]);
    if (S.reviewTab === 'unanswered') return !s.submitted[qid];
    if (S.reviewTab === 'fav') return !!s.fav[qid];
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
        (s.fav[qid] ? '<span class="fa">★</span>' : '') +
        '<span class="cx">⌄</span>' +
      '</div>' +
      '<div class="rev-b">' +
        '<div class="q">' + fmt(q.stem) + '</div>' +
        '<div class="line">题型：' + TYPE_LABEL[q.type].text + '　章节：' + esc(QPOS[qid].chapterName) + '</div>' +
        '<div class="line">你的答案：<b>' + esc(pickedText(q, s.answers[qid])) + '</b></div>' +
        '<div class="line">正确答案：<b style="color:var(--ok)">' +
          esc(answerText(q).replace(/\s+/g, ' ').trim()) + '</b></div>' +
        (q.analysis ? '<div class="line" style="margin-top:6px">解析：' + fmt(q.analysis) + '</div>' : '') +
      '</div></div>';
  }).join('') : '<div class="card empty"><div class="e-ico">🎉</div>这个分类下没有题目</div>';

  app.innerHTML =
    '<h1>答题结果<span class="sub">' + esc(s.bankName) + ' · ' + esc(s.mode === 'random' ? '随机顺序' : '顺序作答') + '</span></h1>' +
    '<div class="card score-hero">' +
      '<div class="ring" style="background:conic-gradient(' + color + ' ' + deg + 'deg,var(--track) ' + deg + 'deg)">' +
        '<div class="in"><div><div class="v" style="color:' + color + '">' + st.rate + '%</div>' +
        '<div class="u">正确率</div></div></div>' +
      '</div>' +
      '<div class="hero-txt">' +
        '<h2>得分 ' + st.score + ' 分</h2>' +
        '<p>' + verdict + '　用时 ' + fmtTime(used) + '</p>' +
        '<div class="row mt">' +
          '<button class="btn pri" data-act="retry-wrong">重做错题</button>' +
          '<button class="btn" data-act="again">再刷一遍</button>' +
          '<button class="btn ghost" data-act="back-banks">返回题库</button>' +
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
    '<div class="tabs">' + tabs + '</div>' +
    list;
}
function retryWrong() {
  const s = S.session;
  autoJump = null;
  const ids = s.order.filter(qid => s.submitted[qid] && !isCorrect(QMAP[qid], s.answers[qid]));
  if (!ids.length) { toast('没有错题，太棒了'); return; }
  S.session = {
    id: 's' + Date.now(), bankId: s.bankId, bankName: s.bankName + ' · 错题重做',
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
  if (e.target.id === 'mask') { closeDialog(); return; }   /* 点遮罩关闭询问框 */
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'login': doLogin(); break;
    case 'logout':
      if (S.view === 'quiz' && !confirm('正在答题，退出后进度会保留在本地。确定退出登录吗？')) return;
      S.user = null; store.del(KEY.user); S.view = 'login'; S.session = null; render(); break;
    case 'pick-bank': pickBank(el.dataset.id); break;
    case 'toggle-chapter': {
      const id = el.dataset.id, i = S.chapters.indexOf(id);
      if (i >= 0) S.chapters.splice(i, 1); else S.chapters.push(id);
      render(); break;
    }
    case 'mode': S.mode = el.dataset.mode; render(); break;
    case 'back-banks':
      if (S.view === 'quiz' && !confirm('返回会保存当前进度，确定离开吗？')) return;
      S.view = 'banks'; S.session = null; render(); break;
    case 'start': startSession(); break;
    case 'resume': resumeSession(); break;
    case 'pick': pickKey(el.dataset.key); break;
    case 'submit': submitCurrent(); break;
    case 'redo': redoCurrent(); break;
    case 'fav': toggleFav(); break;
    case 'prev': step(-1); break;
    case 'next': step(1); break;
    case 'jump': jump(Number(el.dataset.i)); break;
    case 'cancel-auto': autoJump = null; render(); toast('已取消自动跳转'); break;
    case 'toggle-noprompt':
      S.noPrompt = !S.noPrompt; store.set(KEY.noPrompt, S.noPrompt);
      toast(S.noPrompt ? '已开启：以后直接提交' : '已恢复提醒');
      if (el.classList.contains('memory')) askUnsubmitted(); else render();
      break;
    case 'dlg-submit': closeDialog(); submitCurrent(false); go(1); break;
    case 'dlg-skip': closeDialog(); go(1); break;
    case 'dlg-cancel': closeDialog(); break;
    case 'finish': finish(); break;
    case 'tab': S.reviewTab = el.dataset.tab; S.reviewOpen = {}; render(); break;
    case 'toggle-rev': {
      const qid = el.dataset.qid;
      if (S.reviewOpen[qid]) delete S.reviewOpen[qid]; else S.reviewOpen[qid] = true;
      render(); break;
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
render();
