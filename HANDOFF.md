# popipa 交接文档（给下一个 AI / 开发者）

> 生成时间：2026-10-19 14:56 +0800（前端迁移后更新）
> 工作区：`/home/42nggup/Projects/popipa`
> 仓库：git，分支 `refactor/frontend`；迁移前可运行基线为 tag `OK-to-run`
> 状态：前端迁移已提交，工作区应为干净状态。第 7 节是迁移前的历史快照。
> 配套文档：`CONVERSATION.md`、`README.md`、`FRONTEND.md`、`前端重构总结.md`。

> **2026-10-19 前端迁移说明**：`refactor/frontend` 分支已把前端从 Bootstrap 迁移到
> Tailwind CSS 3.4，移除 Bootstrap CSS/JS，改用原生 `<dialog>`，并修复了登录回车、
> 键盘可达性、同视图重绘动画等问题。迁移盘点见 `FRONTEND.md` 与 `前端重构总结.md`；
> 下文中所有 Bootstrap / `app.css` 相关描述都按新结构理解：
> `src/tailwind.css` → `assets/app.css`，Bootstrap Icons / html2canvas 仍在 `vendor/`。
> 当前测试规模：**logic 273 + server 20 + e2e 29，全绿**。

---

## 0. 接手前先看这三件事

1. **这是纯前端 + 零依赖 Node 服务器**：没有 `npm install`、没有构建步骤。所有页面直接跑 `app.js` / `app.data.js`。
2. **`data/state.json` 是真实用户数据**（答题进度、错题、收藏、成绩等），已经 gitignore。
   - **不要删除、不要重置、不要提交到仓库、不要公开上传。**
   - 跑服务端测试时必须用 `POPIPA_STATE` 指到临时文件，别碰它。
   - 交接包里包含这份数据（因为要换设备继续用）；这是私人数据，别发到公共地方。
3. **改完必须跑三套测试**；改前端后把根目录的对应文件同步到 `dist/`（见第 6 节）。

---

## 1. 项目是什么

`popipa` 是一个刷题应用：

```
登录 → 选题库 → 组卷 → 答题 → 交卷看结果 → 错题 / 收藏 / 成绩 / 统计
```

- 纯静态 HTML/CSS/JS，Tailwind CSS 3.4 已编译到 `assets/app.css`。
- 题库由 `scripts/parse-banks.js` 从 `data/raw/*.md` 解析成 `app.data.js`。
- `server.js` 是零依赖 Node 静态服务器，同时提供 `/api/state`：
  - 把浏览器 localStorage 里可共享的数据自动落盘到 `data/state.json`；
  - 打开页面时自动拉回，清缓存 / 换浏览器不丢。
- 支持两种运行模式：
  - `node server.js`：真正的多页面（`index.html` / `home.html` / `banks.html` / `quiz.html` …），localStorage 同源共享，自动落盘。
  - 直接双击 `index.html`（`file://`）：浏览器按文件隔离 localStorage，所以 `app.js` 自动退回单页内视图切换；功能可用，但**不会落盘**。

当前测试规模：**logic 273 + server 20 + e2e 29，全绿**。

---

## 2. 怎么运行

```bash
cd /home/nggup42/production/popipa
node server.js                 # 默认 8000，只监听 127.0.0.1
# 浏览器打开 http://localhost:8000/
```

常用环境变量：

```bash
node server.js 8080                                  # 换端口
PORT=8080 node server.js                             # 同上
POPIPA_STATE=/path/to/state.json node server.js      # 换数据文件
HOST=0.0.0.0 node server.js                          # 局域网访问（接口也会暴露，慎用）
```

默认数据文件：

```
data/state.json       当前数据
data/state.json.bak   上一次成功保存的备份
```

- 主文件损坏时，启动会尝试从 `.bak` 恢复。
- 数据文件**不会被静态服务直接下载**：`/data/state.json`、`.bak`、`.tmp` 都返回 404；即使 `POPIPA_STATE` 指到别处，默认路径也会被挡住（这个漏洞本轮修过）。
- 服务默认 `127.0.0.1`；`localhost` 可访问。要手机/局域网访问才用 `HOST=0.0.0.0`。

不带界面快速冒烟：

