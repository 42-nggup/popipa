'use strict';

/* =========================================================
   App Shell Demo
   ---------------------------------------------------------
   核心只有三件事：
   1. #top / #side 是静态 HTML，永远不参与 render()。
   2. navigate() 只改 history + #app.innerHTML。
   3. 同文档 View Transition 只作用在 #app 上。
   ========================================================= */

const topbar = document.getElementById('top');
const side = document.getElementById('side');
const app = document.getElementById('app');
const themeBtn = document.getElementById('themeBtn');

/* 每次“硬加载”生成一个新实例 id；SPA 导航时保持不变 */
const shellId = Math.random().toString(36).slice(2, 8);
document.getElementById('topInstance').textContent = '#' + shellId;
document.getElementById('sideInstance').textContent = '#' + shellId;

window.__shellProbe = {
  top: topbar,
  side: side,
  shellId: shellId,
  createdAt: Date.now(),
  navCount: 0
};

let currentRoute = 'home';

const ROUTES = {
  home: {
    title: '学习概览',
    page: 'home',
    layout: 'app',
    active: 'home',
    view: viewHome
  },
  banks: {
    title: '题库 / 组卷',
    page: 'banks',
    layout: 'app',
    active: 'banks',
    view: viewBanks
  },
  stats: {
    title: '学习报告',
    page: 'stats',
    layout: 'app',
    active: 'stats',
    view: viewStats
  },
  quiz: {
    title: '答题态',
    page: 'quiz',
    layout: 'focus',
    active: 'banks',
    view: viewQuiz
  }
};

function routeFromUrl() {
  let view = 'home';
  try {
    view = new URLSearchParams(location.search).get('view') || 'home';
  } catch (e) {}
  return ROUTES[view] ? view : 'home';
}

function debugCard(route) {
  const probe = window.__shellProbe;
  const topSame = probe.top === document.getElementById('top');
  const sideSame = probe.side === document.getElementById('side');
  const loads = (performance.getEntriesByType &&
    performance.getEntriesByType('navigation').length) || 0;
  return '<section class="card home-card mt-4">' +
      '<div class="card-body">' +
        '<p class="eyebrow">SHELL PROBE</p>' +
        '<h2 class="m-0 text-[16px] font-bold">为什么顶栏 / 侧边栏没有闪？</h2>' +
        '<p class="mt-1 text-[12px] text-muted">下面这些值来自当前内存里的真实 DOM 节点。</p>' +
        '<div class="demo-kv mt-3">' +
          '<span>Shell 实例</span><b>#' + probe.shellId + '</b>' +
          '<span>当前路由</span><b>?view=' + route + '</b>' +
          '<span>文档加载次数</span><b>' + loads + '</b>' +
          '<span>SPA 导航次数</span><b>' + probe.navCount + '</b>' +
          '<span>#top 是同一个节点</span><b class="' + (topSame ? 'demo-ok' : 'demo-bad') + '">' +
            (topSame ? '是' : '否') + '</b>' +
          '<span>#side 是同一个节点</span><b class="' + (sideSame ? 'demo-ok' : 'demo-bad') + '">' +
            (sideSame ? '是' : '否') + '</b>' +
          '<span>#side 当前状态</span><b>' + (side.hidden ? '隐藏（节点仍在）' : '显示') + '</b>' +
        '</div>' +
        '<div class="mt-4 flex flex-wrap gap-2">' +
          '<button class="btn btn-sm btn-outline" type="button" data-action="back">后退</button>' +
          '<button class="btn btn-sm btn-outline" type="button" data-action="forward">前进</button>' +
          '<button class="btn btn-sm btn-outline" type="button" data-action="check">重新检查</button>' +
          '<button class="btn btn-sm btn-danger-outline" type="button" data-action="reload">' +
            '硬刷新（会重建 Shell）</button>' +
        '</div>' +
      '</div>' +
    '</section>';
}

