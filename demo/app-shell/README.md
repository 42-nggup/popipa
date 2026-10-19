# App Shell 小 demo

这是 A 方案（持久 App Shell + History API）的最小演示，只实现顶栏和侧边栏。

## 运行

从仓库根目录：

```bash
node server.js
```

打开：

```text
http://localhost:8000/demo/app-shell/index.html
```

> 也可以直接打开 `demo/app-shell/index.html`，但 `file://` 下部分浏览器不允许
> `history.pushState`，此时仍能切视图，只是地址栏和前进/后退不可用。

## 观察点

1. 顶栏右侧有 `Shell #xxxxxx`，侧边栏底部也有同一个编号。
2. 点击侧边栏的「学习概览 / 题库 / 学习报告」：
   - 主内容变化
   - `Shell #xxxxxx` 不变
   - 调试卡里「文档加载次数」保持 `1`
   - 「SPA 导航次数」递增
   - `#top 是同一个节点`、`#side 是同一个节点` 都是「是」
3. 点「进入答题态」：
   - `body[data-layout="focus"]` 隐藏侧边栏
   - 侧边栏 DOM 节点仍然存在（调试卡显示「隐藏（节点仍在）」）
   - 返回题库后侧边栏原样出现，编号不变
4. 在「学习概览 / 题库 / 学习报告」之间切换时：
   - 旧内容快速向上滑出
   - 新内容从下方滑入，逐渐减速到 0
   - 顶栏和侧边栏完全不动
   - 使用同文档 View Transition API；不支持时降级为只让新内容从下方进入
5. **进入答题态（focus 布局）和从答题态返回时不播放页面动效**：
   - 因为侧栏要隐藏 / 出现，布局会变化
   - 这部分保持即时切换，避免侧栏跟着滑动
6. 浏览器后退 / 前进，或调试卡里的「后退 / 前进」按钮：路由恢复，Shell 不动。
7. 点「硬刷新（会重建 Shell）」：编号变化、文档加载次数变为 `1`、SPA 导航次数归零。
   这是唯一会重新创建顶栏 / 侧边栏的情况。

## 文件

```text
demo/app-shell/
  index.html   静态 Shell（#top / #side 都在 #app 外面）
  demo.js      路由、render(#app)、popstate、主题切换
  demo.css     演示专用样式（答题态单列布局等）
```

正式迁移时，`index.html` 里的静态 Shell 会由模板生成到现有 7 个页面；
`demo.js` 中的 `navigate()` / `popstate` 逻辑会合并进 `app.js`。