```bash
curl http://localhost:8000/api/state
# {"ok":true,"updatedAt":...,"keys":{...}}
```

---

## 3. 目录与文件

```
index.html            登录页
home.html             学习概览（侧边栏 + 每日目标 + 统计）
banks.html            题库列表 + 组卷面板（同页切换）
quiz.html             答题页 + 交卷结果（同页切换）
summary.html          题库汇总
stats.html            学习报告（曲线 / 排行榜 / 成就 / 成绩历史）
collection.html       错题本 / 收藏集（?type=wrong|fav）
app.js                全部逻辑：路由 / 渲染 / 判分 / 存储 / 同步 / 事件
app.data.js           题库（自动生成，勿手改）
src/tailwind.css      Tailwind 源文件（base / components / utilities）
tailwind.config.js    暖褐主题、字体、阴影、dark 选择器
assets/app.css        Tailwind 编译产物（提交到仓库）
package.json          仅开发期构建 CSS 用
server.js             零依赖静态服务器 + /api/state 落盘
data/                 题库源文件 / 解析产物；运行时数据 data/state.json（gitignore）
data/state.json       真实用户数据（私人，勿删/勿提交）
dist/                 自包含部署副本（app.js/assets/server.js/HTML/vendor）
scripts/parse-banks.js Markdown → app.data.js
tests/logic.test.js   逻辑自测（Node + 极简 DOM 桩）
tests/server.test.js  服务端 /api/state 落盘测试（临时端口 + 临时文件）
tests/e2e.test.js     Firefox headless 端到端（登录 → 落盘 → 换 profile 恢复 / UI 重绘）
vendor/               Bootstrap Icons、html2canvas（Bootstrap CSS/JS 已移除）
需求/                 历史需求文档（整改需求 / 第二次 / 追加）
```

一些不是代码但属于工作区的文件：

```
new.md                旧备注
成就.md              旧备注
对话记录.jsonl        既有对话日志（不是本轮权威记录；权威摘要在 CONVERSATION.md）
.gitignore            忽略运行时数据
```

---

## 4. 架构

### 4.1 页面与路由

- 每个 HTML 的 `<body data-page="login|home|banks|quiz|summary|stats|collection">` 决定启动视图。
- `app.js` 的 `boot()` 读取 `PAGE`，再决定渲染哪个页面。
- `goPage(url, view)`：
  - `http(s)`：真的改 `location.href`（多页面）。
  - `file:`：`S.view = view; render()`（单页内切换）。
- 侧边栏由 `sideBar(active)` 生成，链接是真实的 `.html` 地址；`pageShell(active, main)` 负责外壳。
- 页面内切换（banks ↔ setup、home ↔ summary 等在 `file:` 模式）不会换文档。

### 4.2 存储与同步（本轮重点之一）

localStorage key：

| key | 含义 | 是否同步 |
|---|---|---|
| `popipa:users` | 用户身份表（name / lastLogin） | 是 |
| `popipa:u:<昵称>` | 每个用户的全部业务数据 | 是 |
| `popipa:last` | 最近登录昵称（登录页回填） | 是 |
| `popipa:user` | 当前登录态 | **否**（留在本机） |
| `popipa:theme` | 本机主题 | **否**（留在本机） |
| `popipa:sync` | 本机同步元数据 `{at, dead}` | 否 |
| `popipa:progress:*` / `popipa:records` | 旧版遗留 | 删除 |

同步流程：

1. `store.set(k, v)` / `store.del(k)` 写 localStorage，并给 `popipa:sync.at[k]` 记时间戳。
2. 防抖 500ms → `PUT /api/state`，body 是 `{keys: {key: {v, at}}}`。
3. 关闭页面 / 切后台时 `flushSync()` 用 `keepalive` 补推一次（>60KB 时跳过）。
4. 打开页面：`hydrate()` 先 `GET /api/state`，只把 `at` 比本机新的 key 写回 localStorage；再把合并后的快照 `PUT` 回去。
5. 服务端按 key 的 `at` 做 last-write-wins 合并，原子写 `data/state.json`（tmp + rename），保留 `.bak`。
6. 删除用墓碑：`{v: null, at}`；避免删掉的 key 下次被拉回来。
7. `popipa:user` / `popipa:theme` 不同步：
   - 换浏览器后需要重新登录一次，昵称从 `popipa:last` 自动回填。
   - 主题按设备保留，登录后会用该用户的 `u.theme`。

