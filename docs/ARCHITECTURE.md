# 代码结构（阶段 3.8 起）

以后的开发说明会按这里的模块名指定改动范围（例如「只改 production 和 app-cave」）。

## 分层和依赖方向

```
src/core   地基：标签、随机数（RNG）、事件、数据模型（Model）
src/config 配置表（DAO.CONFIG）+ 调参覆盖（tuning.js → apply-tuning.js）
src/battle 战斗：选目标、伤害、引擎、回放驱动、日志、批量模拟
src/game   游戏规则：存档、角色、关卡、招募、研究、生产、装备、技能卡、引导、自动推关
src/ui     界面：游戏页面（app-*.js）、战斗回放组件、V0 模拟器页面、写硬盘

  ui ──► game ──► battle ──► config / core
  （只能往右引用；core 和 config 互相可读）
```

- `src/battle` 不引用 `src/game` 和 `src/ui`。`src/game` 不引用 `src/ui`。
- `src/core`、`src/config`、`src/battle`、`src/game` 不碰 DOM，也不碰浏览器对象（document、window、localStorage……）。浏览器和 Node（`src/node.js`）共用这几层。
- `src/ui` 只通过游戏规则层的公开接口做事：`DAO.Game`、`DAO.GameClock`、`DAO.SaveSlots`。它不直接改存档字段，改设置、开关自动推关这类操作也调 `DAO.Game` 的函数（`setSetting`、`setAuto`、`setIdle`、`setClock`……）。读存档字段用来显示是可以的。
- 经典脚本，不用 ES modules。新文件要同时加到 `index.html` 和 `src/node.js`；界面文件只加 `index.html`。加载顺序就是依赖顺序。
- 检查：`node cli/boundaries.js`，`cli/invariants.js` 的 K 组也会跑它。它查四件事：反向引用、DOM、越界修改存档字段、界面直接改存档。src 下单个文件超过约 500 行时给提示。

## 游戏规则层 `src/game/`（全部挂在 `DAO.Game` 上）

每个模块文件开头写了：负责什么、对外函数、读写的存档字段。模块之间只通过 `DAO.Game.xxx`（文件里写成 `G.xxx`）调用。调用发生在运行时，所以模块之间不依赖加载顺序；只有 `common.js` 必须最先加载。

| 模块 | 文件 | 负责 | 写的存档字段 |
|---|---|---|---|
| common | `common.js` | 建立 `DAO.Game`；无状态小工具 `DAO.GameUtil = { clone, cfg, P }`；`dayKey` | — |
| clock | `clock.js` | 游戏时钟（时间倍率）`DAO.GameClock` | — |
| save | `save.js` + `save-slots.js` | 新存档、迁移链（v1 → 当前）、设置 / 时钟 / 统计；存档位、自动备份、迁移前原始存档、读不出来时的保护 | `v` `createdAt` `settings` `clock` `stats` `savedAt` |
| economy | `economy.js` | 钱包：金币和三种原料，`addGold` `spendGold` `addMat` `canPay` `pay` `refund`（花费写成 `{ gold?, ore?, herb?, stone? }`） | `gold` `ore` `herb` `stone` |
| buildings | `buildings.js` | 洞府六个建筑：等级、工位数、升级花费 / 升级、下一级效果（阶段 4a） | `buildings` |
| roster | `roster.js` | 角色查询和属性、经验升级、上阵位 / 上阵 / 布阵、角色状态、名额、加入（`newCharId` `addChar`）和遣散 | `roster` `lineup` `nextId` `quota`；角色的 `level` `exp` |
| progress | `progress.js` | 章节 / 关卡、开战、战斗结算（经验、金币、掉落、首通、战败计数）、系统开放（洞府、采集 / 锻造房） | `progress` `unlocks` `seedCounter` |
| recruit | `recruit.js` | 招募价格、候选（3 选 1）、选定、名额满时的决定 | `recruit` `recruitChoice` `pendingRecruit` `gachaSeed` |
| research | `research.js` | 研究上阵位：下一级、时长、开始 / 完成 / 取消、找谁去 | `research` |
| production | `production.js` | 生产线开放、采集三种原料（工位数看采集建筑）、通用生产任务（持续制造，按工位；工位数看制造建筑）、配方、品质概率 | `gather` `production` `craftSeed` |
| equipment | `equipment.js` | 装备品质 / 数值 / 名字、装备背包（`addGear`）、穿戴、出售 / 分解、推荐（含升级建筑、分解多余） | `gearBag` `nextGearId`；角色的 `equip` |
| cards | `cards.js` | 技能卡背包、掉落、插卡（掷数值 / 重掷 / 换卡）、自动处理、第一张卡 | `bag` `bagNew` `cardsInfo` `rollSeed`；角色的 `card` |
| guide | `guide.js` | 引导链：排队、当前该弹哪个、能不能执行、确认后执行（调各模块的函数）、`retireGuide` `requeueGuide` | `guide` |
| auto | `auto.js` | 自动推关决策、首领确认、开关（`setAuto`）、手动挂机关卡（`setIdle`）、记录最新关尝试（`noteAttempt`） | `auto` `idle` |

