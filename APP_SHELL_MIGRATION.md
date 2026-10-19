# 正式应用 App Shell 变更总结

> 目标：把 `demo/app-shell` 验证过的持久顶栏 / 侧边栏 + History API + View Transition
> 应用到正式页面，同时保持题库、判分、存储、同步、e2e 全部可用。

## 1. 当前状态

- demo `demo/app-shell/` 已验证：
  - `#top` / `#side` 节点跨视图不变
  - 文档只加载 1 次
  - 普通页面切换：旧内容向上滑出，新内容从下方滑入并减速
  - 进入 / 离开答题态：侧栏向左滑出 / 从左侧滑入
  - 顶栏在 View Transition 期间压在最上层
- 正式页面目前仍是多文档导航：`goPage()` 在 HTTP 下直接 `location.href`，
  顶栏 / 侧边栏每次整页重建。
- 本轮已先做了一部分 HTML 准备工作：
  - 7 个 HTML 都加上了 `data-layout`
  - `#app` 外面包了 `.app-shell > .home-wrap > aside#side + main#app`
  - 但还没有接入路由 / 持久 Shell 逻辑

## 2. 目标 HTML 结构

```html
<body data-page="home" data-layout="app">

  <header id="top" class="site-top">…静态顶栏…</header>

  <div class="app-shell flex-1 pb-12">
    <div class="home-wrap">
      <aside id="side" class="side" hidden></aside>
      <main id="app" class="home-main"></main>
    </div>
  </div>

  <dialog id="consentModal">…</dialog>
  <dialog id="shareModal">…</dialog>
  <script src="app.data.js"></script>
  <script src="app.js"></script>
</body>
```

- `#top`：静态、fixed、不参与 `render()`。
- `#side`：只创建一次；内部由 `sideBarInner()` 填一次。
- `#app`：唯一被 `render()` 替换的区域。
- `data-layout`：
  - `app`：普通页面，侧栏显示
  - `focus`：答题 / 结果，侧栏隐藏但节点保留
  - `plain`：登录页，侧栏隐藏

## 3. CSS 变更

### 3.1 布局

```css
body[data-layout="focus"] .home-wrap,
body[data-layout="plain"] .home-wrap {
  grid-template-columns: minmax(0, 1fr);
}
```

### 3.2 View Transition

```css
#app { view-transition-name: app-content; }
#top  { view-transition-name: topbar; }

/* 主内容：旧的上滑淡出，新的从下方滑入并减速 */
::view-transition-old(app-content) { animation: popipa-page-out .14s cubic-bezier(.4,0,1,1) both; }
::view-transition-new(app-content) { animation: popipa-page-in .34s cubic-bezier(.16,1,.3,1) .08s both; }

/* 侧栏：只在 focus 布局切换时参与，向左滑出 / 从左侧滑入 */
.vt-sidebar { view-transition-name: sidebar; }
::view-transition-old(sidebar) { animation: popipa-side-out .16s cubic-bezier(.4,0,1,1) both; }
::view-transition-new(sidebar) { animation: popipa-side-in .34s cubic-bezier(.16,1,.3,1) .04s both; }

/* 顶栏必须压在快照上面 */
::view-transition-group(topbar)     { z-index: 100; }
::view-transition-group(sidebar)    { z-index: 20; }
::view-transition-group(app-content){ z-index: 10; }
::view-transition-group(root)       { z-index: 0; }

::view-transition-old(root),
::view-transition-new(root),
::view-transition-old(topbar),
::view-transition-new(topbar) { animation: none; }
```

- `prefers-reduced-motion: reduce` 时全部关闭。
- 不支持 View Transition 时回退到现有 `.view-enter`。

## 4. `app.js` 变更

### 4.1 Shell

- 新增 `sideEl = #side`。
- `sideBar()` 改成 `sideBarInner()`，只返回侧栏内部 HTML。
- 新增 `ensureShell()`：页面启动时给 `#side` 填一次内容，之后不再重建。
- `refreshSideBar(active)` 改成查询 `sideEl`，只更新 active / 计数 / 用户信息。
- `pageShell(active, main)` 改成：
  ```js
  document.body.dataset.layout = 'app';
  sideEl.hidden = false;
  refreshSideBar(active);
  app.innerHTML = main;
  ```
