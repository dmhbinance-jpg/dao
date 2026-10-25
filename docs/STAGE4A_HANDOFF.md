# 交接说明（阶段 4a → 下一个对话）

## 一句话状态
阶段 4a 完成：生产补完。
- **三条线**：裁缝（敏、灵草：护手、靴子）和饰品（智、灵石：项链、戒指）开放，和锻造一样持续制造；装备槽补到 6 个。
- **采集**：三种原料各自采集，速率看对应三维。
- **建筑**：洞府六个建筑可以升级，决定采集工位、制造工位和品质概率。
- **出售分解**：装备可以单件或批量出售 / 分解，可以设置自动分解。
- **存档**：升到 v8，上一版存档能迁移。只走了流程，数值都是占位。

## 先读这些
1. `docs/ARCHITECTURE.md`（新增 buildings 模块和 app-workshop 页面）
2. `docs/CHANGELOG.md` 的「阶段 4a」一节
3. 阶段 3.8 / 3.7 交接说明：模块边界、存档位、持续制造仍然有效
4. 设计文档 v2.1：https://claude.ai/artifact/FWUbcSHc7BRpwMo5Ai4aPS（第 9、10、13 节，第 15 节「生产补完」条目）

## 验收（只看流程）
| 项 | 结果 |
|---|---|
| 三条线都能派人采集、持续打造，产出进背包、能穿到对应部位 | ✅ 浏览器：<br>• 顶栏显示灵矿 / 灵草 / 灵石；派人采灵草后，灵草产量和人数（1/3）变化<br>• 织坊派人持续打造护手<br>• 琢玉坊做好的项链进背包、接着做下一件，在角色页穿到项链槽（6 个槽）<br>命令行 L1、L2：速率看对应三维；时长看敏 / 智；扣灵草 / 灵石；穿上后加敏 / 智 |
| 建筑能升级，工位数和品质概率表随等级变化 | ✅ 浏览器：矿脉升到 2 级后采集工位 4；锻造房升到 2 级后品质概率变成白 80% 绿 18% 蓝 2%。<br>命令行：<br>• L3：满员不能再派，升级扣金币 + 灵矿后多一个工位<br>• L4：花费逐级 ×2、上限 5 级，5 级用 5 级品质表<br>• L5：锻造房 5 级有 3 个工位，可以同时派 3 人，召回按工位<br>• L6：5 级概率表抽 2 万次 |
| 出售 / 分解（单件和批量）正常，穿着的不能处理 | ✅ 浏览器：单件出售靴子金币增加；勾「白」批量分解要二次确认，之后背包里没有白装；自动分解设置存进存档。<br>命令行：<br>• L7：比例正确，穿着的出售 / 分解都返回不能处理，批量只动背包<br>• L8：自动分解设成「绿」时，白装产出直接分解 |
| `cli/invariants.js` 和边界检查通过 | ✅ 4,049 项全部通过（新增 L 组 12 项）；边界检查 54 个文件没有越界 |
| 上一版存档能迁移 | ✅ 浏览器：v7 老存档提示「v7 升级到 v8」，6 个槽（新线显示未开放）、原武器在、锻造房沿用 2 级、采集的人在、「暂不可用」的戒指恢复。<br>命令行：L10；L11（迁移时超出工位的采集人员不踢）；I14（更早的 v5 存档） |
| 其他 | 3.7 的存档流程 21 项、持续制造 11 项、整局手动走查 10 项全部重跑通过。全自动玩家用当前调参和默认值都 100% 打完前三段 |

## 规则怎么落地
- **原料与钱包**（economy）
  - 存档字段 `ore` `herb` `stone` 和 `gold`。
  - 花费 / 收入写成 `{ gold?, ore?, herb?, stone? }`，`canPay` / `pay` / `refund` 按里面出现的键处理。
  - 原料配置在 `CONFIG.game.gather.mats`：名字、看哪项三维、在哪个采集建筑、属于哪条线。
- **开放**（production）
  - `lineUnlocked(save, 线)`：锻造看 `unlocks.forge`（1-8 首通），裁缝 / 饰品看 `unlocks.tailor` / `unlocks.jewelry`。
  - 章节通关时 progress 的 `unlockLines` 按 `production.lines[].unlockChapter` 开放这些线，并排队 `gather2`。
  - 三条线在配置里都 `enabled: true`，所以 `gearSlots()` 一直是 6 个；没开放的线的部位不推荐、不让派人。
- **采集**
  - `save.gather = { ids, mats: { 角色 id: 原料 }, last }`。
  - `startGather(save, id, now, mat)`，`gatherBlock` 多了 `full`（工位满）和 `otherMat`（正在采别的）。
  - 工位数 = 采集建筑等级对应的 `slots[等级-1]`。超出工位的老数据保留，满员前不能再派。
