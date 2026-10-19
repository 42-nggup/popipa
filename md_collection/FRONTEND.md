# popipa 前端盘点与 Tailwind 迁移记录

> 迁移分支：`refactor/frontend`
> 迁移前可运行版本：tag `OK-to-run`（`a51e6fc`）

## 1. 迁移前的 CSS / 页面结构

旧前端是 **Bootstrap 5.3 + `app.css` 自定义样式**，没有构建步骤。`app.css` 共 509 行，按职责分成 15 段：

| 段落 | 内容 | 迁移处理 |
|---|---|---|
| 1 | Bootstrap 变量覆盖：圆角、字号 | 改为 Tailwind theme + CSS 变量 |
| 2 | 顶栏、品牌 logo、头像、同步云图标 | 保留结构，重写为 Tailwind 组件 |
| 2.1 | `.view-enter` 100ms 视图进入过渡 | 保留，只在 `viewKey` 变化时触发 |
| 3 | 主题开关 | 保留行为，改为本地 `data-theme` |
| 4 | 登录页 hero / 登录框 | 重新设计，补上回车提交 |
| 5 | 组卷页两栏 + sticky 汇总卡 | 保留布局语义，改 Tailwind 响应式 |
| 5.1 | 题库卡、章节 chips | 保留卡片/筛选交互，重写样式 |
| 6 | 章节 chips | 保留 `.chip.on` 定向更新 |
| 7 | 答题页：统计条、题卡、选项四态、答题卡 | 保留 `.opt.ok/no/sel/locked`、`.qmap b.ok/no/cur` |
| 8 | 结果页：环形正确率、数字统计 | 保留 conic-gradient，重写排版 |
| 9 | 历史轮次逐题表格 | 保留数据，改用自定义展开 |
| 10 | 自定义 Toast | 保留 `.show` 状态 |
| 11 | 分享图预览 / 离屏卡片 | 保留 html2canvas 方案 |
| 12 | 题型徽章、答题卡、模式切换、结果页、复习卡 | 拆成 Tailwind components |
| 13 | 移动端适配 | 重做断点，表格/侧边栏更稳 |
| 14 | 入场 / 交互动画 | 删掉会在同视图重绘时重复播放的区块动画 |
| 15 | 新主页、侧边栏、题库汇总、学习报告、主题色 | 保留信息架构，整体重绘 |

页面与主视图：

- `index.html` 登录页：顶栏 + 品牌 hero + 昵称登录卡。
- `home.html` 学习概览：侧边栏 + 随机欢迎语 + 每日目标 + 五项统计 + 上次进度 / 近日统计。
- `banks.html` 题库列表 + 组卷面板（同页切换）。
- `quiz.html` 答题页 + 结果页（同页切换）。
- `summary.html` 题库 → 章节 → 题型汇总，可只练一章。
- `stats.html` 答题曲线、排行榜、成就、成绩历史。
- `collection.html` 错题本 / 收藏集。

## 2. 迁移时修掉的疏漏

1. **登录不能回车提交**：旧版只有按钮 click；现在包成 `<form>`，Enter 可提交，并补 `aria-invalid` / 错误提示。
2. **Bootstrap JS 依赖**：旧版 Modal / Collapse 依赖 `bootstrap.bundle.min.js`。现在用原生 `<dialog>` 和自定义展开，删除 Bootstrap CSS/JS。
3. **历史轮次展开逻辑绕**：旧版把 `S.roundOpen` 和 Bootstrap collapse 混用，箭头状态靠 DOM 反查。现在直接控制 `.round-body[hidden]`，状态只认 `S.roundOpen`。
4. **同视图重绘动画**：旧版 `.bank-card`、`.setup-grid`、`.score-hero` 等每次重绘都重播入场动画，容易造成闪烁。新版只保留 `.view-enter`，并在 `viewKey` 变化时触发。
5. **键盘可达性**：题卡、题库卡等 `data-act` 元素补 `role="button"` / `tabindex="0"`，支持 Enter / Space；结果页标签补 `role="tab"` / `aria-selected`。
6. **弹窗可访问性**：原生 `<dialog>` 自带焦点管理、Esc 关闭；补 backdrop 点击关闭。
7. **表格窄屏**：历史成绩与排行榜统一 `.table-wrap`，窄屏可横向滚动；不再用 Bootstrap table 的响应式包裹类。
8. **主题属性统一**：从 `data-bs-theme` 改为 `data-theme`，登录页首屏脚本同步更新，避免深色闪白。
9. **重复动效/颜色 token**：颜色统一走 CSS 变量 + Tailwind theme，删除 Bootstrap 变量覆盖层。
10. **侧边栏移动端**：改为 3 列网格，底部每日热身单独一行，避免横向滚动截断。

## 3. Tailwind 结构

```
src/tailwind.css      Tailwind 源文件（base + components + utilities）
tailwind.config.js    theme：浅墨绿 / Tokyo Night 配色、字体、阴影、断点、dark 选择器
assets/app.css        编译产物（提交到仓库，部署不需要 npm install）
package.json          仅开发期构建 CSS 用；server.js 仍是零依赖
```

构建命令：

```bash
npm install
npm run build:css       # tailwindcss -i src/tailwind.css -o assets/app.css
npm run watch:css       # 开发时监听
```

运行应用仍然只需要：

```bash
node server.js
```

## 4. 渲染约束（不要破坏）

- `#top` / `#side` 是持久 App Shell，永远在 `#app` 外面；`pageShell()` 只替换 `#app`。
- `goPage()` 在 HTTP 下走 History API，`applyLocation()` 负责首次加载 / 前进后退还原。
- 答题页常驻 `#quizRoot`；提交走 `patchQuizAnswered()`，切题走 `patchQuiz()`。
- 结果页切标签只替换 `#resultList`。
- 所有动态状态类名保持语义化：`.opt.ok/no/sel/locked`、`.qmap b.ok/no/cur`、`.chip.on`、`.side-link.active`、`.tab.active`、`.rev.open`。
- 不要给同视图重绘加 `.view-enter`；`render()` 的 `viewKey` 判断是唯一入口。
- View Transition 只在 `viewKey` 变化时触发；顶栏 / 侧栏 / 内容分别有独立名字和 z-index。