顶栏云图标状态：

- 绿色 = 已保存；
- 黄色 = 连不上服务器 / 正在重试；
- 灰色 = 纯本机模式（`file://`、普通静态服务器、或 `/api/state` 不可用）。

### 4.3 渲染与过渡（本轮重点之二）

**目标**：不要整页 `app.innerHTML` 重建导致闪烁；只在真正换视图时做一个小过渡。

- `render()`（app.js 约 838 行）：
  - 计算 `viewKey()`（视图 + 会改变骨架的上下文：collection 类型、setup 题库、quiz/result 的 session id）。
  - 记录 `window.scrollY`；同视图重绘恢复滚动，换视图回到顶部。
  - `renderDispatch()` 只负责 DOM 分发。
  - 只有 `viewKey` 变化才调用 `pulseView()`。
- `pageShell(active, main)`（约 2425 行）：
  - 第一次建 `<div class="home-wrap"><aside class="side">…</aside><div class="home-main">…</div></div>`。
  - 之后复用 `.home-wrap` / `.side`，只替换 `.home-main`。
  - `refreshSideBar(active)`（约 2412 行）只更新高亮、`aria-current`、错题/收藏计数。
- 答题页：
  - 常驻 `#quizRoot`，里面是 `#quizBar` / `#quizProgress` / `#quizCard` / `#quizMapWrap`。
  - `renderQuiz()`（约 1515 行）第一次建骨架；同一 session 后续调用 `patchQuiz()`，只换状态条、题卡、格子。
  - `submitCurrent()`（约 1610 行）走 `patchQuizAnswered()`（约 1471 行）：不重建题卡，只锁选项、标对错、插反馈、换按钮、更新状态条和格子。
  - 切题走 `patchQuiz()`：题卡内容换，`#qmap` / 状态条节点保留。
- 结果页：
  - `resultListHtml()`（约 1756 行）只生成当前标签的列表。
  - `refreshResultTab()`（约 1791 行）只换 `#resultList` 和高亮，不重建分数卡。
- 过渡：
  - CSS `@keyframes view-in` + `.view-enter`（`src/tailwind.css` 组件层）：**100ms** 淡入 + 2px 上移，起始透明度 0.6。
  - `pulseView()`（约 888 行）：只在真换视图时加 class；带序列号防止快速连续切页被旧定时器清掉；尊重 `prefers-reduced-motion`。
  - 同视图重绘（提交、切题、结果页切标签、排序、展开）不加动画。

### 4.4 server.js

- 静态文件 + `/api/state`。
- 关键函数：
  - `isStateFile()`：默认路径 + `POPIPA_STATE` 路径的 `.json/.bak/.tmp` 都不允许静态下载。
  - `loadState()` / `saveState()`：原子写、`.bak`、损坏回退 `.bak`。
  - `mergeKeys()`：按 `at` 合并；`v:null` 是墓碑；过滤 `popipa:user` / `popipa:theme` / `popipa:sync` / 旧版 key。
- API：
  - `GET /api/state` → `{ok, updatedAt, keys}`
  - `PUT /api/state`（也接受 POST）`{keys:{key:{v,at}}}` → 合并后返回同样的结构
- 数据文件格式：
  ```json
  {"version":1,"updatedAt":123,"keys":{"popipa:u:小明":{"v":"{...}","at":123}}}
  ```

---

## 5. 本轮对话与决策（摘要）

完整逐轮见 `CONVERSATION.md`。

1. **“能不能把浏览器保存的 localStorage 持久化”**
   - 给了三个选项；用户选 **“服务端自动落盘 + 自动恢复”**（不是导出/导入方案）。
   - 实现 `/api/state`、`hydrate`、防抖推送、墓碑、`.bak`、状态图标。
   - 没有做导出/导入 JSON 的 UI（用户当时没选）。
2. **“每次切换页面时加一个小的过渡，不要让重绘页面时出现闪烁”**
   - 初步方案是加淡入；用户补充 **“由整页重绘导致”**。
   - 于是改成结构性优化：常驻侧边栏、答题页 `#quizRoot`、结果页只换列表；过渡只加在真换视图时。
