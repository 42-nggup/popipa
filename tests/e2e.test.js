/* =========================================================
   真实浏览器端到端测试：node tests/e2e.test.js
   用 Firefox（headless + Marionette）验证“换浏览器不丢数据”：
     A. 全新 profile 打开 → 登录 → 等防抖推送 → 数据文件里出现用户表
     B. 再换一个全新 profile 打开 → hydrate 自动恢复用户表 / 最近昵称，
        当前登录态（popipa:user）仍然留在本机，不跟着同步
   没有 Firefox 时打印“跳过”并以 0 退出。
   ========================================================= */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const FIREFOX = process.env.FIREFOX || 'firefox';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond) => cond ? (pass++, console.log('  \u2713 ' + name))
                                : (fail++, console.log('  \u2717 ' + name));
const section = t => console.log('\n' + t);

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}
function startPopipa(port, stateFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, String(port)], {
      env: Object.assign({}, process.env, {
        PORT: String(port), HOST: '127.0.0.1', POPIPA_STATE: stateFile
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      reject(new Error('popipa 启动超时\n' + out));
    }, 5000);
    child.stdout.on('data', d => {
      out += d.toString();
      if (out.indexOf('popipa: http://') >= 0) { clearTimeout(timer); resolve(child); }
    });
    child.stderr.on('data', d => { out += d.toString(); });
    child.on('exit', code => { clearTimeout(timer); reject(new Error('popipa 退出：' + code + '\n' + out)); });
  });
}
function stopChild(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode != null) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    child.once('exit', finish);
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} finish(); }, 3000);
  });
}

/* ---- 最小 Marionette 客户端（WebDriver 协议） ---- */
class Marionette {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.handshake = new Promise((resolve, reject) => {
      this._resolveHandshake = resolve;
      this._rejectHandshake = reject;
    });
    const timer = setTimeout(() => this._rejectHandshake(new Error('Marionette 握手超时')), 15000);
    this.handshake.then(() => clearTimeout(timer), () => clearTimeout(timer));
    socket.on('data', chunk => this._onData(chunk));
    socket.on('error', err => this._fail(err));
    socket.on('close', () => this._fail(new Error('Marionette 连接关闭')));
  }
  _fail(err) {
    this._rejectHandshake(err);
    this.pending.forEach(p => p.reject(err));
    this.pending.clear();
  }
  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const colon = this.buf.indexOf(0x3a);
      if (colon < 0) return;
      const len = parseInt(this.buf.subarray(0, colon).toString('ascii'), 10);
      if (!Number.isFinite(len) || len < 0) { this._fail(new Error('Marionette 报文头损坏')); return; }
      if (this.buf.length < colon + 1 + len) return;
      const payload = this.buf.subarray(colon + 1, colon + 1 + len).toString('utf8');
      this.buf = this.buf.subarray(colon + 1 + len);
      let msg;
      try { msg = JSON.parse(payload); }
      catch (e) { this._fail(new Error('Marionette 报文不是 JSON：' + payload.slice(0, 120))); return; }
      if (Array.isArray(msg)) {
        const id = msg[1], err = msg[2], result = msg[3];
        const p = this.pending.get(id);
        if (!p) continue;
        this.pending.delete(id);
        if (err) p.reject(new Error(err.message || JSON.stringify(err)));
        else p.resolve(result);
      } else if (msg && msg.applicationType) {
        this._resolveHandshake(msg);
      }
    }
  }
  send(name, params) {
    const id = this.nextId++;
    const json = JSON.stringify([0, id, name, params || {}]);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(Buffer.byteLength(json) + ':' + json);
    });
  }
  command(name, params) {
    return this.handshake.then(() => this.send(name, params));
  }
  close() { try { this.socket.end(); } catch (e) {} }
}
const unwrap = res => (res && typeof res === 'object' && 'value' in res) ? res.value : res;

