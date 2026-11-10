# 监控架构重构规格 · Provider 化（2026-11-02）

> 目标：把「Codex 监控」降级为监控体系中的一个**可插拔来源**。未来接入 Qoder、
> DeepSeek Harness 等监控时，只新增一个适配器文件 + 注册表一行，主进程/渲染层零改动。

## 1. 现状梳理

```
Codex SQLite (~/.codex/*.sqlite)                    ← 只读采集
   └─ codex-monitor.js   CodexMonitor 类            ← 轮询+差分+鸭子状态机（纯 node，可单测）
        └─ main.js      直接 new CodexMonitor        ← ★ 与 Codex 硬耦合
             ├─ codexSnap / codexOn() / codexCfg()    ← 全部单数、指向 codex
             ├─ pillInfo / cardRows / trayVisual      ← 直接读 codexSnap
             ├─ 托盘菜单「Codex 监控」
             └─ pet.html  codex:monitor {state,...}    ← 渲染层只做仲裁演出
                  taskcard.html  yaliya-card {rows,pill}
```

关键事实：`CodexMonitor` 输出的快照形状已经是**来源无关**的
（`{ok, duck:{state,priority,reason}, counts, threads, tray, events}`）——
线程字段 `project/titleFull/status/active/stalled/zombie/goal/startedAt...`
没有任何 Codex 专属语义。**契约已经存在，只是没有被承认**。重构主要是「改名 + 抽层」，
不需要动采集器算法。

## 2. 死代码清单（本次删除）

| 位置 | 项 | 证据 |
|---|---|---|
| main.js | `let cardDataDirty` | 声明后全文件零引用 |
| main.js | `function cursorOnCard()` | 只剩 `cursorOnCardInteractive()` 在用；本体零调用 |
| main.js | `ipcMain.on('card:layout')` | 「兼容旧渲染层」遗留；taskcard.html 现只发 `card:size` |
| main.js | `viewThread()` + payload.threads | pet.html 的 onCodex 回调只用 `state/priority`（+reason 展示）；threads/counts 进了 IPC 但渲染层不读，还让 5s 轮询每次都打穿签名去重 |
| preload.js | 无死通道 | 逐个核对过，全部有订阅方 |
| taskcard.html | 无（九次定稿重写后干净） | — |

`codex:monitor` payload 收敛为 `{state, priority, pinned, reason, stale, ok, enabled}`——
这是 pet.html 实际消费的字段面。

## 3. 目标架构

```
desktop/monitors/
  index.js      ProviderHub：注册表 + 聚合仲裁（本规格 §4）
  codex.js      CodexProvider：包装 codex-monitor.js（start/stop/快照透传 + 配置迁移）
  codex-monitor.js  采集器本体（原样保留，纯 node 可测）
```

**Provider 契约**（与现有 CodexMonitor 类接口一致，新来源照此实现即可）：

```js
class XxxProvider {
  constructor(opts)            // opts.onSnapshot(snapshot)
  start()                      // 开始采集（轮询/watch，自管生命周期）
  stop()                       // 幂等
}
/* snapshot 必须是标准快照： */
{
  provider: 'xxx',            // 来源 id（新增字段）
  ok: true, stale: false, error: null,
  duck:   { state, priority, reason, pinned },   // state ∈ 现有 11 态词表
  counts: { active, stuck, failed, unread },
  threads: [ /* {id,title,titleFull,project,status,active,stalled,zombie,
                 goal,startedAt,completedAt,durationMs,lastActivityAt,
                 fileCount,cmdCount,errorText} */ ],
  tray:   { emoji, count, tip },
  events: [ /* {type:'completed'|'failed'|'interrupted', threadId, at, title, error} */ ],
}
```

`duck.state` 沿用现有状态词表（idle/run/cry/…/boss 由宿主覆盖）——
演出层（pet.html）、药丸语义（pillInfo）、通知文案全部零改动。

**注册表**（monitors/index.js）：

```js
const PROVIDERS = {
  codex: { label: 'Codex', create: (onSnap) => new CodexProvider(onSnap) },
  // 以下为占位声明：菜单灰字展示，不实例化
  // qoder: { label: 'Qoder', create: null },          // TODO 接入时填
  // deepseek: { label: 'DeepSeek Harness', create: null },
};
```

## 4. 聚合仲裁（ProviderHub）

- **多实例**：每个 `create` 不为空的、配置里 enabled 的 provider 各起一个；
  快照存 `snaps[providerId]`。
- **鸭子状态**：所有 ok 快照里 `priority` 最高者赢；同级按注册顺序。
  输出与今天完全同形的聚合 duck → `pet.html` / `pillInfo()` / 通知 无感。
- **线程合并**：各来源 threads 合并 → 按「active 优先，再按 lastActivityAt 倒序」
  统一排序 → 任务卡取 3、托盘列 6、（未来的）详情视图取 8。
  statusLabel/statusColor 是通用字段映射，上收到 Hub。
- **托盘**：emoji 取最高优先级来源的；count = 各来源 active 之和；tip 拼来源名。
- **通知**：events 直接透传给现有 handleEvents，去重 key 加前缀 `codex:done:...`
  防跨来源撞 key。
- **配置**：`cfg.codex.*` → `cfg.monitors.codex.*`，一次性迁移（读到旧键即搬走），
  用户无感。pillMode 等展示开关留在各 provider 配置内。

## 5. 菜单变化

托盘一级菜单 `Codex 监控` → `监控`，子菜单：

```
监控
├─ Codex ▸   （现有全部 codex 设置原样，含启停开关）
├─ ────────
├─ Qoder（即将支持）        ← 灰字占位
└─ DeepSeek Harness（即将支持）← 灰字占位
```

## 6. 不做的事（刻意收窄）

- 不实现 Qoder / DeepSeek 的采集器——接口不猜，接入时按真实数据源写。
- 不改 pet.html / taskcard.html / bubble.html（契约形状不变，渲染层零改动）。
- 不动 codex-monitor.js 采集算法与它的 20 项单测。
- 老板键、任务卡九次定稿的全部定位/抗抖逻辑不碰。

## 7. 验收

1. `node --check` 全部通过；`node codex-monitor.test.js` 20/20。
2. 行为回归：鸭子状态、药丸、任务卡 3 行、托盘、通知、贴顶翻面与重构前一致。
3. 旧配置 `cfg.codex.enabled=false` 的用户升级后监控仍为关（迁移正确）。
4. 死代码删除后 grep 无残留引用。
