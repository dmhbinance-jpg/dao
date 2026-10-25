# 交接说明（阶段 3.8 → 下一个对话）

## 一句话状态
阶段 3.8 完成，这一阶段是纯重构：
- `src/game/game.js` 拆成 12 个规则模块，`src/ui/game-app.js` 按页面拆成 10 个界面文件。
- 模块之间只调公开函数，界面不直接改存档；新增边界检查，规则见 `docs/ARCHITECTURE.md`。
- 规则、数值、界面行为都没改：同种子整局模拟重构前后逐项一致，浏览器里两版行为相同。

## 先读这些
1. `docs/ARCHITECTURE.md`：模块列表、职责、依赖方向、存档字段归属、新功能放哪。以后的开发说明按这里的模块名指定改动范围。
2. `docs/CHANGELOG.md` 的「阶段 3.8」一节
3. 阶段 3.7 交接说明 `docs/STAGE3_7_HANDOFF.md`：存档位、持续制造的规则仍然有效。文件名改了：
   - `game.js` 里的存档部分 → `save.js`
   - 生产部分 → `production.js`
   - `game-app.js` 里的标题页 → `app-title.js`
4. 设计文档 v2.1：https://claude.ai/artifact/FWUbcSHc7BRpwMo5Ai4aPS

## 验收
| 项 | 结果 |
|---|---|
| 重构前后同一组种子整局模拟逐项一致 | ✅ `cli/fingerprint.js`（新增）共 28 局：标准 / 全自动 × 剑修 / 法修 × 6 人，外加单人 4 局，走完前三段，结果 JSON 含最终存档。当前调参、`--defaults` 各跑一遍，56 个 sha1 和重构前（阶段 3.7 代码副本）完全相同。`stage1.js` / `stage2.js` / `stage3.js` 的报告和重构前也一字不差（耗时那行除外） |
| `cli/invariants.js` 全部通过，新增边界检查通过 | ✅ 4,037 项全部通过。K1：边界检查（分层引用、DOM、字段归属、界面不改存档）。K2：界面 / 命令行 / 工具用到的 `DAO.Game` 函数都存在（3.7 的 145 个对外函数都还在，现在共 183 个）。K3：`index.html` 和 `node.js` 加载的文件一致。K4：模块文件开头都有说明 |
| 浏览器里手动走一遍：新游戏、招募、研究、采集、打造、插卡、推关、存档读档 | ✅ 自动化脚本在重构前、后两版上各跑一遍，输出逐行相同：<br>• 新游戏 → 挑战 1-1 并跳过回放 → 存档工具解锁到 2-1、加金币灵矿<br>• 引导依次弹出：一个人不够 → 首抽 3 选 1 → 采集灵矿 → 招募 3 选 1 → 第一段通关 → 第一张技能卡：穿云剑 → 插入「穿云剑」 → 研究第 2 个上阵位 → 打第一件装备 → 招募 3 选 1<br>• 洞府里有新同伴、研究中、有人采集、有人在持续打造；角色卡槽插上了穿云剑（97 档）<br>• 手动保存 → 回标题页 → 继续游戏，金币 / 名额一致；刷新后能继续<br>阶段 3.7 的存档流程 21 项、持续制造 / 多标签页 11 项也都重跑通过。配置网站和 V0 页面加载无错误 |
| 更新 CHANGELOG、写交接说明、存进项目 | ✅ |

## 拆分结果

### `src/game/`（都挂在 `DAO.Game`）
```
common.js 26   save.js 217   save-slots.js 263   economy.js 27（新）   roster.js 179   progress.js 188
recruit.js 186   research.js 119   production.js 319   equipment.js 184   cards.js 147   guide.js 132   auto.js 52   clock.js 40
```

### `src/ui/`（共享 `DAO.App`）
```
app-core 221   app-title 244   app-activity 135   app-stages 114   app-cave 251   app-roster 153
app-bag 127   app-modal 226   app-flow 207   app-main 105
```

### 拆分方法
用 TypeScript 编译器做作用域解析，脚本按函数归属搬运代码。函数体除了下面几类改动，其余原样保留：
- **规则层**：跨模块引用的函数名改成 `G.名字`。
- **界面层**：
  - 跨文件用到的 `let` 状态改成 `A.名字`。
  - 跨文件用到的函数 / 常量在定义它的文件里导出到 `A`，别的文件写 `A.名字`。
- **手工改的几处**：边界整改，把「改别的模块的字段」换成调对方的函数。

