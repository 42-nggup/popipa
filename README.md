# popipa · 在线刷题

一个纯前端刷题页面：登录 → 选题库 → 组卷 → 答题 → 交卷看结果。
数据来自 `data/raw/*.md`，由 `scripts/parse-banks.js` 解析成 `app.data.js`；
样式基于 Bootstrap 5.3（本地 vendor，无构建步骤）。

## 运行

直接用浏览器打开 `index.html` 即可（`file://` 也能跑，不依赖服务器）。
测试：

```bash
node tests/logic.test.js
```

## 目录

```
index.html          页面骨架：顶栏、#app、两个 Modal、主题开关、Toast
app.css             自定义样式（颜色全部走 Bootstrap 变量，圆角用 --bs-border-radius*）
app.js              全部逻辑（渲染 / 判分 / 存储 / 事件）
app.data.js         题库（自动生成，勿手改）
data/               题库源文件与解析产物
scripts/            Markdown → JSON 的解析脚本
tests/logic.test.js Node 逻辑自测（极简 DOM 桩 + 假 Bootstrap Modal）
vendor/             Bootstrap、Bootstrap Icons、html2canvas
```

## 存储模型

- `popipa:users`：**用户表，只记身份**（`name` / `lastLogin`）。
- `popipa:u:<昵称>`：**每个用户一张表**，存这个用户的全部业务数据：
  - `theme` 明暗主题
  - `books{}` 进度（每个题库上次答到哪里）
  - `wrong{}` 错题本
  - `fav{}` 收藏（跨场次保留）
  - `history[]` 成绩摘要
  - `rounds[]` 逐轮记录：逐题作答（`order/answers/submitted`）、
    起止时间与用时（`startedAt/finishedAt/seconds`）、汇总
    （`total/correct/wrong/unanswered/rate/score`），最多保留 20 轮
- 旧版本把业务字段直接塞在 `popipa:users` 里，启动时 `migrateUsers()`
  会自动搬进各用户自己的表，用户表只留身份字段（幂等）。
- 更早的 `popipa:progress:*` / `popipa:records` 启动时直接删除。

## 答题规则

- **提交答案**：锁定本题，显示正确答案与解析；答对 3 秒、答错 10 秒后自动进入下一题。
- **下一题**：等同「提交答案」，只是答对时立刻前进；答错则留在本题看解析。
  没作答或已提交时直接切题。「上一题」只回退，不会顺手提交。
- **再练一遍没做对的**：交卷后出现在结果页，把这一轮「没做对」的题抽出来开新的一轮。
  新一轮是独立记录（新的 session id），原先那一轮的成绩、逐题记录、用时、进度
  都原样保留在 `rounds` 里，数字不会被覆盖。
  全对时按钮禁用（`title` 提示"这一轮没有答错的题"）。

### 「没做对」的定义

**已提交且判错**的题。

- 选了答案但没提交：不算「没做对」（它仍算未作答）。
- 完全没碰过的题：不算「没做对」。

## 导出分享图

结果页「导出分享图」用 html2canvas 截一张离屏绘制的成绩卡（品牌 / 正确率环 /
得分 / 用时 / 总题数·答对·答错·未答），在 Modal 里预览后可下载 PNG。
卡片颜色走 Bootstrap 变量，深色模式下导出的是深底。
`html2canvas` 未加载或渲染失败时会给出提示，不会白屏。

## 已知未完成

- 历史轮次（`rounds`）已经持久化，但页面上还没有"回看某一轮"的入口。
- `README` 之外的开发记录见 `整改需求.md`、`第二次需求整改.md`、`追加需求.md`。