async function connectMarionette(port, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < end) {
    try {
      const socket = await new Promise((resolve, reject) => {
        const s = net.connect(port, '127.0.0.1');
        s.once('connect', () => { s.removeListener('error', reject); resolve(s); });
        s.once('error', reject);
      });
      const client = new Marionette(socket);
      await client.handshake;
      return client;
    } catch (e) { lastErr = e; await sleep(250); }
  }
  throw lastErr || new Error('连接 Marionette 超时');
}
function writeProfile(dir, marionettePort) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'user.js'), [
    'user_pref("marionette.enabled", true);',
    'user_pref("marionette.port", ' + marionettePort + ');',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
    'user_pref("browser.aboutwelcome.enabled", false);'
  ].join('\n'));
}
async function launchFirefox(profileDir, marionettePort) {
  writeProfile(profileDir, marionettePort);
  const child = spawn(FIREFOX,
    ['--headless', '--marionette', '--no-remote', '--profile', profileDir, 'about:blank'],
    { env: Object.assign({}, process.env, { MOZ_HEADLESS: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d.toString(); });
  child.stderr.on('data', d => { log += d.toString(); });
  child.on('exit', code => { if (code != null && code !== 0) log += '\nfirefox exit ' + code; });
  try {
    const client = await connectMarionette(marionettePort, 20000);
    return { child, client, log: () => log };
  } catch (e) {
    await stopChild(child);
    throw e;
  }
}
async function evalScript(client, script) {
  return unwrap(await client.command('WebDriver:ExecuteScript', { script, args: [] }));
}
async function evalAsync(client, script) {
  return unwrap(await client.command('WebDriver:ExecuteAsyncScript', { script, args: [] }));
}
async function waitFor(fn, timeout, interval) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(interval || 200);
  }
  return null;
}
const WAIT_SCRIPT = `
const cb = arguments[arguments.length - 1];
const deadline = Date.now() + 12000;
function snap() {
  const dot = document.getElementById('syncDot');
  const nick = document.getElementById('nick');
  let users = null;
  try { users = JSON.parse(localStorage.getItem('popipa:users') || 'null'); } catch (e) {}
  return {
    dot: dot && dot.dataset ? dot.dataset.state : null,
    last: localStorage.getItem('popipa:last'),
    user: localStorage.getItem('popipa:user'),
    table: !!localStorage.getItem('popipa:u:e2e-user'),
    users: users ? Object.keys(users) : [],
    nick: nick ? nick.value : null,
    href: location.href
  };
}
(function tick() {
  const s = snap();
  if (s.dot && s.dot !== 'saving') { cb(s); return; }
  if (Date.now() > deadline) { s.timeout = true; cb(s); return; }
  setTimeout(tick, 100);
})();
`;
const LOGIN_SCRIPT = `
document.getElementById('nick').value = 'e2e-user';
setTimeout(function () {
  const btn = document.querySelector('[data-act="login"]');
  if (btn) btn.click();
}, 50);
return true;
`;