3. **“有点慢，加快一点”**
   - 过渡 180ms → 100ms；起始透明度 35% → 60%；位移 4px → 2px；清理定时器 400ms → 220ms。
4. **顺手修复**
   - 服务端静态文件泄露：`POPIPA_STATE` 指向别处时，默认 `data/state.json` 仍可被直接下载 → 现在两条路径都挡。
   - 逻辑测试偶发失败：第 50 组没重置随机出题模式，偶尔第一题是填空题导致判错 → 改成直接写入正确答案，连跑 20 次稳定。

---

## 6. 开发工作流（照着做）

### 6.1 改代码

1. 先 `git status`，确认工作区已有本轮未提交改动，不要误 `git checkout .`。
2. 改根目录的源文件（不要只改 `dist/`）。
3. 如果改了 `src/tailwind.css` / `tailwind.config.js` / 页面 class，先重新构建：

```bash
npm install            # 首次
npm run build:css      # src/tailwind.css → assets/app.css
```

4. 同步到 `dist/`：

```bash
cp index.html home.html banks.html quiz.html summary.html stats.html collection.html \
   app.js app.data.js server.js dist/
mkdir -p dist/assets dist/vendor/fonts
cp assets/app.css assets/favicon.svg dist/assets/
cp vendor/bootstrap-icons.min.css vendor/html2canvas.min.js dist/vendor/
cp vendor/fonts/bootstrap-icons.woff2 dist/vendor/fonts/
```

`dist/` 是自包含部署副本，没有 `tests/` / `README.md` / `src/`，但必须有 `app.data.js`、`assets/app.css`、`vendor/`。

### 6.2 跑测试

```bash
node tests/logic.test.js     # 273 项，纯 Node + DOM 桩
node tests/server.test.js    # 20 项，起真实 server.js，临时端口 + 临时数据文件
node tests/e2e.test.js       # 29 项，真实 Firefox headless + Marionette（需要 firefox）
```

- E2E 会自己创建临时 profile 和临时 `POPIPA_STATE`，不会碰真实 `data/state.json`。
- 如果机器没有 Firefox，E2E 会打印“跳过”并以 0 退出。
- 逻辑测试可以多跑几次（本轮修过一个偶发用例）：

```bash
for i in $(seq 1 20); do node tests/logic.test.js >/dev/null || echo "fail $i"; done
```

### 6.3 手动冒烟

```bash
node server.js 8123
curl http://localhost:8123/api/state
curl -o /dev/null -w '%{http_code}\n' http://localhost:8123/data/state.json   # 404
```

不要用默认 `data/state.json` 做破坏性实验；需要时：

```bash
tmp=$(mktemp -d)
POPIPA_STATE="$tmp/state.json" PORT=8124 node server.js 8124
```

### 6.4 提交

本轮改动**还没有 commit**。下一台设备接手后可以自行提交，但注意：

```bash
git status
# 不要 git add data/state.json（它本来就被 .gitignore 忽略）
git add README.md FRONTEND.md 前端重构总结.md package.json package-lock.json \
        tailwind.config.js src/ assets/ app.js server.js *.html \
        dist/ tests/ .gitignore
git commit -m "refactor(frontend): migrate to Tailwind CSS + native dialogs"
```

是否提交、拆几个 commit 由接手者决定；不要 `git reset --hard` 丢掉未提交工作。

---

## 7. 当前 git 状态（交接时的历史快照；前端迁移后已变化）

分支 `main`，最后提交 `cd43511`。

已修改（未提交）：

```
M README.md
M app.css
M app.js
M server.js
M home.html
M index.html
M stats.html
M dist/app.css
M dist/app.js
M dist/server.js
M dist/home.html
M dist/index.html
M dist/stats.html
M tests/logic.test.js
```

未跟踪（新增/已有但未提交）：

```
?? .gitignore
?? tests/e2e.test.js
?? tests/server.test.js
?? new.md
?? 成就.md
?? 对话记录.jsonl
```

`data/state.json` / `.bak` 不在 `git status` 里，因为已 gitignore；**文件真实存在，是用户数据**。