字段归属的权威表在 `cli/lib/boundaries.js` 的 `FIELD_OWNER`，和上表一致。以下几处不受字段归属限制：
- save 模块的 `newSave` 和迁移链：它们负责整份存档的结构。
- 命令行模拟（`cli/`）和存档工具（`tools/save.js`）：它们是测试和开发工具，可以直接改存档。

## 界面层 `src/ui/`

| 文件 | 负责 |
|---|---|
| `app-core.js` | 共享状态（`DAO.App` 上的 `save`、`tab`、`activity`、`clock`……）、存档会话（读存档位、保存、回标题页）、格式化 / 提示 / 小组件 |
| `app-title.js` | 标题页、存档位列表、备份面板、选角（新游戏）、顶栏「存档」菜单 |
| `app-activity.js` | 顶栏（资源、开关、页签）和活动条（推关 / 挂机 / 研究 / 采集 / 打造进度、锻造提示） |
| `app-stages.js` | 关卡页：关卡列表、战斗回放面板、结算横幅 |
| `app-cave.js` | 洞府页：招募、研究，以及这两项的处理函数；页面里再排进 app-workshop 的卡片 |
| `app-workshop.js` | 洞府的生产部分：采集（三种原料）、三条生产线（每个工位）、装备背包（出售 / 分解 / 自动分解）、建筑（升级） |
| `app-roster.js` | 角色页：角色卡、卡槽 / 装备槽、角色操作、布阵、穿装备 |
| `app-bag.js` | 背包页：技能卡、插卡 / 重掷 / 换卡、一键处理 |
| `app-modal.js` | 弹窗：引导文案、3 选 1、名额已满、卡关补装备、临时弹窗 |
| `app-flow.js` | 推关流程：挑战 / 挂机、自动推关的下一步、回放结算、后台挂机、每秒 tick |
| `app-main.js` | `render` / `renderMain`、`boot`（最后加载） |
| `save-disk.js` | 从本地服务打开时把存档写到硬盘 `saves/` |
| `util.js` `render-text.js` `battleview.js` | 公共小工具、战斗文字渲染器、回放组件（游戏和 V0 共用） |
| `main.js` `editor.js` `batch.js` `player.js` `state.js` `config-view.js` | V0 模拟器页面 |

页面文件之间的约定：
- 跨文件用到的状态写成 `A.名字`（`A = DAO.App`）。
- 跨文件用到的函数，在定义它的文件末尾 `Object.assign(A, {...})` 导出，别的文件写 `A.函数名()` 调用。
- 只在本文件用的状态和函数就留在本文件里。

## 新加功能放哪
| 要做的事 | 放在 |
|---|---|
| 新的花钱 / 进账方式 | 规则在对应模块；钱的增减调 economy（`spendGold` / `pay` / `refund` / `addGold`） |
| 新的生产线 / 原料 | 配置 `CONFIG.game.production.lines` + `CONFIG.game.<线>.recipes` + `CONFIG.game.gather.mats` + `CONFIG.game.buildings.list`；逻辑已经通用（production / buildings），钱包键要在 economy 的 `MATS` 和 `FIELD_OWNER` 里加 |
| 建筑效果、升级规则 | buildings（数值在 `CONFIG.game.buildings`） |
| 出售 / 分解规则 | equipment（比例在 `CONFIG.game.salvage`） |
| 新的装备效果、推荐规则 | equipment |
| 新的角色属性 / 状态 / 名额规则 | roster |
| 新的研究项目 | research（新增研究存档字段时在 `FIELD_OWNER` 登记归 research） |
| 新关卡、结算奖励、系统开放 | 配置 `CONFIG.game.chapters`；结算和开放在 progress |
| 新引导 | guide（`guideBlock` / `ackGuide`），文案在 `app-modal.js` 的 `GUIDES` |
| 自动推关 / 全自动玩家的决策 | auto（全自动玩家模拟在 `cli/lib/play.js`） |
| 存档版本升级 | save：`saveVersion` + 新的 `migrateVn`，接进 `migrate` 链；`cli/invariants.js` 加迁移检查 |
| 新的存档字段 | 在负责它的模块里读写，在 `newSave` 里给默认值，在 `cli/lib/boundaries.js` 的 `FIELD_OWNER` 登记 |
| 新页面 / 新面板 | `src/ui/app-<页面>.js`，在 `index.html` 里加在 `app-main.js` 之前；用到的规则调 `DAO.Game` |
| 战斗规则 | `src/battle/`（不能引用游戏层） |
| 数值 | `src/config/*.js`（默认值）或配置网站（写 `tuning.js`），不写死在逻辑里 |

## 检查和对照
- `node cli/invariants.js`：战斗 / 回放 / 游戏规则的不变量；J 组是存档位，K 组是模块边界。
- `node cli/boundaries.js`：只跑边界检查。
- `node cli/stage3.js`（以及 `stage1.js`、`stage2.js`）：整局模拟报告，同种子结果确定。
