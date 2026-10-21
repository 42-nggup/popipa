# popipa · 在线刷题

一个刷题页面：登录 → 选题库 → 组卷 → 答题 → 交卷看结果。
样式基于 **Tailwind CSS 3.4**。

> 持久顶栏 / 侧边栏的小 demo 见 [src/demo/app-shell/README.md](src/demo/app-shell/README.md)，
> 仅用于本地开发，不进入部署产物。

## 运行

推荐用本地服务器打开（同源页面共享 localStorage，数据自动落盘）：

```bash
npm install             # 首次构建需要
npm run build           # 编译 CSS 并生成 dist/
node server.js          # 默认 8000 端口，只监听 127.0.0.1
# 打开 http://localhost:8000/
```

如果 `dist/` 已经是最新版本，也可以直接运行 `node server.js`。

也可以直接双击 `src/index.html`。但浏览器在 `file://` 下会**按文件隔离
localStorage**（登录态传不到下一个 HTML），所以此时 `app.js` 会自动退回
“单页内视图切换”：功能完整，只是地址栏不会变成 `banks.html` / `quiz.html`，
而且**不会落盘**（顶栏会显示灰色的“仅本机”图标）。想要地址栏同步和自动持久化，
请用 `node server.js`。用其他静态服务器打开时，页面仍可用，但检测不到
`/api/state` 就自动退回纯 localStorage 模式。

Docker 部署：

```bash
docker compose up -d --build
# 构建阶段会 npm ci，并拉取 Bootstrap Icons / html2canvas
# Node 只暴露在 127.0.0.1:3000，供 OpenResty 反向代理
# 真实数据落在 ./popipa-data/state.json
```

用 1Panel + OpenResty 时，反向代理填 `http://127.0.0.1:3000` 即可；
HTTPS 仍由 1Panel 的网站监听端口（例如 8000）负责。

数据默认存到 `data/state.json`，每次改动后自动保存。换端口 / 换数据文件：

```bash
node server.js 8080                     # 换端口
PORT=8080 node server.js                # 同上
POPIPA_STATE=/path/to/state.json node server.js   # 换数据文件
HOST=0.0.0.0 node server.js             # 允许局域网访问（接口也会暴露，慎用）
```

HTTP 模式下做题页地址需要带 `?bank=<题库 id>`（从主界面点「开始答题」
会自动带上）；直接手输不带参数会回到主界面。

修改源码后重新构建：

```bash
npm install
npm run build           # 编译 CSS + 组装 dist/
npm run watch:css       # 只监听 CSS 变化
```

## 目录

```text
src/
  index.html        登录页
  home.html         新主页（侧边栏、每日目标、统计、同意弹窗）
  summary.html      题库汇总
  stats.html        学习报告（曲线、排行榜、同意弹窗）
  collection.html   错题本 / 收藏集
  banks.html        题库列表 + 组卷面板
  quiz.html         做题页（分享预览 Dialog）
  app.js            页面路由 / 渲染 / 判分 / 存储 / 同步 / 事件
  app.data.js       题库（自动生成，勿手改）
  tailwind.css      Tailwind 源文件
  assets/           编译后的 CSS、站点图标
  vendor/           npm 依赖生成（Bootstrap Icons / html2canvas，不提交）
  demo/app-shell/   持久 App Shell 演示（仅开发，不部署）

server.js           零依赖静态服务器 + /api/state 数据落盘
tailwind.config.js  主题、字体、阴影、dark 选择器
scripts/            题库解析、dist 构建脚本
tests/              逻辑 / 服务端 / e2e 测试
data/               题库 JSON；运行时数据在 data/state.json（已 gitignore）
docs/               Markdown 题库源文件、解析报告与项目文档
dist/               构建产物，Docker 部署使用
Dockerfile
docker-compose.yml
```

Bootstrap Icons 和 html2canvas 通过 `npm install` 安装，并在构建时复制到
`src/vendor/`；它们不提交到仓库，但会进入最终的 `dist/`，运行时不依赖外部 CDN。

所有页面共用同一份 `app.js`。`#top` 和 `#side` 是持久 App Shell，
`#app` 是唯一会被替换的主内容区域。`goPage()` 在 `http(s)` 下用 History API
`pushState` + `render()`，不会重新加载文档；`file:` 下退回纯页内切换。
启动和浏览器前进 / 后退都会通过 `applyLocation()` 从当前 URL 还原状态
（`banks.html?bank=…&chapter=…&scope=…` 也支持直接打开）。

## 存储模型

浏览器里的 localStorage 仍是读写入口；跑 `node server.js` 时，可共享的部分会自动落盘：

- `popipa:users`：**用户表，只记身份**（`name` / `lastLogin`）。
- `popipa:u:<昵称>`：**每个用户一张表**，存这个用户的全部业务数据：
  - `theme` 明暗主题
  - `books{}` 进度（每个题库上次答到哪里）
  - `wrong{}` 错题本
  - `fav{}` 收藏
  - `goal` 每日写题目标（5–200）
  - `consent` 是否同意答题数据用于统计（`null` = 还没问）
  - `lifetime{answered,correct,seconds}` 终身累计（不随轮次截断丢失）
  - `days{'YYYY-M-D':{answered,correct}}` 按天累计，用于主页近日统计
  - `ach{}` 已解锁成就：id → 时间戳（跨场次保留）
  - `history[]` 成绩摘要
  - `rounds[]` 逐轮记录：逐题作答（`order/answers/submitted`）、
    起止时间与用时（`startedAt/finishedAt/seconds`）、汇总
    （`total/correct/wrong/unanswered/rate/score`），最多保留 20 轮