- **建筑**（buildings）
  - `save.buildings = { mine, garden, quarry, forge, loom, jade }` 等级。
  - 升级花费 = `cost × costMult^(等级-1)`，即时完成，上限 `maxLevel`。
  - 主要接口：`upgradeBlock` / `upgradeBuilding` / `nextLevelInfo`。
  - `workshopLevel(save, 线)` 改成读制造建筑等级，品质表按这个等级取。
- **多工位生产**
  - `save.production.jobs[工位 id]`：第 1 个工位的 id 是线 id（兼容老存档），第 n 个是「线 id + n」。工位数看制造建筑。
  - 相关接口：
    - `startProduction` 占第一个空工位，返回工位 id
    - `recallProduction` / `switchProduction` / `craftRemainingMs` 都按工位 id
    - `jobsOfLine` 列出一条线的所有任务
    - `freeStation` 找空工位
  - `jobOfChar` 返回的任务带 `key`（工位 id）。
- **出售 / 分解**（equipment）
  - 单件：`sellPrice` / `salvageReturn`，`sellGear` / `salvageGear`。
  - 批量：`disposePreview` / `disposeMany(save, 'sell'|'salvage', { qualities?, slots?, ids? })`，只看背包。
  - `disposeBlock` 对穿着的返回 `worn`。
  - 自动分解：`settings.autoSalvage`（品质 id 或 null）。tickProduction 做完一件后，低于这个品质的直接 `salvageGear`，返回记录带 `salvaged`。
- **推荐** `nextUpgrade`，依次看：
  1. 背包里有更好的 → 穿上
  2. 各开放线的打造建议里能做的（派人 / 改做）
  3. 多余装备满 `surplusMin` 件 → 分解
  4. 能升级的建筑（在用的制造建筑、满员的采集建筑；升级后金币还要够研究下一个上阵位）
  5. 都做不了时返回第一条打造建议
- **引导**
  - `gather2`（采灵草 / 灵石）→ `craft2`（新部位开工）→ `equip2`（穿上新部位）。前两个在还有原料没人采、新线没人做时留在队列里（被挡住时不打断自动推关）。
  - `tidy`（整理装备）：背包满 `tidyAt` 件时由生产排队，可重复，确认后执行 `doAllUpgrades`。
- **存档 v8 迁移**（`migrateV7`）：
  - 原料：补灵草 / 灵石；采集人员都记为采灵矿。
  - 建筑：`workshops` → `buildings`。
  - 装备：补齐 6 个装备槽，恢复「暂不可用」的戒指。
  - 开放：已通第三段的开放新线（会排 `gather2`）。
  - 统计和设置：统计合并 `emptyStats()` 并把非数字清零，设置补 `autoSalvage`。

## 模拟参考（不作为验收）
- `node cli/stage3.js`：全自动玩家剑修 / 法修 100% 打完前三段（`--defaults` 也是）；第三段「没有大量囤积」两项仍是 ❌，阶段 3.6 起就这样。
- 全自动玩家在第三段内会把锻造房升到 2 级、分解多余装备。
- 打完后接着挂机 40 分钟（`simulate(..., { extraMinutes: 40 })`）：全自动玩家走完 `gather2 → craft2 → equip2`，三条线都在做，6 个部位基本穿满，背包靠「整理装备」保持在 10 件以内。
- 报告文件 `docs/STAGE1/2/3_REPORT.md` 按当前代码重新生成了。

## 发现的问题 / 以后要做
1. **打完第三段后金币过剩**：全自动玩家挂机 40 分钟后有约 10 万金币，3-8 挂机收入远超花销。目前没有后续内容，等数值统一调。
2. 全自动玩家在背包没满、也没卡关时，不会主动换上更好的新装备，要等「整理装备」引导（满 10 件）。
3. 自动分解只处理持续制造的产出，背包里已有的不会自动处理（按要求）。
4. 建筑升级的推荐只看在用的制造建筑和满员的采集建筑，不会为了品质主动升没人用的线。
5. `src/battle/engine.js` 仍是 567 行（边界检查只提示）。

## 改了哪些文件
- 新增：
  - `src/game/buildings.js`
  - `src/ui/app-workshop.js`
  - `docs/STAGE4A_HANDOFF.md`
- 修改：
  - 规则层：`src/game/economy.js`、`production.js`、`equipment.js`、`guide.js`、`progress.js`、`recruit.js`、`roster.js`、`save.js`
  - 配置：`src/config/game.js`、`assets.js`
  - 界面：`src/ui/app-cave.js`、`app-roster.js`、`app-activity.js`、`app-modal.js`、`app-flow.js`、`app-core.js`、`style.css`
  - 加载列表：`index.html`、`src/node.js`、`tools/save.html`
  - 工具：`tools/save.js`、`tools/validate.js`、`tools/entities.js`
  - 命令行：`cli/invariants.js`、`cli/lib/play.js`、`cli/lib/boundaries.js`
  - 文档：`docs/ARCHITECTURE.md`、`docs/CHANGELOG.md`、`README.md`、`docs/STAGE1/2/3_REPORT.md`
