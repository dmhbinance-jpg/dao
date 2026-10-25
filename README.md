# 道 (dao)

修仙题材挂机养成游戏的试玩版。当前阶段：**阶段 4a —— 生产补完**（裁缝、饰品两条线开放，6 个装备槽，洞府六个建筑可升级，装备可出售 / 分解）。阶段 3.8 做了代码拆分（见 `docs/ARCHITECTURE.md`），3.7 做了存档保护、存档位、持续制造。

- 玩：`node tools/server.js` 后打开 http://localhost:8765/ （推荐：存档同时写到仓库的 `saves/` 目录，清了浏览器数据、换了端口都不丢）；也可以直接用浏览器打开 `index.html`（只存在浏览器里）。打开先进标题页，3 个存档位。
- 调数值：`node tools/server.js`，打开 http://localhost:8765/tools/ （配置网站：调参 + 存档工具，只写 `src/config/tuning.js`；调参页默认按对象显示：一只怪 / 一关 / 一张卡一张卡片）。
- 开发工具：`v0.html` 是满编 5v5 战斗模拟器。
- 命令行：`node cli/invariants.js`（不变量检查，改引擎 / 回放 / 配置后先跑）、`node cli/boundaries.js`（模块边界检查）、`node cli/fingerprint.js`（整局模拟指纹，重构前后对照）、`node cli/stage3.js`（阶段 3 验收；所有命令行脚本加 `--defaults` 只用默认值）、`node cli/stage2.js` / `node cli/stage1.js`（回归）、`node cli/battle.js`（单场日志）、`node cli/sim.js 1000`（批量模拟）、`node cli/experiments.js 1000`（V0 设计验证）。

文档：
- `docs/STAGE4A_HANDOFF.md` —— 阶段 4a 交接说明，从这里开始
- `docs/STAGE3_8_HANDOFF.md` —— 阶段 3.8 交接说明（代码拆分）
- `docs/ARCHITECTURE.md` —— 代码结构：模块、职责、依赖方向、新功能放哪（开发说明按这里的模块名指定改动范围）
- `docs/STAGE3_7_HANDOFF.md` —— 阶段 3.7 交接说明（存档保护、存档位、持续制造；含之前存档丢失的原因）
- `docs/STAGE3_6_HANDOFF.md` —— 阶段 3.6 交接说明（锻造、品质）
- `docs/STAGE3_5_HANDOFF.md` —— 阶段 3.5 交接说明（含配置网站用法）
- `docs/STAGE3_HANDOFF.md` —— 阶段 3 交接说明
- `docs/STAGE3_REPORT.md` —— 阶段 3 验收数据
- `docs/PRESENTATION.md` —— 表现层接口：战斗事件、回放渲染器、资源清单（给以后加图片和动画用）
- `docs/STAGE2_HANDOFF.md`、`docs/STAGE2_REPORT.md` —— 阶段 2
- `docs/STAGE1_HANDOFF.md`、`docs/STAGE1_REPORT.md` —— 阶段 1
- `docs/CHANGELOG.md` —— 变更记录
- `docs/STAGE0_HANDOFF.md`、`docs/HANDOFF.md`、`docs/DESIGN_QUESTIONS.md`、`docs/V0_SIM_REPORT.md` —— 更早阶段的交接与数据（部分过时）
