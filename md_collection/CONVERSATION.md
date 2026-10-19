# 本轮对话记录（给下一个 AI 的上下文）

> 这是对 2026-10-18 ~ 2026-10-19 这轮对话的**人工整理版**，不是逐字 transcript。
> 目的是让接手者知道“用户要什么、为什么这么做、哪些方案被否了、现在停在哪”。
> 工作区里另有一份 `对话记录.jsonl`，是既有日志，可能包含更早的对话；以本文件 + `HANDOFF.md` 为准。

- 工作区：`/home/nggup42/production/popipa`
- 项目：popipa 刷题应用
- 分支：`main`，最后提交 `cd43511`
- 本轮结束时：改动**未提交**，三套测试全绿（logic 267 / server 20 / e2e 29）

---

## 1. 用户需求一：localStorage 持久化

### 用户原话

> “能不能把浏览器保存的localstorage持久化”

### 当时的现状

- 应用是纯前端 + localStorage；`README.md` 的“已知未完成”里写着“没有服务端，所有数据只在当前浏览器的 localStorage 里”。
- 已有 `server.js`，但只是静态服务器，没有数据接口。
- 用户清缓存 / 换浏览器就会丢进度、错题、收藏、成绩、成就。

### 方案选择

助手给了三个选项：

1. **服务端自动落盘 + 自动恢复（推荐）**：跑 `node server.js` 时自动写 `data/state.json`，打开页面自动拉回。
2. 方案 1 + 导出/导入 JSON 备份 UI。
3. 只做导出/导入 JSON，不依赖服务端。

用户选择 **方案 1**，所以本轮**没有做导出/导入 UI**。

### 实现内容

- `server.js`：
  - `GET /api/state`、`PUT /api/state`（也接受 POST）；
  - 按每个 key 的 `at` 做 last-write-wins 合并；
  - `v:null` 墓碑表示删除；
  - 原子写 `data/state.json`（tmp + rename），保留 `.bak`；
  - 主文件损坏时优先从 `.bak` 恢复；
  - 默认只监听 `127.0.0.1`；
  - 数据文件不能被静态服务下载。
- `app.js`：
  - `store.set/del` 仍写 localStorage，同时记 `popipa:sync.at[k]` 并防抖 500ms 推送；
  - `hydrate()` 打开页面先 GET，只把比本机新的 key 写回，再把合并快照 PUT 回去；
  - 关页面 / 切后台 `flushSync()` 用 keepalive 补推；
  - `popipa:user`（当前登录）和 `popipa:theme`（本机主题）不同步；
  - 顶栏加同步状态云图标（绿/黄/灰）。
- 同意弹窗文案改成“数据保存在本机浏览器和本机数据文件（data/state.json），不会上传到外部网络”。
- `README.md` 增加“自动落盘”说明；`.gitignore` 忽略 `data/state.json*`；`dist/` 同步。

### 验证

- `node tests/logic.test.js`：261 通过（新增同步快照 / 合并 / 墓碑 / hydrate / 接口不可用降级）。
- `node tests/server.test.js`：从 17 增加到 20（合并、墓碑、重启、`.bak` 恢复、数据文件 404、坏请求）。
- `node tests/e2e.test.js`：真实 Firefox，登录 → 落盘 → 换全新 profile → 用户表/昵称/身份表恢复，登录态仍在本机。
- 截图确认登录页顶栏绿色云图标、昵称回填、提示“已从本机服务器恢复 3 项数据”。

### 当时的一个取舍

- 登录态 `popipa:user` 不同步：换浏览器需要重新登录一次（昵称已回填），但避免“一个浏览器退出导致另一个也退出”。
- 主题 `popipa:theme` 不同步：按设备保留，登录后使用该用户的 `u.theme`。

---

## 2. 用户需求二：页面切换过渡 + 不要重绘闪烁

### 用户原话

> “每次切换页面时加一个小的过渡，不要让重绘页面时出现闪烁”
>
> 随后补充：
>
> “由整页重绘导致”

### 问题定位

- `render()` 每次通过 `app.innerHTML` 重建整个 `<main>`，包括侧边栏；
- `renderQuiz()` 每次提交 / 切题都重建整个 `#app`；
- 结果页切标签也整页重建；
- 这些整页替换会造成闪烁 / 侧边栏消失再出现。

### 方案演进

最初的方案是“加一个 180ms 淡入 + 轻微上移”。用户指出根因是整页重绘后，改为**先收窄重绘范围，再加过渡**：

1. **侧边栏常驻**
   - `pageShell()` 复用 `.home-wrap` / `.side`，只替换 `.home-main`；
   - `refreshSideBar()` 只更新高亮、`aria-current`、错题/收藏计数；
   - 顶栏本来就在 `#app` 外，不参与重绘。

