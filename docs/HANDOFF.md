# 交接说明（V0 → 下一个对话）

## 一句话状态
V0 完成：地基（配置表、种子随机数、事件系统、标签、数据模型）+ 可在命令行独立运行的拉条战斗模拟器 + 浏览器界面（阵容编辑 / 战斗播放 / 批量模拟 / 配置表）。四个设计问题已用模拟跑出结论，见 `docs/DESIGN_QUESTIONS.md`，**等设计对话决定后再改规则**。

## 先读这些
1. 设计文档 v2.1：https://claude.ai/artifact/FWUbcSHc7BRpwMo5Ai4aPS （重点第 4、5、6、8 节）
2. `docs/DESIGN_QUESTIONS.md`：结论 + 实现时做的 10 条假设 + 文档层面的问题
3. `docs/V0_SIM_REPORT.md`：原始实验数据
4. `docs/CHANGELOG.md`

## 怎么跑
```bash
# 浏览器：直接双击 index.html（file:// 可用，不需要服务器、不需要构建）
node cli/battle.js 1          # 单场完整日志
node cli/sim.js 1000          # 默认阵容批量模拟（约 1 秒）
node cli/experiments.js 1000  # 四个问题的实验（约 1 分钟），覆盖写入 docs/V0_SIM_REPORT.md
```
Node 18+ 即可，无依赖。

## 代码结构
```
index.html              入口；<script> 顺序 = 依赖顺序
src/node.js             Node 入口；文件列表必须和 index.html 一致
src/core/               地基：tags → rng → events → model
src/config/             配置表 DAO.CONFIG：coef（系数）/ skills / talents / characters
src/battle/             战斗：targeting（选目标）/ damage（五乘区 + 贡献归因）/ engine（拉条主循环）/ log（日志文本）/ simulate（批量）
src/ui/                 界面：util / config-view / state / editor / player / batch / main / style.css
cli/                    battle.js / sim.js / experiments.js
```

### 关键约定
- **不用 ES modules**：Chrome 在 file:// 下会拦 ES 模块。每个文件是 IIFE，挂到 `globalThis.DAO`，浏览器用 `<script>`、Node 用 `require` 加载同一份代码。新增文件要同时加到 `index.html` 和 `src/node.js`。
- **逻辑层不碰 DOM**：`src/core`、`src/config`、`src/battle` 里没有任何浏览器 API。界面只读 `Battle.run()` 返回的日志和快照来回放。
- **所有数值进 `DAO.CONFIG`**：代码里不写魔法数。界面「配置表」页改的是同一个对象，存在 localStorage（`dao.v0.config`），点「恢复默认」清掉。
- **随机只走 `battle.rng`**：要加新的随机，一定用它，否则复盘失效。

### 引擎要点（`src/battle/engine.js`）
- 主循环：再动优先 → 行动条满的单位（同条按速度，再按开场随机的 tiebreak）→ 推进时间到下一个满条或回合边界。
- 一次行动：持有者 buff −1 → 选技能（优先级 + 释放条件）→ 置 CD → 发「出手时」→ 结算命中（每次命中依次发暴击时 / 受击时 / 击杀时）→ 效果 → 其他技能 CD −1 → 扣行动条。
- 触发效果在 `applyTrigger` 里，支持：cdReduce、extraAction、healSelf、shieldSelf、buffSelf、buffRow、pushSelf。新增触发效果加在这里。
- 技能效果在 `applyEffect` 里，支持：buff、debuff、guard、taunt、shield、push、pull、heal。
- `record: true` 时每条日志带全场快照（界面回放用）；批量模拟关掉以提速（1000 场约 1 秒）。

## 已知问题 / 没做的
- 默认对局 A 方优势大（80% / 6% / 平 14%），平均 26 回合偏长。原因是两边都有「护体罡气」回血，见设计问题 Q1。数值是占位的，没继续调。
- 闪避没做（文档说敏给闪避，但和「完全确定」有冲突，等设计对话）。
- 第 6 上阵位、尸傀、装备、境界解锁都不在 V0 范围。
- 存档只存阵容和配置（localStorage，带版本号 1）。
- 界面的 Google 字体需要联网，离线会退回系统宋体，不影响功能。

## 下一步建议（等设计对话的结论）
1. 设计对话对 Q1–Q4 和「实现假设」表拍板后，改规则（多数是改 `coef.js` 开关或 `engine.js` 里一两处）。
2. 规则定了再做一轮数值：目标是默认对局接近 50%、平均 10–15 回合、平局 <5%。`cli/experiments.js` 可以当回归测试反复跑。
3. V1 之前补自动化测试：至少「同种子结果一致」「再动每回合 ≤1」「每排 ≤3」「破甲不低于 0」几条不变量。