function viewHome() {
  return '<section class="hero-home">' +
      '<p class="eyebrow">PERSISTENT APP SHELL · DEMO</p>' +
      '<h1 class="welcome-line">顶栏和侧边栏只创建一次</h1>' +
      '<p class="hero-sub">点击左侧导航。观察 Shell 实例 ID 不变、文档加载次数保持 1，只有 #app 的内容在换。</p>' +
      '<div class="flex flex-wrap gap-2">' +
        '<button class="btn btn-primary btn-lg" type="button" data-go="banks">' +
          '<i class="bi bi-play-fill"></i>去题库</button>' +
        '<button class="btn btn-warm btn-lg" type="button" data-go="stats">' +
          '<i class="bi bi-graph-up-arrow"></i>去学习报告</button>' +
      '</div>' +
    '</section>' +
    '<div class="mt-4 grid gap-3 lg:grid-cols-2">' +
      '<section class="card home-card"><div class="card-body">' +
        '<p class="eyebrow">HOW IT WORKS</p>' +
        '<h2 class="m-0 text-[16px] font-bold">一次点击发生了什么</h2>' +
        '<ol class="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] text-muted">' +
          '<li>点击链接，<code>preventDefault()</code> 阻止整页导航。</li>' +
          '<li><code>history.pushState()</code> 更新地址栏。</li>' +
          '<li><code>render()</code> 只替换 <code>#app.innerHTML</code>。</li>' +
          '<li><code>#top</code> 和 <code>#side</code> 的 DOM 节点完全不动。</li>' +
        '</ol>' +
        '<div class="demo-flow mt-4">' +
          '<code>home</code><i class="bi bi-arrow-right"></i>' +
          '<code>banks</code><i class="bi bi-arrow-right"></i>' +
          '<code>stats</code><i class="bi bi-arrow-right"></i>' +
          '<code>quiz</code>' +
        '</div>' +
      '</div></section>' +
      '<section class="card home-card"><div class="card-body">' +
        '<p class="eyebrow">WHAT TO WATCH</p>' +
        '<h2 class="m-0 text-[16px] font-bold">三个观察点</h2>' +
        '<ul class="mt-3 list-disc space-y-1.5 pl-5 text-[13px] text-muted">' +
          '<li>顶栏右侧的 <b>Shell #id</b> 一直不变。</li>' +
          '<li>侧边栏底部也有同一个实例编号。</li>' +
          '<li>进入答题态后侧边栏只是 hidden，返回时节点还在。</li>' +
        '</ul>' +
        '<p class="mb-0 mt-4 text-[12px] text-muted">按浏览器后退 / 前进，或点调试卡里的按钮试试。</p>' +
      '</div></section>' +
    '</div>' +
    debugCard('home');
}

function viewBanks() {
  return '<div class="page-head">' +
      '<p class="eyebrow">MAIN CONTENT</p>' +
      '<h1 class="page-title">题库 / 组卷</h1>' +
      '<p class="mb-0 mt-1 text-muted">这里只是 #app 的内容。顶栏和侧边栏没有重新创建。</p>' +
    '</div>' +
    '<div class="bank-grid">' +
      '<article class="card bank-card"><div class="card-body p-4">' +
        '<div class="flex items-start gap-3">' +
          '<span class="bank-ico"><i class="bi bi-cup-hot"></i></span>' +
          '<div class="min-w-0 flex-1">' +
            '<h2 class="bank-title">Java 程序设计</h2>' +
            '<p class="bank-desc">示例题库 · 章节 / 题型筛选都在真实项目里</p>' +
          '</div>' +
        '</div>' +
        '<div class="bank-meta"><span><i class="bi bi-collection"></i>219 题</span>' +
          '<span><i class="bi bi-list-ol"></i>1 章</span></div>' +
        '<div class="mt-4 flex items-center gap-2">' +
          '<button class="btn btn-sm btn-primary ml-auto" type="button" data-go="quiz">' +
            '进入答题态<i class="bi bi-arrow-right"></i></button>' +
        '</div>' +
      '</div></article>' +
      '<article class="card bank-card"><div class="card-body p-4">' +
        '<div class="flex items-start gap-3">' +
          '<span class="bank-ico"><i class="bi bi-window-stack"></i></span>' +
          '<div class="min-w-0 flex-1">' +
            '<h2 class="bank-title">Web 前端</h2>' +
            '<p class="bank-desc">示例题库 · 观察切换时 Shell 不动</p>' +
          '</div>' +
        '</div>' +
        '<div class="bank-meta"><span><i class="bi bi-collection"></i>119 题</span>' +
          '<span><i class="bi bi-list-ol"></i>6 章</span></div>' +
        '<div class="mt-4 flex items-center gap-2">' +
          '<button class="btn btn-sm btn-primary ml-auto" type="button" data-go="quiz">' +
            '进入答题态<i class="bi bi-arrow-right"></i></button>' +
        '</div>' +
      '</div></article>' +
    '</div>' +
    debugCard('banks');
}

