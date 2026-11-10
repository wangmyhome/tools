'use strict';
/* 鸭力鸭 · ProviderHub：监控来源注册表 + 聚合仲裁
 *
 * 设计规格：docs/monitor-provider-spec.md
 *   - 每个已接入且 enabled 的来源一个实例，标准快照存 snaps[id]；
 *   - 聚合成一份来源无关的快照交给宿主（main.js）：鸭子状态按 priority 最高者赢、
 *     线程合并排序、counts 求和、托盘取最高优先级来源、events 合并并带 provider 标；
 *   - 聚合签名去重（与单来源时代 CodexMonitor.emit 同思路）；
 *     events 非空时强制透传一次（完成/失败通知不能被签名吞掉）。
 *   - create 为空的注册项 = 占位（菜单灰字「即将支持」，不实例化）。
 */

const { CodexProvider } = require('./codex');

/* 已接入来源。新监控接入 = 这里加一行 + 新建适配器文件，宿主零改动。 */
const PROVIDERS = {
  codex: { label: 'Codex', create: onSnap => new CodexProvider({ onSnapshot: onSnap }) },
};
/* 占位声明：只出现在菜单里，接入时把对应项挪进 PROVIDERS 并补适配器 */
const PLACEHOLDERS = [
  { id: 'qoder', label: 'Qoder' },
  { id: 'deepseek', label: 'DeepSeek Harness' },
];

class ProviderHub {
  constructor(opts = {}){
    this.defs = opts.providers || PROVIDERS;
    this.onAggregate = opts.onAggregate || (() => {});
    this.instances = new Map();   /* id → provider 实例 */
    this.snaps = {};              /* id → 最新标准快照 */
    this.lastSig = '';
  }

  /* 按宿主下发的 enabled 表同步实例生命周期（幂等，可反复调用） */
  syncEnabled(map){
    for(const id of Object.keys(this.defs)){
      const def = this.defs[id];
      const want = !!map[id] && typeof def.create === 'function';
      const has = this.instances.has(id);
      if(want && !has){
        let inst;
        try { inst = def.create(snap => this.onSnap(id, snap)); }
        catch(e){ console.log('[monitor]', id, '创建失败:', e && e.message); continue; }
        this.instances.set(id, inst);
        try { inst.start(); } catch(e){ console.log('[monitor]', id, 'start 失败:', e && e.message); }
      } else if(!want && has){
        try { this.instances.get(id).stop(); } catch {}
        this.instances.delete(id);
        delete this.snaps[id];
        this.recompute(true);       /* 来源关掉要立刻反映到聚合（药丸消失等） */
      }
    }
  }

  enabledIds(){ return Array.from(this.instances.keys()); }
  labelOf(id){ return (this.defs[id] && this.defs[id].label) || id; }

  stopAll(){
    for(const inst of this.instances.values()){ try { inst.stop(); } catch {} }
    this.instances.clear();
    this.snaps = {};
  }

  onSnap(id, snap){
    if(!snap) return;
    snap.provider = id;
    this.snaps[id] = snap;
    this.recompute();
  }

  /* ---------- 聚合 ---------- */
  recompute(force){
    const snaps = Object.keys(this.snaps).map(id => this.snaps[id]);
    const okSnaps = snaps.filter(s => s && s.ok);

    /* 鸭子状态：priority 最高者赢（平级按注册顺序，先到先得） */
    let duck = { state: null, priority: 0, pinned: false, reason: '空闲' };
    for(const s of okSnaps){
      const d = s.duck;
      if(d && d.state && (d.priority || 0) > duck.priority){
        duck = { state: d.state, priority: d.priority || 0, pinned: !!d.pinned, reason: d.reason || '' };
      }
    }
    if(!duck.state && snaps.length && !okSnaps.length){
      duck = { state: 'sleep', priority: 0, pinned: false, reason: '看不到监控状态' };
    }

    /* 线程合并：active 优先，再按最近活动倒序（任务卡取头 3，托盘取头 6） */
    const threads = [];
    for(const s of okSnaps){
      for(const t of (s.threads || [])) threads.push(Object.assign({}, t, { provider: s.provider }));
    }
    threads.sort((a, b) => ((b.active ? 1 : 0) - (a.active ? 1 : 0))
      || ((b.lastActivityAt || 0) - (a.lastActivityAt || 0)));

    /* counts 求和 */
    const counts = { active: 0, stuck: 0, failed: 0, unread: 0 };
    for(const s of okSnaps){
      for(const k of Object.keys(counts)) counts[k] += (s.counts && s.counts[k]) || 0;
    }

    /* 托盘：emoji/tip 取最高优先级来源，count 恒为全局 active 总和 */
    let tray = { emoji: '🐤', count: 0, tip: '鸭力鸭 · 空闲' };
    const byPri = [...okSnaps].sort((a, b) =>
      ((b.duck && b.duck.priority) || 0) - ((a.duck && a.duck.priority) || 0));
    if(byPri.length){
      tray = Object.assign({}, byPri[0].tray || tray);
      tray.count = counts.active;
      if(okSnaps.length > 1 && tray.tip) tray.tip = this.labelOf(byPri[0].provider) + ' · ' + tray.tip.replace(/^鸭力鸭 · /, '');
    }

    /* events 合并（跨来源），带 provider 标供宿主通知去重 */
    const events = [];
    for(const s of snaps){
      for(const ev of (s.events || [])) events.push(Object.assign({}, ev, { provider: s.provider }));
    }

    const agg = {
      provider: 'hub',
      ok: okSnaps.length > 0,
      stale: snaps.length > 0 && okSnaps.length === 0,
      error: (snaps.find(s => s && !s.ok && s.error) || {}).error || null,
      duck, counts, threads, tray, events,
      providers: Object.assign({}, this.snaps),   /* 各来源原始快照（菜单/状态页用） */
      enabled: this.enabledIds(),
    };

    const sig = JSON.stringify({
      d: agg.duck, c: agg.counts, t: agg.tray, ok: agg.ok, e: agg.enabled,
      n: agg.threads.map(t => [
        t.provider, t.id, t.status, t.active, t.stalled,
        t.project, t.question, t.questionAt,
      ]),
    });
    if(!force && this.lastSig === sig && !events.length) return;
    this.lastSig = sig;
    this.onAggregate(agg);
  }
}

module.exports = { ProviderHub, PROVIDERS, PLACEHOLDERS };
