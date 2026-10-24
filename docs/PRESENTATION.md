# 表现层接口（为以后加图片和动画预留）

目前没有任何美术：所有资源都是占位，界面显示文字和色块。这份说明讲的是以后接图片 / 动画时要用到的四个接口：战斗事件、回放驱动、渲染器、资源清单。

## 一、数据怎么流动

```
Battle.run()（整场算完）──► result.timeline（只读）──► Replay 驱动（定节奏）──► 渲染器（画）
                                  │
                                  └──► BattleLog（文字日志）
```

- 战斗**先整场算完**，回放只是把结果按节奏画出来。播放速度、暂停、跳过只决定什么时候画，碰不到战斗结果。游戏的经验、金币、掉落在 `Game.runBattle` 里就定了，和回放无关。
- `record: true` 才记录时间线（推关回放用）；挂机和批量模拟不记录。记录与否结果完全一样（不消耗随机数），`cli/invariants.js` 会检查。

## 二、时间线 `result.timeline`

```js
{
  version: 1, seed, winner: 'A'|'B'|'draw', timeout, rounds,
  units:  [{ uid, charId, side, row, index, name, title, role, level, art, maxHp,
             skills: [{ key, id, name, shape, cd, art }] }],
  events: [ ...按发生顺序 ],
  snapshots: { 根事件 id: { uid: { hp, maxHp, shield, bar, alive, speed, cds, buffs, guard, taunt } } },
}
```

### 事件

所有事件都有：`id`（从 1 递增）、`t`（战斗时间，刻度；速度 100 的单位每 10 刻度出手一次）、`round`、`type`、`parent`（触发来源：父事件 id，根事件为 null）。

| type | 是不是根 | 其他字段 | parent |
|---|---|---|---|
| battleStart | 根 | — | null |
| roundStart | 根 | — | null |
| action | 根 | actor、skill（技能槽 key）、skillId、skillName、shape、tags、extra（是否再动） | null |
| hit | | actor、target、skill、skillName、dmg（护盾前）、crit、absorbed、hpBefore、hpAfter、shieldBefore、shieldAfter、killed、scale、redirectedBy?、original? | action |
| death | | actor（击杀者）、target | 致死的 hit |
| heal | | actor、target、amount、hpBefore、hpAfter | action 或 trigger |
| shield | | actor、target、amount、shieldBefore、shieldAfter | action 或 trigger |
| buff / debuff | | actor、target、stat、value、duration、name | action 或 trigger |
| guard / taunt | | actor、target、duration | action |
| push / pull | | actor、target、value、barBefore、barAfter | action 或 trigger |
| trigger | | actor（持有者）、trigger（id）、name、effect | 引发它的事件（hit / death / action / roundStart / battleStart） |
| cdReduce | | actor、skills（技能名）、value | trigger |
| extraAction | | actor | trigger |
| battleEnd | 根 | winner、timeout | null |

规则：**每次命中单独一条**（群攻打 3 个人 = 3 条 hit；弹射每一跳一条）；同一效果作用于多个目标也是每个目标一条。

例子（一次带暴击触发的出手）：

```json
{"id":5,"type":"action","actor":"B1","skill":"activeCard","skillId":"chuanyun","skillName":"穿云剑","shape":"single","extra":false,"parent":null,"t":7.66,"round":1}
{"id":6,"type":"hit","actor":"B1","target":"A2","skillName":"穿云剑","dmg":312,"crit":true,"absorbed":0,"hpBefore":3660,"hpAfter":3348,"killed":false,"parent":5}
{"id":7,"type":"trigger","actor":"B1","trigger":"wanjian_trig","name":"万剑归宗·归","effect":"cdReduce","parent":6}
{"id":8,"type":"cdReduce","actor":"B1","skills":["穿云剑"],"value":1,"parent":7}
```

### 拍（beat）

一个根事件连同它的所有后代事件是一拍：`DAO.Replay.beats(timeline)` 返回
`{ index, root, events: [根, ...后代], snapshot: 这一拍结束时的状态, ms: 1× 速度下的时长 }`。
时长按根事件类型取 `CONFIG.playback`（开场 400、回合 250、出手 700、结束 0 毫秒）。

## 三、渲染器接口

渲染器只读时间线，不改它，也不调战斗逻辑。实现这几个方法：

```js
const renderer = {
  mount(timeline) {},          // 建场景：timeline.units 有位置、名字、art、技能
  beat(beat, { fast }) {},     // 画一拍；fast=true 表示正在跳过，只需要更新到 beat.snapshot
  end(timeline) {},            // 结束，每次回放恰好一次
  destroy() {},                // 可选：被新的回放替换时
};
```

- 现有实现：`src/ui/render-text.js`（场地卡片、行动条、出手顺序、文字日志）。
- 换渲染器：`UI.createBattleView(container, { renderer: (els, opts) => myRenderer })`。
- 做动画时可以用 `beat.events` 的顺序和 `parent` 排自己的时间轴（先出手动作，再逐个命中、飘字、触发特效），在 `beat.ms / 速度` 内画完；跳过时直接套用 `beat.snapshot`。

### 驱动 `DAO.Replay.create(timeline, renderer, { speed, clock, onEnd })`

`play() / pause() / resume() / setSpeed(s) / skip() / stop() / state()`。`clock` 默认用浏览器计时器，命令行检查时传模拟时钟。

## 四、资源清单 `src/config/assets.js`

- 配置里的角色、敌人、技能（普攻 / 固有）、技能卡、装备都有 `art` 字段，值是资源 id：`unit.*`、`enemy.*`、`skill.*`、`card.*`、`gear.*`。招募角色没有自己的 art，按定位用 `unit.sword` / `unit.mage`。
- `CONFIG.assets.images` 把 id 映射到路径（相对 `root: 'assets/'`）：
  - `null`：占位，还没出图（现在全部是这样）
  - `'units/sword.png'`：一张图
  - `{ portrait: '...', icon: '...', sprite: '...', default: '...' }`：按用途分开，取不到用 default
- 查询：`DAO.Art.path(id, use)` 有图返回路径，否则 null。界面用 `UI.artBox(id, { use, text, cls })`：有图放 `<img>`，没图或加载失败退回文字色块。
- 出图时只改这张表（和放图片文件），逻辑不用动。新增配置项要在表里登记它的 id，`node cli/invariants.js` 会查漏登和多余的 id。

## 五、检查

`node cli/invariants.js`（约 1.5 秒）检查：同种子一致、记录与否结果一致、事件血量首尾相接、统计能从事件加总、文字日志每次命中一行、各种播放方式（1× / 2× / 4×、暂停继续、中途改速、开头 / 中间 / 结尾跳过）渲染出的拍序列和最终状态一样且不改结果、游戏结算不受回放影响，以及再动每回合 ≤ 1、每排 ≤ 3、破甲不低于 0、资源清单与配置对应。