function viewStats() {
  return '<div class="page-head">' +
      '<p class="eyebrow">MAIN CONTENT</p>' +
      '<h1 class="page-title">学习报告</h1>' +
      '<p class="mb-0 mt-1 text-muted">只有 #app 内容被替换；顶部 Shell 实例编号仍然是同一个。</p>' +
    '</div>' +
    '<div class="stat-grid">' +
      '<div class="stat-card"><div class="stat-ico"><i class="bi bi-pencil-square"></i></div>' +
        '<div class="stat-label">总写题数</div><div class="stat-value">128</div>' +
        '<div class="stat-sub">累计作答</div></div>' +
      '<div class="stat-card"><div class="stat-ico"><i class="bi bi-bullseye"></i></div>' +
        '<div class="stat-label">总正确率</div><div class="stat-value">86%</div>' +
        '<div class="stat-sub">110 题答对</div></div>' +
      '<div class="stat-card"><div class="stat-ico"><i class="bi bi-stopwatch"></i></div>' +
        '<div class="stat-label">总写题时间</div><div class="stat-value">42 分</div>' +
        '<div class="stat-sub">累计用时</div></div>' +
    '</div>' +
    '<section class="card home-card mt-4"><div class="card-body">' +
      '<div class="flex items-center justify-between gap-2">' +
        '<div><p class="eyebrow">CHART</p><h2 class="m-0 text-[16px] font-bold">示意曲线</h2></div>' +
        '<span class="text-[12px] text-muted">最近 7 轮</span>' +
      '</div>' +
      '<div class="demo-bars" aria-hidden="true">' +
        '<i style="height:36%"></i><i style="height:52%"></i><i style="height:44%"></i>' +
        '<i style="height:68%"></i><i style="height:61%"></i><i style="height:83%"></i>' +
        '<i style="height:74%"></i>' +
      '</div>' +
    '</div></section>' +
    debugCard('stats');
}

function viewQuiz() {
  return '<div class="page-head">' +
      '<p class="eyebrow">FOCUS LAYOUT</p>' +
      '<h1 class="page-title">答题态</h1>' +
      '<p class="mb-0 mt-1 text-muted">这个视图把 <code>body[data-layout]</code> 设为 <code>focus</code>。</p>' +
    '</div>' +
    '<section class="card"><div class="card-body">' +
      '<h2 class="m-0 text-[16px] font-bold">侧边栏只是隐藏，不是删除</h2>' +
      '<p class="mt-2 text-[13px] text-muted">#side 仍然在 DOM 里，主内容变成单列。点「返回题库」后，' +
        '侧边栏会原样出现，实例编号不变。</p>' +
      '<div class="mt-4 flex flex-wrap gap-2">' +
        '<button class="btn btn-primary" type="button" data-go="banks">返回题库</button>' +
        '<button class="btn btn-outline" type="button" data-go="home">回学习概览</button>' +
      '</div>' +
    '</div></section>' +
    debugCard('quiz');
}

const VIEWS = { home: viewHome, banks: viewBanks, stats: viewStats, quiz: viewQuiz };

