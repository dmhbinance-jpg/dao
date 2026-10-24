# 道 (dao)

修仙题材挂机养成游戏的试玩版。当前阶段：**阶段 3.6 —— 锻造改版**（派人打造、要时间、品质按概率掷出、只打武器和胸甲）。阶段 3.5 做了配置网站、时间倍率、招募 3 选 1、名额 10。

- 玩：直接用浏览器打开 `index.html`（不需要构建、不需要服务器）；或者 `node tools/server.js` 后打开 http://localhost:8765/ 。
- 调数值：`node tools/server.js`，打开 http://localhost:8765/tools/ （配置网站：调参 + 存档工具，只写 `src/config/tuning.js`）。
- 开发工具：`v0.html` 是满编 5v5 战斗模拟器。
- 命令行：`node cli/invariants.js`（不变量检查，改引擎 / 回放 / 配置后先跑）、`node cli/stage3.js`（阶段 3 验收；所有命令行脚本加 `--defaults` 只用默认值）、`node cli/stage2.js` / `node cli/stage1.js`（回归）、`node cli/battle.js`（单场日志）、`node cli/sim.js 1000`（批量模拟）、`node cli/experiments.js 1000`（V0 设计验证）。

文档：
- `docs/STAGE3_6_HANDOFF.md` —— 阶段 3.6 交接说明，从这里开始
- `docs/STAGE3_5_HANDOFF.md` —— 阶段 3.5 交接说明（含配置网站用法）
- `docs/STAGE3_HANDOFF.md` —— 阶段 3 交接说明
- `docs/STAGE3_REPORT.md` —— 阶段 3 验收数据
- `docs/PRESENTATION.md` —— 表现层接口：战斗事件、回放渲染器、资源清单（给以后加图片和动画用）
- `docs/STAGE2_HANDOFF.md`、`docs/STAGE2_REPORT.md` —— 阶段 2
- `docs/STAGE1_HANDOFF.md`、`docs/STAGE1_REPORT.md` —— 阶段 1
- `docs/CHANGELOG.md` —— 变更记录
- `docs/STAGE0_HANDOFF.md`、`docs/HANDOFF.md`、`docs/DESIGN_QUESTIONS.md`、`docs/V0_SIM_REPORT.md` —— 更早阶段的交接与数据（部分过时）