2. **答题页常驻 `#quizRoot`**
   - 第一次建骨架；同一 session 后续只 patch 状态条 / 题卡 / 答题卡；
   - `submitCurrent()` 走 `patchQuizAnswered()`：不重建题卡，只锁选项、标对错、插反馈、换按钮、更新状态条和格子；
   - 切题走 `patchQuiz()`：只换题卡内容和格子，`#qmap` 节点保留。

3. **结果页切标签只换列表**
   - `resultListHtml()` + `refreshResultTab()`；
   - 只更新 `#resultList` 和标签高亮。

4. **过渡只加在真换视图**
   - `viewKey()` 判断视图 + 上下文（collection 类型、setup 题库、quiz/result session id）；
   - `render()` 同视图保持滚动，换视图回顶部；
   - `pulseView()` 只在 `viewKey` 变化时加 `.view-enter`；
   - 同视图重绘（提交、切题、结果页切标签、排序、展开）不加动画；
   - 尊重 `prefers-reduced-motion`；快速连续切页有序列号防护。

### 验证

- E2E 从 13 项扩展到 29 项，新增：
  - `banks → setup` / `setup → banks` 侧边栏节点是同一个；
  - 提交答案后 `#quizRoot` / `#quizBar` / `#quizCard` / `#qmap` 四个节点都还在；
  - 切下一题后四个节点仍然不重建；
  - 结果页切“错题”标签不重建骨架；
  - 同视图重绘不带 `.view-enter`，换视图才带。
- 截图确认答题页版式正常。

### 已知边界

- `node server.js` 下点侧边栏仍是**不同 HTML 文档的整页导航**；这次给新页面内容加了淡入，但没有做旧页→新页的交叉淡出。
- 跨文档 View Transition 未启用：Firefox 支持是部分；且新页面 boot 是异步 hydrate，直接开有抓到空白快照的风险。
- 如果还要更快，下一步是 SPA / `pushState` 或“先渲染本地数据再后台 hydrate”（后者要小心 quiz 页没有本地进度时会提前跳走）。

---

## 3. 用户需求三：加快

### 用户原话

> “有点慢，加快一点”

### 调整

- 过渡 180ms → **100ms**；
- 起始透明度 35% → **60%**；
- 位移 4px → **2px**；
- 缓动 `cubic-bezier(.2,.8,.2,1)`；
- 动画清理定时器 400ms → **220ms**。

没有改架构；如果用户后续仍觉得切页慢，再考虑 SPA / 先渲染本地。

---

## 4. 本轮顺手修的问题

1. **服务端数据文件可能被直接下载**
   - 现象：`POPIPA_STATE` 指向临时文件时，默认 `data/state.json` 仍能被 `/data/state.json` 请求到。
   - 修复：`isStateFile()` 同时挡默认路径和 `POPIPA_STATE` 路径的 `.json/.bak/.tmp`。
   - 测试：server 20 项，含“数据文件 / 备份不能直接下载”。

2. **逻辑测试偶发失败**
   - 现象：第 50 组“终身累计写题数与正确率”约 1/10 概率失败。
   - 根因：测试没有重置 `S.mode`，随机顺序偶尔把填空题排到第一题，`pickKey(answer[0])` 对填空题判错。
   - 修复：测试直接写入正确答案，不依赖题型/顺序；连跑 20 次稳定 267 通过。

3. **`.bak` 恢复**
   - 主数据文件损坏时，启动尝试 `.bak`；保存时只有当前文件是有效 JSON 才备份，避免把损坏内容覆盖好备份。

---

## 5. 本轮结束时状态

- 分支 `main`，最后提交 `cd43511`。
- 有未提交改动（见 `HANDOFF.md` 第 7 节）。
- 三套测试：
  - logic 267
  - server 20
  - e2e 29
- 真实数据 `data/state.json` 存在且未被测试修改；已 gitignore。
- `dist/` 已同步。
- 交接包包含 `.git`、`data/`、`dist/`、`vendor/`、tests、docs。

---

## 6. 给下一个 AI 的建议顺序

1. 读 `HANDOFF.md` 第 0、1、2、6 节。
2. `git status`，确认未提交改动；不要 `git reset --hard`。
3. 跑三套测试确认环境。
4. 先提交本轮改动（不要带 `data/state.json`），或按用户要求继续开发。
5. 如果用户提“切页慢”，优先考虑 SPA / `pushState` / 先渲染本地；不要只调动画时长。
6. 如果用户提“备份 / 换机”，再做导出/导入 JSON（本轮没做）。
7. 任何时候不要碰 `data/state.json` 的真实数据；测试用 `POPIPA_STATE` 临时文件。