function updateActiveNav(active) {
  Array.prototype.forEach.call(document.querySelectorAll('.side-link[data-nav]'), a => {
    const on = a.dataset.nav === active;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function commit(route) {
  const def = ROUTES[route] || ROUTES.home;
  currentRoute = route in ROUTES ? route : 'home';

  document.body.dataset.page = def.page;
  document.body.dataset.layout = def.layout;
  side.hidden = def.layout === 'focus';

  /* 唯一被替换的地方 */
  app.innerHTML = VIEWS[currentRoute]();

  updateActiveNav(def.active);
  document.title = def.title + ' · popipa App Shell Demo';

  if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
}

function reducedMotion() {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let transitionActive = false;

function render(route, options) {
  const target = route in ROUTES ? route : 'home';
  const changed = target !== currentRoute;
  const noAnimate = !!(options && options.noAnimate);
  const update = () => commit(target);

  const fromLayout = currentRoute && ROUTES[currentRoute] ? ROUTES[currentRoute].layout : null;
  const toLayout = ROUTES[target].layout;
  const layoutChanging = fromLayout !== toLayout;
  const animate = changed && !noAnimate;

  if (animate && !transitionActive &&
      typeof document.startViewTransition === 'function' && !reducedMotion()) {
    transitionActive = true;
    /* 只有进入 / 离开答题态时才让侧栏参与过渡；
       普通页面切换侧栏保持不动。 */
    if (layoutChanging) side.classList.add('vt-sidebar');
    try {
      const vt = document.startViewTransition(update);
      const cleanup = () => {
        transitionActive = false;
        side.classList.remove('vt-sidebar');
      };
      if (vt && vt.finished && vt.finished.finally) {
        vt.finished.finally(cleanup);
      } else {
        setTimeout(cleanup, 500);
      }
      return;
    } catch (e) {
      transitionActive = false;
      side.classList.remove('vt-sidebar');
    }
  }

  update();

  /* 不支持 View Transition 时的降级：新内容从下方滑入 */
  if (animate && !reducedMotion()) {
    app.classList.remove('page-enter');
    void app.offsetWidth;
    app.classList.add('page-enter');
    app.addEventListener('animationend', function () {
      app.classList.remove('page-enter');
    }, { once: true });
  }
}

function navigate(route, options) {
  if (!ROUTES[route]) route = 'home';
  const url = new URL(location.href);
  url.searchParams.set('view', route);
  const href = url.pathname + url.search;

  try {
    history[options && options.replace ? 'replaceState' : 'pushState'](
      { route: route }, '', href
    );
  } catch (e) {
    /* file:// 下部分浏览器不允许 pushState：仍然切换内容，只是不改地址栏 */
  }

  if (!(options && options.replace)) window.__shellProbe.navCount++;
  render(route);
}

function goBack() {
  try { history.back(); } catch (e) {}
}
function goForward() {
  try { history.forward(); } catch (e) {}
}

/* ---- 事件：拦截站内导航 ---- */
document.addEventListener('click', function (e) {
  if (e.defaultPrevented || e.button !== 0 ||
      e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  const action = e.target.closest && e.target.closest('[data-action]');
  if (action) {
    const act = action.dataset.action;
    if (act === 'back') goBack();
    else if (act === 'forward') goForward();
    else if (act === 'reload') location.reload();
    else if (act === 'check') {
      render(currentRoute, { noAnimate: true });
      if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
    }
    return;
  }

  const target = e.target.closest && e.target.closest('[data-go], [data-nav]');
  if (!target) return;
  e.preventDefault();
  navigate(target.dataset.go || target.dataset.nav);
});

window.addEventListener('popstate', function () {
  window.__shellProbe.navCount++;
  render(routeFromUrl());
});

/* ---- 顶栏主题切换：只改属性和图标，不重绘顶栏 ---- */
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeBtn.innerHTML = '<i class="bi ' + (dark ? 'bi-sun' : 'bi-moon-stars') + '"></i>';
  themeBtn.title = dark ? '切换到浅色' : '切换到深色';
  themeBtn.setAttribute('aria-label', themeBtn.title);
}
themeBtn.addEventListener('click', function () {
  applyTheme(document.documentElement.dataset.theme !== 'dark');
});

/* ---- 启动 ---- */
(function boot() {
  const initial = routeFromUrl();
  const url = new URL(location.href);
  if (!url.searchParams.get('view')) {
    url.searchParams.set('view', initial);
    try { history.replaceState({ route: initial }, '', url.pathname + url.search); } catch (e) {}
  }
  applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  render(initial, { noAnimate: true });
})();

window.__demo = {
  navigate: navigate,
  render: render,
  probe: window.__shellProbe,
  get route() { return currentRoute; }
};