---

## 8. 测试与验证结果（交接时）

| 套件 | 命令 | 结果 | 覆盖 |
|---|---|---|---|
| logic | `node tests/logic.test.js` | **273 通过** | 判分、重复提交幂等、组卷、收藏、成绩、成就、同步快照/墓碑/hydrate、viewKey、Tailwind/Dialog/回车登录 |
| server | `node tests/server.test.js` | **20 通过** | GET/PUT、按 at 合并、墓碑、过滤、重启持久化、坏 JSON、`.bak` 恢复、数据文件 404 |
| e2e | `node tests/e2e.test.js` | **29 通过** | 真实 Firefox：登录落盘；`banks ↔ setup` 侧边栏节点不重建；提交/切题骨架节点不重建；结果页切标签只换列表；换全新 profile 自动恢复 |

E2E 的可视验证（本轮做过）：

- 登录页：顶栏绿色云图标、昵称回填、底部提示“已从本机服务器恢复 3 项数据”。
- 答题页：状态条 / 题卡 / 选项 / 按钮 / 答题卡版式正常，`#quizRoot` 包裹层没有造成留白或错位。

---

## 9. 已知限制与下一步

### 限制

- 同步粒度是“一个 localStorage key”。同一用户在两个浏览器**同时**改同一张用户表时，按整张表最后写入的为准（key 级 last-write-wins），没有字段级合并。
- 数据只在本机 `data/state.json`，没有云端同步；换机器要手动拷文件（交接包已包含）。
- `node server.js` 下点侧边栏是**不同 HTML 文档的整页导航**；新页面在 hydrate 完成后淡入。要更快的切页需要 SPA / `pushState` 或先渲染本地再后台 hydrate（后者要小心 quiz 页没有本地进度时会提前跳走）。
- 没有做导出/导入 JSON 的 UI（当时用户选的是服务端自动落盘）。
- 没有启用跨文档 View Transition：Firefox 对 `@view-transition` 目前是部分支持，而且新页面 boot 是异步 hydrate，直接开有抓到空白快照的风险。
- 本轮改动未提交；`.git` 已打进交接包，但工作区改动是“未提交状态”。

### 可以接着做（按价值排序）

1. 先跑三套测试、通读 `HANDOFF.md` / `CONVERSATION.md`，确认环境。
2. 提交本轮改动（不要带 `data/state.json`）。
3. 如果用户还嫌切页慢：把侧边栏导航改成 `pushState` 页内切换，或做“首屏先渲染本地数据、后台 hydrate 后增量更新”；注意测试里 `FILE_MODE` / `PAGE` 的分支。
4. 如果用户要备份/换机：加导出/导入 JSON 的 UI（当时没做）。
5. 如果要做真正的旧页→新页交叉淡出：评估跨文档 View Transition，或 SPA 路由 + 同文档 View Transition。
6. 数据文件可以考虑移出 web 根目录（现在已挡住静态访问，但移出去更稳）。

---

## 10. 交接包

包名（在交接时生成）：

```
popipa-handoff-2026-10-19.tar.gz
popipa-handoff-2026-10-19.tar.gz.sha256
```

内容：整个 `popipa/` 工作区，包括：

- 源码、`README.md`、`HANDOFF.md`、`CONVERSATION.md`
- `tests/`（3 套）
- `dist/`（自包含部署副本）
- `vendor/`、`data/`（含**真实** `data/state.json` 和 `.bak`）
- `.git/`（完整历史 + 未提交工作区）
- `需求/`、`scripts/`、`new.md`、`成就.md`、`对话记录.jsonl`
- `.gitignore`

解包：

```bash
sha256sum -c popipa-handoff-2026-10-19.tar.gz.sha256
tar -xzf popipa-handoff-2026-10-19.tar.gz
cd popipa
node server.js
# 打开 http://localhost:8000/
```

Windows：PowerShell / cmd 里 `tar -xzf ...` 也可；或用 7-Zip 解 `.tar.gz` 再解 `.tar`。

**隐私警告**：包里有 `data/state.json`，包含真实用户的昵称、答题记录、错题、收藏等。只用于自己换机，不要上传到公开仓库/网盘公共链接。