### 边界整改（调用新函数，结果不变）

| 原来的写法 | 位置 | 改成 |
|---|---|---|
| 直接改 `save.gold` / `save.ore` | production、progress、recruit、research | economy（`pay` / `refund` / `spendGold` / `addGold` / `addOre`） |
| 直接改 `save.stats.*` | production、progress | `addStat` |
| `save.nextId++` + `save.roster.push` | recruit | `newCharId` / `addChar` |
| `save.gearBag.push` + `save.nextGearId++` | production | `addGear` |
| 改 `save.guide.*` | progress、research | `retireGuide` / `requeueGuide` |
| 写 `save.auto.lastAttempt` | progress | `noteAttempt` |
| 改设置、自动推关开关、挂机关卡、时钟、`bagNew` | 界面 | `setSetting` / `setAuto` / `setIdle` / `setClock` / `dismissCardPrompt` |

### 边界检查怎么查（`cli/lib/boundaries.js`）
- 自带一个简单词法分析器（不依赖第三方包），先去掉注释、字符串、正则，再按词法模式查。
- 分层引用：按各层定义的命名空间判断，例如 `DAO.Game` 属于 game 层。
- 字段归属：查 `save.字段` 开头的写操作，包括 `=`、`+=`、`++`、`delete`、`.push(` 等；角色的 `level` / `exp` / `equip` / `card` 也按属性名查。
- 界面层查 `save` / `A.save` 开头的写操作。
- 局限：通过别名写（`const r = save.research; r.active = …`）查不到，只能靠约定，新代码请直接写 `save.字段`。

## 发现的问题（按要求只记录，本阶段没修）
1. **老存档的统计可能变成 NaN**
   - 迁移链里只有 v1 / v2 → v3 时把 `stats` 和当前的 `emptyStats()` 合并；v3–v6 → 下一版的迁移没有补新增的统计项（`oreTotal`、`gatherCharMs`、`forged`、`forgeGold`、`forgeOre`）。
   - 所以 v3–v5 时代建的存档迁移后，这些项是 undefined，累加后变成 NaN。
   - 只影响统计数字，不影响玩法。修法：在 `migrateV6`（或下一次迁移）里补 `Object.assign(emptyStats(), s.stats)`。
2. **`guide.js` 的 `guideNow`**
   - 模块级变量，记的是最近一次 `ackGuide` 传进来的时间（页面刚打开时是真实时间 `Date.now()`）。
   - `guideBlock('gather')` 用它调 `gatherPlan`。如果引导确认前就检查能不能执行，用的可能是旧时间，开了时间倍率时还可能和游戏时间对不上。目前没看到实际影响。
3. **`src/battle/engine.js` 有 567 行**，超过约 500 行的建议。战斗引擎不在本阶段拆分范围内，边界检查只给提示。
4. 存档工具（`tools/save.js`）和命令行模拟（`cli/lib/play.js`）会直接改存档字段，这是测试 / 开发工具的特例，文档里写明了不受字段归属限制。

## 改了哪些文件
- 新增：
  - 规则层：`src/game/common.js` `save.js` `economy.js` `roster.js` `progress.js` `recruit.js` `research.js` `production.js` `equipment.js` `cards.js` `guide.js` `auto.js`
  - 界面层：`src/ui/app-core.js` `app-title.js` `app-activity.js` `app-stages.js` `app-cave.js` `app-roster.js` `app-bag.js` `app-modal.js` `app-flow.js` `app-main.js`
  - 命令行：`cli/boundaries.js` `cli/lib/boundaries.js` `cli/fingerprint.js`
  - 文档：`docs/ARCHITECTURE.md` `docs/STAGE3_8_HANDOFF.md`
- 删除：`src/game/game.js`、`src/ui/game-app.js`
- 修改：
  - 加载列表：`index.html` `src/node.js` `tools/save.html`
  - 文件头说明：`src/game/clock.js` `src/game/save-slots.js`
  - 其他：`cli/invariants.js`（K 组）、`tools/entities.js`（一行注释）、`README.md`、`docs/CHANGELOG.md`

## 以后改代码
- 先看 `docs/ARCHITECTURE.md` 的「新加功能放哪」。
- 新增存档字段时，在 `cli/lib/boundaries.js` 的 `FIELD_OWNER` 登记，否则边界检查会报「没登记归属的存档字段」。
- 纯重构前后跑 `node cli/fingerprint.js > before.txt` / `after.txt` 再 diff。