### 自动落盘（node server.js）

- **写**：所有可共享的 `popipa:*`（用户表、每用户表、`popipa:last`）在写入后
  防抖 500ms 推给 `/api/state`；关闭页面 / 切到后台时再用 `keepalive` 补一次。
  服务端按每个 key 的 `at` 做 last-write-wins 合并，原子写到 `data/state.json`
  （上一版留成 `state.json.bak`）。
- **读**：打开页面时先 `GET /api/state`，只把“比本机新”的 key 写回 localStorage，
  再把合并后的快照推回去。所以清缓存 / 换浏览器后，用户表、进度、错题、收藏、
  成绩、成就都会自动恢复；本机较新的数据也不会被服务器上的旧副本盖掉。
- **删除**用墓碑（`v: null`）同步，删掉的 key 不会下次又被拉回来。
- **不同步**：`popipa:user`（当前登录态）和 `popipa:theme`（本机主题）留在各自
  浏览器。换浏览器后需要重新登录一次，昵称已自动回填。
- **状态图标**：顶栏云图标绿色=已保存；黄色=暂时连不上、正在重试；灰色=纯本机
  模式（`file://`、普通静态服务器，或接口不可用）。
- **数据文件**不会被暴露
  想手动备份就复制 `data/state.json`；要换位置用 `POPIPA_STATE=/path/to/state.json`。

## 答题规则

- **提交答案**：锁定本题，显示正确答案与解析；答对 3 秒、答错 10 秒后自动进入下一题。
- **下一题**：等同「提交答案」，只是答对时立刻前进；答错则留在本题看解析。
  没作答或已提交时直接切题。「上一题」只回退，不会顺手提交。
- **交卷**：当前题有答案但没提交时，先提交再交卷；没作答/已提交则直接交卷。
- **组卷筛选**：章节和题型在同一页勾选，只出「选中章节 × 选中题型」的题；
  从错题集/收藏集进入时，仍可在这两个集合内继续按章节、题型筛选。
- **每日热身**：侧边栏底部，从全部题库随机抽 5 道题，跨题库成局。
- **数据收集**：首次进新主页会弹窗询问；只有 `consent === true` 的用户
  才进入学习报告的排行榜，拒绝后不再打扰。
- **成绩历史**：学习报告最下方复用题库页的「我的成绩历史」，可展开看逐题记录。
- **成就**：学习报告最下方 13 个成就（首次答题/交卷、排行榜前 10/5/1、
  5 次每日热身、5 天达成目标、10 轮、100/500 题、单轮全对、10 收藏、
  连续 7 天），解锁时间存 `ach`，之后一直保留。
- **主题**：浅色走浅墨绿，暗色走 Tokyo Night；点导航栏的 popipa 回新主页。
- **再练一遍没做对的**：交卷后出现在结果页，把这一轮「没做对」的题抽出来开新的一轮。
  新一轮是独立记录（新的 session id）
  全对时按钮禁用（`title` 提示"这一轮没有答错的题"）。

### 收藏集 / 错题集

题库卡上按题库显示「错题集 N」「收藏 N」两个入口，点击与「开始练习」走同一条路：
进入组卷页，并**自动勾选**「只练错题集」或「只练收藏集」。开始答题时就只出这部分题
（组卷页里仍可继续按章节、题型筛选），轮次标题会标成「· 错题集 / · 收藏集」。集合为空时入口禁用；带空集合进入会退回按章节练。

## 导出分享图

结果页「导出分享图」用 html2canvas 截一张离屏绘制的成绩卡（品牌 / 正确率环 /
得分 / 用时 / 总题数·答对·答错·未答），落款是「📢U咩哇帕瓦📢」，
在原生 `<dialog>` 里预览后可下载 PNG。
卡片颜色走 Tailwind 主题变量，深色模式下导出的是深底。

## 历史轮次回看

选题页底部「我的成绩历史」按时间倒序列出每一轮，点开原地展开（自定义 toggle，不跳页）：

- 表格列：`题号 / 用户答案 / 正确答案 / 解析`
- **只列已作答的题**，未作答的不出现
- 最后一行汇总：`总题数 / 答错 / 答对 / 未答 / 正确率`

## 界面过渡

- 顶栏 / 侧边栏是持久 App Shell，站内切换只替换 `#app`，节点不重建。
- 真正换视图时使用 View Transition：
  - 旧内容快速向上滑出
  - 新内容从下方滑入并减速到 0
  - 进入 / 离开答题态时，侧栏向左滑出 / 从左侧滑入
  - 顶栏单独命名并压在最上层，不会被内容快照盖住
- 同一视图的重绘（提交答案、切题、结果页切标签、排序、展开）**不播放过渡**，并保持滚动位置。
- 答题页常驻 `#quizRoot`：提交只更新选项 / 反馈 / 状态条，切题只换题卡和答题卡格子，
  不再整块重建 `#app`；结果页切标签也只替换题目列表。

例如 `http://localhost:8000/home.html?brand=umewa`。

## 已知限制

- 同步粒度是“一个 localStorage key”。同一用户在两个浏览器**同时**答题时，
  按整张用户表最后写入的那份为准（key 级 last-write-wins），没有字段级合并。
- 数据只落在本机 `data/state.json`，没有云端同步；换机器需要手动拷贝该文件。
- 服务默认只监听 `127.0.0.1`；手机 / 局域网访问要 `HOST=0.0.0.0`，
  此时 `/api/state` 也会暴露在局域网里，请自行权衡。