(async () => {
  try { execFileSync(FIREFOX, ['--version'], { stdio: 'ignore' }); }
  catch (e) { console.log('跳过：没有找到 Firefox'); return; }

  const port = await freePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'popipa-e2e-'));
  const stateFile = path.join(tmpDir, 'state.json');
  const base = 'http://127.0.0.1:' + port;
  let server = null, ffA = null, ffB = null;

  try {
    server = await startPopipa(port, stateFile);
    section('A. 第一次打开：登录后自动落盘');
    const mportA = await freePort();
    ffA = await launchFirefox(path.join(tmpDir, 'profile-a'), mportA);
    await ffA.client.command('WebDriver:NewSession', { capabilities: {} });
    await ffA.client.command('WebDriver:SetTimeouts', { script: 15000, pageLoad: 30000, implicit: 0 });
    await ffA.client.command('WebDriver:Navigate', { url: base + '/index.html' });
    const a0 = await evalAsync(ffA.client, WAIT_SCRIPT);
    ok('打开后同步状态为 ok（没退回本机模式）', a0.dot === 'ok');
    ok('首次登录页昵称为空', a0.nick === '');

    await evalScript(ffA.client, LOGIN_SCRIPT);
    await sleep(2500);
    const hrefA = unwrap(await ffA.client.command('WebDriver:GetCurrentURL', {}));
    ok('登录后跳到 home.html', /\/home\.html$/.test(hrefA));
    const storedA = await evalScript(ffA.client,
      'return { table: !!localStorage.getItem("popipa:u:e2e-user"),' +
      ' last: localStorage.getItem("popipa:last") };');
    ok('登录数据写进了 localStorage', storedA.table === true && storedA.last === '"e2e-user"');

    const disk = await waitFor(() => {
      try {
        const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return s && s.keys && s.keys['popipa:u:e2e-user'] ? s : null;
      } catch (e) { return null; }
    }, 8000);
    ok('防抖 / 关页补推后数据已落盘', !!disk);
    ok('数据文件里没有当前登录态',
       !!disk && !disk.keys['popipa:user'] && !disk.keys['popipa:theme']);

    section('B. 页面内切换：不重建侧边栏，只在换视图时过渡');
    await ffA.client.command('WebDriver:Navigate', { url: base + '/banks.html' });
    const banksReady = await evalAsync(ffA.client, `
      const cb = arguments[arguments.length - 1];
      const deadline = Date.now() + 10000;
      (function tick() {
        if (document.querySelector('.bank-card') && document.querySelector('.side')) {
          cb({ ok: true }); return;
        }
        if (Date.now() > deadline) { cb({ ok: false, href: location.href }); return; }
        setTimeout(tick, 50);
      })();
    `);
    ok('题库页加载完成', banksReady.ok);

    await evalScript(ffA.client, `
      window.__shellTop = document.getElementById('top');
      window.__shellSide = document.getElementById('side');
      window.__vtCount = 0;
      if (document.startViewTransition) {
        const orig = document.startViewTransition.bind(document);
        document.startViewTransition = function (cb) {
          window.__vtCount++;
          return orig(cb);
        };
      }
      return true;
    `);

    const toSetup = await evalAsync(ffA.client, `
      const cb = arguments[arguments.length - 1];
      const card = document.querySelector('.bank-card');
      if (card) card.click();
      const deadline = Date.now() + 4000;
      (function tick() {
        if (document.getElementById('setupCount')) {
          cb({
            same: document.getElementById('side') === window.__shellSide,
            top: document.getElementById('top') === window.__shellTop,
            vt: window.__vtCount,
            reduced: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          });
          return;
        }
        if (Date.now() > deadline) { cb({ ok: false }); return; }
        setTimeout(tick, 25);
      })();
    `);
    ok('banks → setup 复用同一个侧边栏', toSetup.same && toSetup.top);
    ok('banks → setup 触发页面过渡', toSetup.reduced || toSetup.vt > 0);

    await sleep(500);   /* 等这次 View Transition 结束，避免下一次被 transitionActive 挡住 */
    const toBanks = await evalAsync(ffA.client, `
      const cb = arguments[arguments.length - 1];
      const back = document.querySelector('[data-act="back-banks"]');
      if (back) back.click();
      const deadline = Date.now() + 4000;
      (function tick() {
        if (document.querySelector('.bank-card') && !document.getElementById('setupCount')) {
          cb({
            same: document.getElementById('side') === window.__shellSide,
            top: document.getElementById('top') === window.__shellTop,
            loads: performance.getEntriesByType('navigation').length,
            vt: window.__vtCount,
            reduced: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          });
          return;
        }
        if (Date.now() > deadline) { cb({ ok: false }); return; }
        setTimeout(tick, 25);
      })();
    `);
    ok('setup → banks 复用同一个侧边栏', toBanks.same && toBanks.top);
    ok('返回题库触发页面过渡', toBanks.reduced || toBanks.vt > 1);
    ok('整个切换过程没有重新加载文档', toBanks.loads === 1);

    const sameView = await evalScript(ffA.client, `
      const main = document.querySelector('.home-main');
      if (main) main.classList.remove('view-enter');
      if (typeof window.render === 'function') window.render();
      const m2 = document.querySelector('.home-main');
      return {
        canRender: typeof window.render === 'function',
        animated: !!(m2 && m2.classList.contains('view-enter')),
        banks: !!document.querySelector('.bank-card')
      };
    `);
    ok('同视图重绘不触发过渡', sameView.canRender && sameView.banks && sameView.animated === false);

    /* 真开一局：提交和切题都只更新答题页局部，不换骨架 */
    const startedQuiz = await evalAsync(ffA.client, `
      const cb = arguments[arguments.length - 1];
      const card = document.querySelector('.bank-card');
      if (card) card.click();
      const openDeadline = Date.now() + 4000;
      (function openSetup() {
        const start = document.getElementById('setupStart');
        if (start && !start.disabled) {
          start.click();
          waitQuiz();
          return;
        }
        if (Date.now() > openDeadline) { cb({ ok: false, step: 'setup' }); return; }
        setTimeout(openSetup, 25);
      })();
      function waitQuiz() {
        const deadline = Date.now() + 8000;
        (function tick() {
          if (document.getElementById('quizRoot') && document.getElementById('quizCard') &&
              document.getElementById('qmap')) {
            cb({
              ok: true,
              shell: document.getElementById('side') === window.__shellSide &&
                document.getElementById('top') === window.__shellTop,
              layout: document.body.dataset.layout,
              vt: window.__vtCount
            });
            return;
          }
          if (Date.now() > deadline) { cb({ ok: false, step: 'quiz', href: location.href }); return; }
          setTimeout(tick, 25);
        })();
      }
    `);
    ok('进入答题页', startedQuiz.ok);
    ok('答题页仍在同一个 Shell 内', startedQuiz.shell && startedQuiz.layout === 'focus');

    const submitted = await evalScript(ffA.client, `
      const app = document.getElementById('app');
      if (app) app.classList.remove('view-enter');
      ['quizRoot', 'quizBar', 'quizCard', 'qmap'].forEach(function (id, i) {
        const el = document.getElementById(id);
        if (el) el.dataset.probe = 'n' + i;
      });
      const fill = document.getElementById('fill');
      if (fill) {
        fill.value = '测试答案';
        fill.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        const opt = document.querySelector('.opt[data-act="pick"]');
        if (opt) opt.click();
      }
      const submit = document.querySelector('[data-act="submit"]');
      if (submit) submit.click();
      const q = id => document.getElementById(id);
      return {
        sameRoot: !!(q('quizRoot') && q('quizRoot').dataset.probe === 'n0'),
        sameBar: !!(q('quizBar') && q('quizBar').dataset.probe === 'n1'),
        sameCard: !!(q('quizCard') && q('quizCard').dataset.probe === 'n2'),
        sameMap: !!(q('qmap') && q('qmap').dataset.probe === 'n3'),
        tip: !!(q('quizCard') && q('quizCard').querySelector('.quiz-tip .alert')),
        redo: !!document.querySelector('[data-act="redo"]'),
        entered: !!(app && app.classList.contains('view-enter')),
        reduced: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      };
    `);
    ok('提交只打补丁：答题页骨架节点都还在',
       submitted.sameRoot && submitted.sameBar && submitted.sameCard && submitted.sameMap);
    ok('提交后出现判题反馈和「重做本题」', submitted.tip && submitted.redo);
    ok('提交不触发整页过渡', submitted.reduced || submitted.entered === false);

    const nextQ = await evalScript(ffA.client, `
      const nextBtn = document.querySelector('[data-act="next"]');
      if (nextBtn) nextBtn.click();
      const q = id => document.getElementById(id);
      const app = document.getElementById('app');
      return {
        sameRoot: !!(q('quizRoot') && q('quizRoot').dataset.probe === 'n0'),
        sameBar: !!(q('quizBar') && q('quizBar').dataset.probe === 'n1'),
        sameCard: !!(q('quizCard') && q('quizCard').dataset.probe === 'n2'),
        sameMap: !!(q('qmap') && q('qmap').dataset.probe === 'n3'),
        entered: !!(app && app.classList.contains('view-enter')),
        reduced: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      };
    `);
    ok('切下一题只更新内容，骨架节点不重建',
       nextQ.sameRoot && nextQ.sameBar && nextQ.sameCard && nextQ.sameMap);
    ok('切题不播放整页过渡', nextQ.reduced || nextQ.entered === false);

    /* 需要人工看答题页版式时：POPIPA_E2E_QUIZ_SHOT=/path/to.png node tests/e2e.test.js */
    if (process.env.POPIPA_E2E_QUIZ_SHOT) {
      const b64 = unwrap(await ffA.client.command('WebDriver:TakeScreenshot', { full: false }));
      if (typeof b64 === 'string') fs.writeFileSync(process.env.POPIPA_E2E_QUIZ_SHOT, Buffer.from(b64, 'base64'));
    }

    /* 交卷 → 结果页：切标签也只换列表 */
    const finished = await evalAsync(ffA.client, `
      const cb = arguments[arguments.length - 1];
      window.confirm = function () { return true; };
      const finishBtn = document.querySelector('[data-act="finish"]');
      if (finishBtn) finishBtn.click();
      const deadline = Date.now() + 6000;
      (function tick() {
        const tabs = document.getElementById('resultTabs');
        const list = document.getElementById('resultList');
        if (tabs && list) {
          cb({
            ok: true,
            shell: document.getElementById('side') === window.__shellSide &&
              document.getElementById('top') === window.__shellTop,
            layout: document.body.dataset.layout
          });
          return;
        }
        if (Date.now() > deadline) { cb({ ok: false, href: location.href }); return; }
        setTimeout(tick, 25);
      })();
    `);
    ok('交卷后进入结果页', finished.ok);
    ok('结果页仍在同一个 Shell 内', finished.shell && finished.layout === 'focus');

    const resultTabs = await evalScript(ffA.client, `
      const app = document.getElementById('app');
      if (app) app.classList.remove('view-enter');
      const tabs = document.getElementById('resultTabs');
      const list = document.getElementById('resultList');
      if (!tabs || !list) return { ok: false, href: location.href };
      tabs.dataset.probe = 'keep';
      list.dataset.probe = 'keep';
      const before = list.innerHTML;
      const wrongTab = tabs.querySelector('[data-tab="wrong"]');
      if (wrongTab) wrongTab.click();
      const tabs2 = document.getElementById('resultTabs');
      const list2 = document.getElementById('resultList');
      const active = tabs2 && tabs2.querySelector('.tab.active');
      return {
        ok: true,
        sameTabs: !!(tabs2 && tabs2.dataset.probe === 'keep'),
        sameList: !!(list2 && list2.dataset.probe === 'keep'),
        changed: !!(list2 && list2.innerHTML !== before),
        active: !!(active && active.dataset.tab === 'wrong'),
        entered: !!(app && app.classList.contains('view-enter')),
        reduced: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      };
    `);
    ok('结果页切标签不重建骨架', resultTabs.sameTabs && resultTabs.sameList);
    ok('切到错题只换列表并更新高亮', resultTabs.changed && resultTabs.active);
    ok('结果页同视图切标签不播放过渡', resultTabs.reduced || resultTabs.entered === false);

    /* 彩蛋：?brand=pipopa 强制走 pipopa，方便稳定验证 */
    await ffA.client.command('WebDriver:Navigate', { url: base + '/banks.html?brand=pipopa' });
    const brandEgg = await evalAsync(ffA.client, `
      const cb = arguments[arguments.length - 1];
      const deadline = Date.now() + 8000;
      (function tick() {
        if (document.querySelector('.bank-card')) {
          const el = document.querySelector('[data-brand-name]');
          cb({
            ok: true,
            brand: el ? el.textContent : null,
            title: document.title
          });
          return;
        }
        if (Date.now() > deadline) { cb({ ok: false, href: location.href }); return; }
        setTimeout(tick, 25);
      })();
    `);
    ok('彩蛋 ?brand=pipopa 生效',
       brandEgg.ok && brandEgg.brand === 'pipopa' && brandEgg.title.indexOf('pipopa') === 0);

    await ffA.client.command('WebDriver:Navigate', { url: base + '/banks.html?brand=umewa' });
    const brandEgg2 = await evalAsync(ffA.client, `
      const cb = arguments[arguments.length - 1];
      const deadline = Date.now() + 8000;
      (function tick() {
        if (document.querySelector('.bank-card')) {
          const el = document.querySelector('[data-brand-name]');
          cb({
            ok: true,
            brand: el ? el.textContent : null,
            title: document.title
          });
          return;
        }
        if (Date.now() > deadline) { cb({ ok: false, href: location.href }); return; }
        setTimeout(tick, 25);
      })();
    `);
    ok('彩蛋 ?brand=umewa 生效',
       brandEgg2.ok && brandEgg2.brand === '📢U咩哇帕瓦📢' &&
       brandEgg2.title.indexOf('📢U咩哇帕瓦📢') === 0);

    try { await ffA.client.command('WebDriver:DeleteSession', {}); } catch (e) {}
    ffA.client.close();
    await stopChild(ffA.child);
    ffA = null;

    section('C. 换一个全新浏览器：自动恢复');
    const mportB = await freePort();
    ffB = await launchFirefox(path.join(tmpDir, 'profile-b'), mportB);
    await ffB.client.command('WebDriver:NewSession', { capabilities: {} });
    await ffB.client.command('WebDriver:SetTimeouts', { script: 15000, pageLoad: 30000, implicit: 0 });
    await ffB.client.command('WebDriver:Navigate', { url: base + '/index.html' });
    const b0 = await evalAsync(ffB.client, WAIT_SCRIPT);
    ok('新浏览器同步状态为 ok', b0.dot === 'ok' && !b0.timeout);
    ok('用户表从服务器恢复', b0.table === true);
    ok('最近登录昵称从服务器恢复', b0.last === '"e2e-user"');
    ok('登录框自动回填昵称', b0.nick === 'e2e-user');
    ok('用户身份表也恢复了', b0.users.indexOf('e2e-user') >= 0);
    ok('当前登录态仍留在本机（不同步）', b0.user === null);
    ok('恢复后仍停在登录页', /\/index\.html$/.test(b0.href));

    /* 需要人工看页面时：POPIPA_E2E_SHOT=/path/to.png node tests/e2e.test.js */
    if (process.env.POPIPA_E2E_SHOT) {
      const b64 = unwrap(await ffB.client.command('WebDriver:TakeScreenshot', { full: false }));
      if (typeof b64 === 'string') fs.writeFileSync(process.env.POPIPA_E2E_SHOT, Buffer.from(b64, 'base64'));
    }
  } finally {
    for (const ff of [ffA, ffB]) {
      if (!ff) continue;
      try { await ff.client.command('WebDriver:DeleteSession', {}); } catch (e) {}
      try { ff.client.close(); } catch (e) {}
      await stopChild(ff.child);
    }
    await stopChild(server);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