---

## 11. 常见坑

1. **`file://` 下 localStorage 按文件隔离**：登录态传不到 `banks.html`，`app.js` 会退回单页内切换；也不会落盘。要持久化/多页跳转就用 `node server.js`。
2. **`localhost` vs `127.0.0.1`**：server 默认只监听 `127.0.0.1`；本机 `localhost` 可访问。局域网访问要 `HOST=0.0.0.0`，此时 `/api/state` 也会暴露，慎用。
3. **测试不要碰真实数据**：`tests/server.test.js` 和 `tests/e2e.test.js` 都用临时 `POPIPA_STATE`；手动实验也请用临时路径。
4. **`dist/` 容易和根目录不同步**：改完根文件记得 `cp`；`diff -q app.js dist/app.js`、`diff -q assets/app.css dist/assets/app.css` 可检查。
5. **不要用 `git checkout .` / `git reset --hard`**：本轮改动未提交。
6. **E2E 需要 Firefox + Marionette**：没有 Firefox 会自动跳过；有 Firefox 但启动失败时看 stderr 的 profile/端口信息。
7. **端口占用**：`node server.js 8080` 换端口；测试用随机端口。
8. **数据文件损坏**：启动会尝试 `.bak`；如果都坏，会用空数据启动（原文件保留）。不要手动删 `.bak`，除非确认不需要。
9. **同步冲突**：两个浏览器同时改同一用户，整张用户表 LWW；不要在两端同时刷同一用户还期望字段级合并。
10. **结果页列表**：`#resultList` 是切标签的更新目标；改结果页结构时保留这个 id，否则 `refreshResultTab()` 会退回整页 `render()`。
11. **答题页**：`#quizRoot` / `#quizBar` / `#quizCard` / `#qmap` 是增量更新的锚点；改结构时同步改 `patchQuiz()` / `patchQuizAnswered()`，否则会退回 `render()` 或更新不到。
12. **侧边栏**：`pageShell()` 复用 `.home-wrap` / `.home-main`；新增页面/导航项要同时改 `sideBar()` 的 `data-nav` 和 `active` 键。
13. **过渡**：`.view-enter` 只在 `viewKey` 变化时加；如果新页面/新视图需要过渡，确认 `viewKey()` 覆盖了它；同视图重绘不要手动加 class。

---

## 12. 关键代码坐标（交接时行号，可能随改动漂移）

| 位置 | 作用 |
|---|---|
| `app.js` 826 `viewKey()` | 判断“是否真换视图” |
| `app.js` 838 `render()` | 滚动保持 / 过渡触发 |
| `app.js` 888 `pulseView()` | 加 `.view-enter`，序列号 + reduced motion |
| `app.js` 1471 `patchQuizAnswered()` | 提交时只改选项/反馈/按钮 |
| `app.js` 1515 `renderQuiz()` | 建 `#quizRoot` 或 patch |
| `app.js` 1610 `submitCurrent()` | 提交入口，fallback `render()` |
| `app.js` 1756 `resultListHtml()` | 结果页当前标签列表 |
| `app.js` 1791 `refreshResultTab()` | 结果页切标签只换列表 |
| `app.js` 2412 `refreshSideBar()` | 复用侧边栏时更新高亮/计数 |
| `app.js` 2425 `pageShell()` | 侧边栏常驻 + 主区替换 |
| `server.js` 31 `isStateFile()` | 数据文件静态访问拦截 |
| `server.js` 77 `loadState()` | 主文件 / `.bak` 恢复 |
| `server.js` 96 `saveState()` | 原子写 + `.bak` |
| `server.js` 112 `mergeKeys()` | 按 `at` 合并 |
| `server.js` 178 `/api/state` | GET / PUT |
| `src/tailwind.css` 组件层 | `.view-enter` 100ms 过渡 |
| `tests/e2e.test.js` 238 / 267 / 446 | E2E 三段：落盘 / 页面内重绘 / 换浏览器恢复 |

---

## 13. 最后一句

先跑：

```bash
node tests/logic.test.js && node tests/server.test.js && node tests/e2e.test.js
```

全绿再动手。真实数据在 `data/state.json`，测试用临时文件；不要把它当草稿文件。