- 登录：`data-layout="plain"`，隐藏侧栏。
- 答题 / 结果：`data-layout="focus"`，隐藏侧栏但节点保留。

### 4.2 路由

- 新增 `pageFromLocation()`：从 `location.pathname` 解析 `index/home/banks/quiz/summary/stats/collection`。
- 新增 `applyLocation()`：
  - 登录页
  - 未登录访问受保护页 → 替换到 `index.html`
  - home / summary / stats / collection
  - banks：`?bank=&chapter=&scope=` → setup
  - quiz：`?bank=` → 读进度，没有则回 banks
- 启动：`bootViews()` 改为调用 `applyLocation()`。
- `popstate` → `applyLocation()`。
- `goPage(url, view)`：
  - HTTP：`history.pushState` + `render()`
  - `file://`：只切 `S.view` + `render()`，不碰 History API
- 删除 `PAGE` 常量依赖；所有 `PAGE === ...` 分支改为 `S.view`。
- `back-banks` 不再区分初始页面，直接回 banks。

### 4.3 渲染 / 动画

- `render()` 只更新 `#app`。
- `changed = viewKey()` 变化才做过渡。
- `fromLayout = body.dataset.layout`，`toLayout = layoutForView(S.view)`。
- `layoutChanging` 时临时给 `#side` 加 `.vt-sidebar`。
- 支持 `document.startViewTransition` 时：
  - 更新放在回调里
  - `vt.finished.finally` 清理 `transitionActive` / `.vt-sidebar`
- 不支持时：`pulseView(app)` 走旧 fallback。
- 首次加载不播放动画。
- 同视图 patch（提交答案、切题、结果页切标签、排序、展开）不播放动画。

### 4.4 顶栏

- 顶栏保持静态，只更新：
  - 主题按钮图标
  - 用户昵称 / 头像
  - 同步图标
- 不参与 `render()`。

## 5. 需要改的文件

```text
app.js                 路由 / Shell / 渲染 / 动画
src/tailwind.css       布局模式 + View Transition + 动画
index.html             登录页 shell（已完成基础结构）
home.html              普通 shell
banks.html             普通 shell
summary.html           普通 shell
stats.html             普通 shell
collection.html        普通 shell
quiz.html              focus shell
tests/logic.test.js    路由 / shell / 动画断言
tests/e2e.test.js      节点身份 / 单文档导航 / back-forward
README.md              运行方式 / 架构说明
HANDOFF.md             交接说明
前端重构总结.md         完成记录
dist/                  同步产物
```

## 6. 验收标准

1. 从 home → banks → setup → stats → collection 切换：
   - `#top` / `#side` 节点身份不变
   - 文档加载次数保持 1
   - 侧栏滚动位置不丢
2. 进入 / 离开答题态：
   - 主内容上下滑动
   - 侧栏向左滑出 / 从左侧滑入
   - 顶栏始终在最上层
3. 浏览器前进 / 后退正常
4. 直接打开 `/banks.html?bank=web&chapter=...` 仍进组卷页
5. 登录 / 退出 / 刷新 / `file://` 模式正常
6. `logic` / `server` / `e2e` 全绿
7. demo 与正式页面两边都自检通过
8. `dist/` 与根目录一致

## 7. 实施顺序

1. CSS：布局模式 + View Transition + 动画
2. app.js：Shell / 路由 / render 动画
3. HTML：确认 7 个页面结构一致
4. 测试：logic → server → e2e
5. 同步 dist
6. 浏览器自检正式页面与 demo

## 8. 完成状态

- [x] 7 个页面统一持久 Shell
- [x] `#top` / `#side` 节点跨路由不变
- [x] History API + `popstate` + 直接 URL
- [x] 主内容上下滑动、侧栏向左滑出 / 滑入
- [x] 顶栏在 View Transition 期间保持最上层
- [x] `file://` 单页模式
- [x] 浏览器自检正式页面与 demo

测试结果：

- `logic`：276 通过
- `server`：20 通过
- `e2e`：32 通过
- 文档内导航全程文档加载次数保持 `1`
- 浏览器前进 / 后退、直接打开 `banks.html?bank=…&chapter=…` 正常
