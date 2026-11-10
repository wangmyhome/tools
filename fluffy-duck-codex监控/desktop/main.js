/* 鸭力鸭 · 桌面萌宠 Electron 主进程 */
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, globalShortcut, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { ProviderHub, PROVIDERS, PLACEHOLDERS } = require('./monitors');

const cfgPath = () => path.join(app.getPath('userData'), 'yaliya.json');
function readCfg(){
  try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch { return {}; }
}
function isPlainObj(v){ return !!v && typeof v === 'object' && !Array.isArray(v); }
/* 深合并：浅合并会让 codex 段整段互相覆盖（新增设置项必须逐键写回） */
function deepMerge(base, patch){
  const out = isPlainObj(base) ? { ...base } : {};
  if(!isPlainObj(patch)) return out;
  for(const k of Object.keys(patch)){
    const v = patch[k];
    out[k] = isPlainObj(v) && isPlainObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}
function writeCfg(obj){
  try { fs.writeFileSync(cfgPath(), JSON.stringify(deepMerge(readCfg(), obj))); } catch {}
}

let win = null;        /* 萌宠小窗 */
let tray = null;
let lastState = 'idle';

const STATES = [
  ['idle',      '😌 空闲'],
  ['run',       '🏃 奔跑'],
  ['cry',       '😭 哭泣'],
  ['sleep',     '😴 打盹'],
  ['celebrate', '🎉 庆祝'],
  ['angry',     '😤 生气'],
  ['sprint',    '🚀 冲刺'],
  ['overload',  '😵 躺平'],
  ['bath',      '🛁 泡澡'],
  ['playdead',  '💀 装死'],
  ['boss',      '🤫 装正经'],
];

/* 尺寸档位（同一纵横比；fov 恒定，边缘余量随之等比缩放，任何档位动画都不切边） */
const SIZES = { folder:[108,102], mini:[200,190], xs:[248,238], s:[288,276], m:[352,336], l:[416,398], xl:[448,428] };
const SIZE_LABEL = { folder:'文件夹大小', mini:'迷你号', xs:'超小号', s:'小号', m:'中号', l:'大号', xl:'超大号' };
let sizeId = 'xl';

let petHidden = false;

/* ==================== 监控（Provider 化，docs/monitor-provider-spec.md）====================
 * 监控来源可插拔（Codex / Qoder / DeepSeek Harness…），注册表与聚合在 monitors/index.js；
 * 这里只做宿主职责：把聚合快照变成「鸭子状态 + 托盘 + 通知 + 任务卡」。
 * 零写操作；待授权信号拿不到，只用弱信号「可能卡在等你」。 */
const PROVIDER_DEFAULTS = {
  codex: {
    enabled: true,
    notifyCompleted: 'unfocused',   /* never | unfocused | always */
    notifyFailed: true,
    notifyStuck: true,
    dedupeMs: 60000,
    summary: 'title',               /* title | command | files */
    pillMode: 'always',             /* always 一直显示 | active 只在运行时显示 */
  },
};
/* 一次性迁移：旧 cfg.codex.* → cfg.monitors.codex.*（读到旧键即搬走，用户无感） */
function monitorsCfg(){
  const c = readCfg();
  if(isPlainObj(c.monitors)) return c.monitors;
  const migrated = { codex: isPlainObj(c.codex) ? c.codex : {} };
  writeCfg({ monitors: migrated });
  return migrated;
}
function providerCfg(id){
  return deepMerge(PROVIDER_DEFAULTS[id] || {}, isPlainObj(monitorsCfg()[id]) ? monitorsCfg()[id] : {});
}
function setProviderCfg(id, patch){
  const m = monitorsCfg();
  writeCfg({ monitors: Object.assign({}, m, { [id]: deepMerge(providerCfg(id), patch) }) });
}
const codexCfg = () => providerCfg('codex');                 /* Codex 段菜单/通知仍在用 */
const setCodexCfg = patch => setProviderCfg('codex', patch);

let aggSnap = null;             /* ProviderHub 聚合快照 */
let monSyncAt = {};             /* provider id → 最近一次读到有效数据的时刻 */
let stuckSeen = new Set();      /* key: provider:threadId */
let lastAggSig = '';

const hub = new ProviderHub({
  providers: PROVIDERS,
  onAggregate: snap => {
    aggSnap = snap;
    for(const [id, s] of Object.entries(snap.providers || {})){
      if(s && s.ok) monSyncAt[id] = s.ts;
    }
    /* 状态变化才打日志，方便终端排错（轮询本身不刷屏） */
    const sig = [snap.ok, (snap.duck && snap.duck.state) || '-', (snap.duck && snap.duck.reason) || '',
                 (snap.counts && snap.counts.active) || 0, (snap.counts && snap.counts.stuck) || 0].join('|');
    if(sig !== lastAggSig){
      lastAggSig = sig;
      console.log('[monitor]', sig, '| 来源:', (snap.enabled || []).join(','),
                  '| threads:', (snap.threads || []).length,
                  snap.error ? '| err: ' + snap.error : '');
    }
    pushMonitorToRenderer();
    refreshTray();
    announceStuck(snap);
    handleMonitorEvents(snap);
    applyCardVisibility();     /* 状态跃迁影响药丸档位可见性（active 档：跑起来亮、闲了隐） */
  },
});

function monitoringOn(){
  return hub.enabledIds().length > 0;    /* 任一来源开着 = 监控体系在跑 */
}

function applyMonitorsEnabled(){
  hub.syncEnabled({ codex: codexCfg().enabled !== false });
  pushMonitorToRenderer();
  refreshTray();
  applyCardVisibility();
}

function monitorPayload(){
  const on = monitoringOn();
  const s = aggSnap;
  const empty = { state: null, priority: 0, pinned: false, reason: '', stale: false, ok: false, enabled: on };
  if(!on || !s) return empty;
  /* pet.html 只消费 state/priority/reason 做仲裁演出——threads/counts 不进 IPC
     （5s 轮询的线程明细变化不再打穿签名去重打扰渲染层） */
  return {
    state: lastState === 'boss' ? null : ((s.duck && s.duck.state) || null),
    priority: (s.duck && s.duck.priority) || 0,
    pinned: !!(s.duck && s.duck.pinned),
    reason: (s.duck && s.duck.reason) || '',
    stale: !!s.stale,
    ok: !!s.ok,
    enabled: on,
  };
}

let lastMonitorPayloadSig = '';
function pushMonitorToRenderer(){
  if(!win || win.isDestroyed()) return;
  const payload = monitorPayload();
  const sig = JSON.stringify(payload);
  if(sig !== lastMonitorPayloadSig){
    lastMonitorPayloadSig = sig;
    try { win.webContents.send('codex:monitor', payload); } catch {}
  }
  pushCardData();          /* 任务卡开着时实时跟着刷新 */
}

/* ---------- 托盘 ---------- */
function trayVisual(){
  if(monitoringOn()){
    if(aggSnap && aggSnap.ok){
      const t = aggSnap.tray || {};
      return { emoji: t.emoji || '🐤', count: t.count || 0, tip: t.tip || '鸭力鸭' };
    }
    if(aggSnap && !aggSnap.ok){
      return { emoji: '💤', count: 0, tip: '鸭力鸭 · 监控状态不可用（可能过期）' };
    }
  }
  const m = STATES.find(x => x[0] === lastState);
  return { emoji: '🐤', count: 0, tip: '鸭力鸭 · ' + (m ? m[1] : lastState) };
}
function refreshTray(){
  if(!tray) return;
  const v = trayVisual();
  if(process.platform === 'darwin') tray.setTitle(v.emoji + (v.count > 0 ? String(v.count) : ''));
  tray.setToolTip(v.tip);
  tray.setContextMenu(buildMenu());
}

/* ---------- 通知 ---------- */
/* 通知：dedupeMs 来自来源配置（多来源时各自 dedupe，key 带来源前缀不互撞） */
const notifiedAt = new Map();
function dedupe(key, dedupeMs){
  const now = Date.now();
  const last = notifiedAt.get(key);
  if(last && now - last < (dedupeMs || 60000)) return false;
  notifiedAt.set(key, now);
  return true;
}
/* 前台是不是 Codex：lsappinfo 不需要任何隐私授权 */
function codexFocused(cb){
  execFile('/usr/bin/lsappinfo', ['front'], { timeout: 900 }, (err, out) => {
    if(err || !out) return cb(false);
    const asn = String(out).trim();
    if(!asn) return cb(false);
    execFile('/usr/bin/lsappinfo', ['info', '-only', 'name', asn], { timeout: 900 }, (e2, out2) => {
      if(e2 || !out2) return cb(false);
      cb(/chatgpt|codex/i.test(out2));
    });
  });
}
function notify(title, body, key, dedupeMs){
  if(!Notification.isSupported()) return;
  if(!dedupe(key, dedupeMs)) return;
  try {
    const n = new Notification({ title, body: body || '' });
    n.on('click', () => {
      if(!win || win.isDestroyed()) return;
      if(!win.isVisible()){ petHidden = false; win.showInactive(); refreshTray(); }
    });
    n.show();
  } catch {}
}
function handleMonitorEvents(snap){
  if(!snap.ok || !snap.events || !snap.events.length) return;
  if(lastState === 'boss') return;                 /* 老板键：监控全静默 */
  for(const ev of snap.events){
    const cfg = providerCfg(ev.provider || 'codex');
    const src = hub.labelOf(ev.provider || 'codex');
    const label = (ev.title || src);
    if(ev.type === 'completed' && cfg.notifyCompleted !== 'never'){
      if(cfg.notifyCompleted === 'always') notify('这一轮跑完了，去看一眼', label, ev.provider + ':done:' + ev.threadId, cfg.dedupeMs);
      else codexFocused(focused => { if(!focused) notify('这一轮跑完了，去看一眼', label, ev.provider + ':done:' + ev.threadId, cfg.dedupeMs); });
    } else if(ev.type === 'failed' && cfg.notifyFailed){
      notify(src + ' 回合失败', (ev.error ? ev.error + ' · ' : '') + label, ev.provider + ':fail:' + ev.threadId, cfg.dedupeMs);
    }
  }
  /* 事件只切药丸状态词/图标 + 通知，不自动弹卡（详情靠点击药丸展开） */
}
/* 「可能卡在等你」是弱信号：只在刚进入停滞时提醒一次，别反复刷 */
function announceStuck(snap){
  if(!snap.ok) return;
  if(lastState === 'boss') return;
  const nowStuck = new Set((snap.threads || []).filter(t => t.stalled).map(t => (t.provider || 'codex') + ':' + t.id));
  for(const key of nowStuck){
    if(stuckSeen.has(key)) continue;
    const [provId, threadId] = key.split(':');
    const cfg = providerCfg(provId);
    const t = (snap.threads || []).find(x => x.id === threadId && (x.provider || 'codex') === provId);
    if(cfg.notifyStuck && t){
      notify('可能卡在等你', t.project + ' · 已 ' + mmss(Date.now() - (t.lastActivityAt || Date.now())) + ' 没有新动静',
             'stuck:' + key, cfg.dedupeMs);
    }
  }
  stuckSeen = nowStuck;
}

function mmss(ms){
  const v = Math.max(0, Math.round(ms / 1000));
  if(v >= 3600) return Math.floor(v / 3600) + ':' + String(Math.floor(v % 3600 / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
  return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
}
function statusLabel(t){
  if(t.stalled) return '可能卡在等你';
  if(t.zombie) return '疑似中断';
  if(t.active) return '执行中';
  if(t.goal === 'usage_limited' || t.goal === 'budget_limited') return '额度受限';
  if(t.goal === 'blocked') return '被卡住';
  if(t.status === 'completed') return '已完成';
  if(t.status === 'failed') return '失败';
  if(t.status === 'interrupted') return '已中断';
  if(t.status === 'inProgress') return '未收尾';
  return t.status;
}

/* ---------- 菜单：监控段（Provider 化）---------- */
/* Codex 子菜单内容（provider 配置/状态/任务列表）；多来源时每个来源一个同构子菜单 */
function codexMenuItems(){
  const cfg = codexCfg();
  const snap = aggSnap && aggSnap.providers && aggSnap.providers.codex;
  const items = [
    { label: (cfg.enabled ? '✓ ' : '') + '启用 Codex 监控', click: () => {
        setCodexCfg({ enabled: !cfg.enabled });
        applyMonitorsEnabled();
      } },
    { label: '状态：' + (snap
        ? (snap.ok ? ((snap.duck && snap.duck.reason) || '空闲') : '不可用（' + (snap.error || '读不到') + '）')
        : '尚未同步'), enabled: false },
    { label: '最近同步：' + (monSyncAt.codex ? new Date(monSyncAt.codex).toLocaleTimeString('zh-CN', { hour12: false }) : '—'), enabled: false },
  ];
  if(cfg.enabled !== false && snap && snap.ok && (snap.threads || []).length){
    items.push({ type: 'separator' }, { label: 'Codex 任务（只读）', enabled: false });
    for(const t of snap.threads.slice(0, 6)){
      const mark = t.active ? '●' : t.stalled ? '‖' : t.zombie ? '‖'
        : t.status === 'failed' ? '!' : t.status === 'completed' ? '✓'
        : t.status === 'interrupted' ? '‖' : '○';
      const dur = t.active && t.startedAt ? ' · ' + mmss(Date.now() - t.startedAt) : '';
      items.push({ label: '  ' + mark + ' ' + t.project + ' · ' + statusLabel(t) + dur, enabled: false });
    }
  }
  items.push({ type: 'separator' });
  items.push({ label: '头顶药丸岛', submenu: [
      { label: '一直显示', type: 'radio', checked: (cfg.pillMode || 'always') === 'always',
        click: () => { setCodexCfg({ pillMode: 'always' }); applyCardVisibility(); refreshTray(); } },
      { label: '只在运行时显示（空闲隐藏）', type: 'radio', checked: cfg.pillMode === 'active',
        click: () => { setCodexCfg({ pillMode: 'active' }); applyCardVisibility(); refreshTray(); } },
    ] });
  items.push({ label: '通知：回合完成', submenu: ['never', 'unfocused', 'always'].map(v => ({
      label: ({ never: '从不', unfocused: '仅未在看 Codex 时', always: '总是' })[v],
      type: 'radio', checked: cfg.notifyCompleted === v,
      click: () => { setCodexCfg({ notifyCompleted: v }); refreshTray(); },
    })) });
  items.push({ label: '通知：回合失败', type: 'checkbox', checked: cfg.notifyFailed,
    click: () => { setCodexCfg({ notifyFailed: !cfg.notifyFailed }); refreshTray(); } });
  items.push({ label: '通知：可能卡住', type: 'checkbox', checked: cfg.notifyStuck,
    click: () => { setCodexCfg({ notifyStuck: !cfg.notifyStuck }); refreshTray(); } });
  items.push({ label: '摘要粒度', submenu: ['title', 'command', 'files'].map(v => ({
      label: ({ title: '仅线程名（最保守）', command: '含命令数', files: '含文件数' })[v],
      type: 'radio', checked: cfg.summary === v,
      click: () => { setCodexCfg({ summary: v }); refreshTray(); },
    })) });
  return items;
}
/* 监控一级子菜单：已接入来源各一个子菜单 + 占位来源灰字（docs/monitor-provider-spec.md §5） */
function monitorsMenuItems(){
  const items = [];
  for(const id of Object.keys(PROVIDERS)){
    if(typeof PROVIDERS[id].create === 'function'){
      items.push({ label: PROVIDERS[id].label, submenu: codexMenuItems() });
    }
  }
  items.push({ type: 'separator' });
  for(const p of PLACEHOLDERS){
    items.push({ label: p.label + '（即将支持）', enabled: false });
  }
  return items;
}

/* ---------- 养成数据：饱食度（每时 -8%）+ 好感度（喂食 +2 / 摸头 +0.2） ---------- */
function readHud(){
  const c = readCfg();
  const s = c.hud || {};
  const love = Math.round((s.love || 0) * 10) / 10;
  const fedAt = s.fedAt || Date.now();      /* 从未喂食：默认刚饱（静静等第一次投喂） */
  const hunger = Math.max(0, 100 - Math.round((Date.now() - fedAt) / 3600000 * 8));
  return { hunger, love, skin: c.skin || 'yellow' };
}

/* ---------- 皮肤：好感度解锁的换毛色（渲染层按 skin id 换色） ---------- */
const SKINS = [
  { id:'yellow', label:'经典黄鸭',   love:0 },
  { id:'cream',  label:'奶白鸭',     love:10 },
  { id:'toast',  label:'烤面包色',   love:25 },
  { id:'mint',   label:'薄荷鸭',     love:45 },
  { id:'sky',    label:'晴空鸭',     love:70 },
  { id:'sakura', label:'樱花鸭',     love:100 },
  { id:'ink',    label:'墨玉鸭',     love:135 },
];
function applySkinCfg(id){
  if(!SKINS.some(s => s.id === id)) return;
  writeCfg({ skin: id });
  pushHud();                    /* 立刻推给渲染层换色 + 顺带刷菜单 */
}
/* 养成数据节拍：推饱食度/好感度/皮肤给渲染层 + 刷菜单；好感度跨解锁线 → 解锁播报 */
let prevLove = -1;
function pushHud(){
  const h = readHud();
  for(const sk of SKINS){
    if(sk.love > 0 && prevLove >= 0 && prevLove < sk.love && h.love >= sk.love
       && win && !win.isDestroyed()){
      win.webContents.send('yaliya-act', 'unlock');
    }
  }
  prevLove = h.love;
  if(win && !win.isDestroyed() && win.isVisible()) win.webContents.send('yaliya-hud', h);
  if(tray) tray.setContextMenu(buildMenu());
}
function feedNow(){
  const c = readCfg();
  const s = c.hud || {};
  s.fedAt = Date.now();
  s.love = Math.round(((s.love || 0) + 2) * 10) / 10;
  writeCfg({ hud: s });
  if(win && !win.isDestroyed()){
    if(!win.isVisible()){ win.showInactive(); win.webContents.send('yaliya-act', 'hello'); }
    const wc = win.webContents;
    const delay = win.isVisible() ? 0 : 1400;
    setTimeout(() => { if(win && !win.isDestroyed()) wc.send('yaliya-act', 'feed'); }, delay);
  }
  pushHud();
}

function send(state){ if(win && !win.isDestroyed()) win.webContents.send('yaliya-state', state); }

function buildMenu(){
  return Menu.buildFromTemplate([
    { label: '监控', submenu: monitorsMenuItems() },
    { label: '演出（调试）', submenu: [
        { label: '手动演出会暂时覆盖自动状态，10 秒后同步', enabled: false },
        { type: 'separator' },
        ...STATES.map(([id, label]) => ({
          label: (lastState === id ? '✓ ' : '') + label,
          click: () => send(id),
        })),
      ] },
    { type: 'separator' },
    ...(() => {
      const hud = readHud();
      return [
        { label: '喂玉米粒（饱食度 ' + hud.hunger + '%）', click: feedNow },
        { label: '好感度 ' + '💛'.repeat(Math.min(5, Math.floor(hud.love / 5) || 1)) + ' ' + hud.love, enabled: false },
        { label: '皮肤', submenu: SKINS.map(sk => {
            const unlocked = hud.love >= sk.love, cur = hud.skin === sk.id;
            return {
              label: sk.label + (unlocked ? '' : '（好感度 ' + sk.love + ' 解锁）'),
              type: 'radio', checked: cur, enabled: unlocked,
              click: () => applySkinCfg(sk.id),
            };
          }) },
      ];
    })(),
    { label: '尺寸',
      submenu: Object.keys(SIZES).map(id => ({
        label: SIZE_LABEL[id] + '  (' + SIZES[id][0] + '×' + SIZES[id][1] + ')',
        type: 'radio', checked: sizeId === id,
        click: () => applySize(id),
      })),
    },
    { label: petHidden ? '显示小鸭' : '隐藏小鸭', click: () => togglePet() },
    { label: app.getLoginItemSettings().openAtLogin ? '✓ 开机自启' : '开机自启', click: () => {
        try { app.setLoginItemSettings({ openAtLogin: !app.getLoginItemSettings().openAtLogin }); } catch {}
        if(tray) tray.setContextMenu(buildMenu());
      } },
    { label: '打开完整体验版', click: () => openFullWindow() },
    { label: '退出鸭力鸭', click: () => { savePos(); app.quit(); } },
  ]);
}

/* 换挡：窗口等比缩放，窗口中心保持不动 → 小鸭视觉不跳 */
function applySize(id){
  if(!SIZES[id] || !win || win.isDestroyed()) return;
  const [w, h] = SIZES[id];
  const b = win.getBounds();
  win.setBounds({
    x: Math.round(b.x + (b.width  - w) / 2),
    y: Math.round(b.y + (b.height - h) / 2),
    width: w, height: h,
  });
  sizeId = id;
  writeCfg({ size: id });
  if(tray) tray.setContextMenu(buildMenu());
}

/* 隐藏/显示：只藏窗口，托盘常驻随时唤回；隐藏时渲染自动节流省电 */
function tooltipText(){
  if(petHidden) return '鸭力鸭 · 已隐藏（点这里显示）';
  return trayVisual().tip;
}
let hidePending = false;
function togglePet(){
  if(!win || win.isDestroyed()) return;
  petHidden = !petHidden;
  hidePending = false;
  if(petHidden){
    /* 广播退场：渲染层演完「拜拜+小跑离场」再真正隐藏（兜底：2.6s 后强藏） */
    hidePending = true;
    win.webContents.send('yaliya-act', 'byehide');
    setTimeout(() => {
      if(hidePending && win && !win.isDestroyed()){ win.hide(); hidePending = false; }
    }, 2600);
  } else {
    win.showInactive();                    /* 与气泡同款出场：不抢焦点，全屏空间内也安全 */
    win.webContents.send('yaliya-act', 'hello');
  }
  if(tray){
    tray.setToolTip(tooltipText());
    tray.setContextMenu(buildMenu());
  }
}

let fullWin = null;
function openFullWindow(){
  if(fullWin && !fullWin.isDestroyed()){
    fullWin.show();
    fullWin.focus();
    return;
  }
  fullWin = new BrowserWindow({
    width: 980, height: 720,
    autoHideMenuBar: true,
    title: '鸭力鸭 · 完整体验版',
    webPreferences: { contextIsolation: true },
  });
  fullWin.on('closed', () => { fullWin = null; });
  fullWin.loadFile(path.join(__dirname, 'app.html'));   /* 打包后 app.html 已随包自带 */
}

/* ---------- 屏幕级聊天气泡：独立透明小窗池。气泡不受萌宠窗边界约束——
   长句不折行、不切字，可越出萌宠窗外悬在桌面上（只有屏幕边才会拦） ---------- */
const bubbleSlots = [];
function spawnBubbleOnScreen(text, headX, headY, k = 1){
  let slot = bubbleSlots.find(s => s.state === 'idle');
  if(!slot){
    if(bubbleSlots.length >= 5){
      slot = bubbleSlots[0];                 /* 全忙时复用最旧一个 */
    } else {
      const bw = new BrowserWindow({
        width: 10, height: 10, show: false,
        transparent: true, frame: false, hasShadow: false,
        alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false,
        fullscreenable: false, minimizable: false, maximizable: false,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true, nodeIntegration: false,
        },
      });
      bw.setAlwaysOnTop(true, 'screen-saver', 2);   /* 外层：在萌宠窗(+1)之上，重叠时气泡盖在小鸭上面 */
      bw.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      bw.setIgnoreMouseEvents(true);         /* 气泡永远不挡鼠标 */
      bw.loadFile(path.join(__dirname, 'bubble.html'));
      slot = { win: bw, state: 'idle', params: null };
      bubbleSlots.push(slot);
    }
  }
  slot.state = 'pending';
  slot.params = {
    text,
    headX: Math.round(headX), headY: Math.round(headY),
    k: (typeof k === 'number' && k > 0 && k <= 1.5) ? k : 1,   /* 档位比例，异常值兜底 1 */
  };
  const wc = slot.win.webContents;
  const push = () => { if(slot.params) wc.send('yaliya-bubble', { text: slot.params.text, rise: 64, k: slot.params.k }); };
  if(wc.isLoading()) wc.once('did-finish-load', push); else push();
}
function cancelAllBubbles(){
  for(const s of bubbleSlots){
    s.params = null; s.state = 'idle';
    if(s.win && !s.win.isDestroyed() && s.win.isVisible()) s.win.hide();
  }
}
/* bubble.html 实测完内容上报尺寸 → 主进程定位到小鸭头顶上方并显窗 */
ipcMain.on('bubble:size', (e, d) => {
  const slot = bubbleSlots.find(s => s.win && s.win.webContents === e.sender);
  if(!slot || !slot.params || slot.win.isDestroyed()) return;
  const { headX, headY } = slot.params; slot.params = null;
  const W = Math.max(10, d.w), H = Math.max(10, d.h);
  const wa = screen.getDisplayNearestPoint({ x: headX, y: headY }).workArea;
  const x = Math.max(wa.x + 2, Math.min(wa.x + wa.width  - W - 2, headX - W / 2));
  const pillH = (cardWin && !cardWin.isDestroyed() && cardWin.isVisible()) ? 34 : 0;   /* 让位头顶药丸岛 */
  const y = Math.max(wa.y + 2, headY - 4 - H - pillH);   /* 气泡窗底缘贴头顶上方 4px，不越屏幕顶 */
  slot.win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H });
  if(!slot.win.isVisible()) slot.win.showInactive();
  slot.state = 'busy';
  console.log('[bubble]', JSON.stringify({ pill: d.w, W, H, headX, headY, x, y }));
});
ipcMain.on('bubble:done', (e) => {
  const slot = bubbleSlots.find(s => s.win && s.win.webContents === e.sender);
  if(slot){
    slot.params = null; slot.state = 'idle';
    if(slot.win && !slot.win.isDestroyed() && slot.win.isVisible()) slot.win.hide();
  }
});

/* ---------- Codex 任务卡（v0.4）：鸭子旁的气泡卡片 ----------
 * 窗口本身永远吃鼠标（CodexNotch 的 NSPanel 同构，不抢焦点），点击零猜测必响应；
 * 展开/收回只靠点击：点药丸展开，再点一次收起；鼠标悬停不做任何动作。
 * 贴顶智能翻面（A+B）：头顶上方放不下 → 列表向下生长盖住鸭子身体；
 * 仍放不下 → 限高 + 卡内滚动；药丸带两种形态下原位不动。 */
let cardWin = null;
let headPos = null;             /* 萌宠渲染层上报的头顶点（窗口内 CSS px） */
let cardExpanded = false;       /* 当前是否展开（主进程仲裁后下发的状态镜像） */
let cardFlipped = false;        /* 贴顶翻面：列表向下生长（展开瞬间锁定，收起重算） */
let cardExpandedH = 0;          /* 渲染层量测上报的展开态总高（翻向判定用） */
let lastDragAt = 0;             /* 最近一次拖动小鸭的时刻（拖动期间解冻卡锚点，卡片要跟着走） */
let cardPillBand = null;        /* 药丸带的屏幕位置 {bottom, cx}——窗口变形期间药丸纹丝不动的基准 */
let cardAnchorLock = null;      /* 冻结期（悬停/展开中）使用的锚点快照 {x,y} */
let cardSettleUntil = 0;        /* 收起缩窗后短暂禁止 placeCard 抢位（底部场景药丸闪） */
let cardPillRect = null;        /* 药丸在卡窗内的矩形（card:size 上报），用于穿透命中 */
let cardPassTimer = null;
let cardMouseEat = false;
const PILL_H = 34;              /* 药丸实际渲染高度（32 内容 + 上下 border；渲染层 card:size 实测值会覆盖 cardPillH） */
let cardPillH = PILL_H;         /* 渲染层实测的药丸高（pill 矩形 h），翻面/变形公式统一用它 */

const STATUS_COLOR = {
  run: '#33d6e6', ok: '#54d673', fail: '#eb5259', warn: '#f2a340', idle: '#8a919e',
};
/* 药丸（折叠岛）聚合状态：镜像鸭子的四色语义，常驻头顶 */
function pillInfo(){
  if(!monitoringOn()) return null;                  /* 监控关 → 药丸消失，鸭子回归纯宠物 */
  const s = aggSnap;
  if(!s || !s.ok) return { word: '打盹', color: STATUS_COLOR.idle, on: false };
  const st = (lastState === 'boss') ? null : (s.duck && s.duck.state);
  const n = (s.counts && s.counts.active) || 0;
  switch(st){
    case 'run':      return { word: n + ' 个任务执行中', color: STATUS_COLOR.run, on: true, spin: true };
    case 'sprint':   return { word: n + ' 个任务执行中', color: STATUS_COLOR.run, on: true, spin: true };
    case 'celebrate':return { word: '完成',      color: STATUS_COLOR.ok,   on: false };
    case 'cry':      return { word: '失败',      color: STATUS_COLOR.fail, on: false };
    case 'angry':    return { word: '卡住',      color: STATUS_COLOR.warn, on: true };
    case 'overload': return { word: '过劳',      color: STATUS_COLOR.warn, on: false };
    case 'playdead': return { word: '被卡',      color: STATUS_COLOR.warn, on: false };
    /* 空闲=空心圆环（2026-11-02 定稿）：安静的低饱合灰白描边，不再抢眼的绿勾 */
    default:         return { word: '空闲',      color: 'rgba(255,255,255,.55)', on: false, ring: true };
  }
}
function statusColor(t){
  if(t.active) return STATUS_COLOR.run;
  if(t.status === 'failed') return STATUS_COLOR.fail;
  if(t.stalled || t.zombie || t.status === 'interrupted') return STATUS_COLOR.warn;
  if(t.goal === 'usage_limited' || t.goal === 'budget_limited' || t.goal === 'blocked') return STATUS_COLOR.warn;
  if(t.status === 'completed') return STATUS_COLOR.ok;
  return STATUS_COLOR.idle;
}
function cardRows(){
  /* 多来源线程已由 Hub 合并排序（active 优先、最近活动倒序）；展示规则（六次定稿）：
     只取最近 3 个项目；主行=该项目最近一次提问，第二行=项目名（超长省略） */
  const list = (aggSnap && aggSnap.ok && aggSnap.threads) || [];
  const seen = new Set();
  const rows = [];
  for(const t of list){
    const key = (t.provider || '') + '\0' + (t.cwd || t.project || '');
    if(seen.has(key)) continue;
    seen.add(key);
    const question = t.question && t.question !== t.project ? t.question : '';
    rows.push({
      id: t.id,
      name: question || t.project,
      folder: question ? t.project : '',
      label: statusLabel(t),
      color: statusColor(t),
      active: !!t.active,
      startedAt: t.startedAt || null,
      endedAt: t.completedAt || null,
      durationMs: t.durationMs,
    });
    if(rows.length === 3) break;
  }
  return rows;
}
function ensureCardWin(){
  if(cardWin && !cardWin.isDestroyed()) return cardWin;
  cardWin = new BrowserWindow({
    width: 10, height: 10, show: false,
    transparent: true, frame: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false,
    fullscreenable: false, minimizable: false, maximizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  cardWin.setAlwaysOnTop(true, 'screen-saver', 2);
  cardWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  /* 默认穿透 + forward；仅药丸/列表面板区域吃鼠标（见 startCardPassLoop） */
  cardWin.loadFile(path.join(__dirname, 'taskcard.html'));
  cardWin.webContents.once('did-finish-load', () => {
    try { cardWin.setIgnoreMouseEvents(true, { forward: true }); } catch {}
  });
  cardWin.webContents.on('console-message', (e, level, m) => console.log('[card:' + level + ']', m));
  return cardWin;
}
/* 药丸屏幕矩形：x/宽用渲染层上报值；y 一律按布局约定推算——
   药丸被 CSS 钉死在窗底（常规）或窗顶+8（翻面），与窗口高联动；
   不能信任上报的 y：首帧量测发生在窗口从 48px 长到 200px 的过渡期，
   上报的是旧窗高下的 y（14），窗口长高后药丸移到 166 而签名去重不再重报
   → 命中区永远错位 → 点药丸穿透没反应（2026-11-02 实测根因） */
function pillScreenRect(b){
  if(cardPillRect && cardPillRect.w > 0 && cardPillRect.h > 0){
    const top = cardFlipped ? b.y + 8 : b.y + Math.max(0, b.height - cardPillRect.h);
    return {
      left: b.x + cardPillRect.x,
      top,
      w: cardPillRect.w,
      h: cardPillRect.h,
    };
  }
  const ph = cardPillH || PILL_H;
  const pw = Math.max(72, Math.min(b.width, 320));
  const cx = b.x + b.width / 2;
  const top = cardFlipped ? b.y + 8 : b.y + Math.max(0, b.height - ph);
  return { left: cx - pw / 2, top, w: pw, h: ph };
}
/* 只有药丸 / 展开列表区域吃鼠标，透明区 forward 给小鸭（否则拖不动鸭） */
function cursorOnCardInteractive(){
  if(!cardWin || cardWin.isDestroyed() || !cardWin.isVisible()) return false;
  const c = screen.getCursorScreenPoint();
  const b = cardWin.getBounds();
  if(c.x < b.x || c.x > b.x + b.width || c.y < b.y || c.y > b.y + b.height) return false;
  const pad = 12;
  const pr = pillScreenRect(b);
  const onPill = c.x >= pr.left - pad && c.x <= pr.left + pr.w + pad
      && c.y >= pr.top - pad && c.y <= pr.top + pr.h + pad;
  if(onPill) return true;
  if(!cardExpanded) return false;
  const pillTop = pr.top;
  const pillBot = pillTop + pr.h;
  if(cardFlipped) return c.y > pillBot + 2 && c.y <= b.y + b.height;
  return c.y >= b.y && c.y < pillTop - 2;
}
function applyCardMousePassThrough(){
  if(!cardWin || cardWin.isDestroyed() || !cardWin.isVisible()) return;
  const eat = cursorOnCardInteractive();
  if(eat === cardMouseEat) return;
  cardMouseEat = eat;
  try {
    cardWin.setIgnoreMouseEvents(!eat, eat ? undefined : { forward: true });
  } catch {}
}
function startCardPassLoop(){
  if(cardPassTimer) return;
  applyCardMousePassThrough();
  cardPassTimer = setInterval(applyCardMousePassThrough, 20);
}
function stopCardPassLoop(){
  if(cardPassTimer){ clearInterval(cardPassTimer); cardPassTimer = null; }
  cardMouseEat = false;
}
function placeCard(force){
  if(!cardWin || cardWin.isDestroyed() || !win || win.isDestroyed()) return;
  if(!force && Date.now() < cardSettleUntil) return;
  const d = win.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: d.x, y: d.y }).workArea;
  const b = cardWin.getBounds();
  const W = Math.max(60, b.width), H = Math.max(24, b.height);
  /* 头顶药丸岛：以渲染层投影的头顶点为锚，药丸带恒为 [头锚-12-药丸高, 头锚-12]，
     两种形态下药丸纹丝不动。未拿到投影前退回窗口顶中。 */
  let hx = d.x + d.width / 2, hy = d.y + 8;
  if(headPos){ hx = d.x + headPos.x; hy = d.y + headPos.y; }
  /* 稳定锁：光标悬在卡上或已展开 → 用冻结锚点，不跟随小鸭的呼吸/视差微动
     （亚像素跟动 = 胶囊抖动与玻璃「按钮刷新感」的来源）；
     拖动中的鸭子例外（2026-11-02 用户反馈：展开态拖鸭子卡片必须跟着走）——
     win:move 后 300ms 内解冻，让 headPos 更新传导给卡片；
     force（展开时刻/显式重排）才换锚点。收起并移开光标后自动校正回来。 */
  const dragging = Date.now() - lastDragAt < 400;
  /* 仅悬停在药丸上时冻结（防 idle 呼吸微抖）；展开态 / 拖鸭子时必须跟头顶走 */
  const frozen = !force && !dragging && cursorOnCardInteractive();
  if(!frozen) cardAnchorLock = { x: hx, y: hy };
  if(!force && frozen && cardAnchorLock){ hx = cardAnchorLock.x; hy = cardAnchorLock.y; }
  let x = hx - W / 2;
  let y;
  if(cardFlipped){
    /* 贴顶翻面：窗口顶固定在药丸带顶（头锚-12-PILL_H-8），card:size 增高时保左上角
       → 下方向下生长盖住鸭子身体；药丸不跳 */
    y = hy - 12 - cardPillH - 8;
  } else {
    y = hy - 12 - H;     /* 常规：药丸底缘贴在头顶锚点上方 ~12px，列表向上长 */
  }
  x = Math.max(wa.x + 2, Math.min(wa.x + wa.width  - W - 2, x));
  y = Math.max(wa.y + 2, Math.min(y, wa.y + wa.height - H - 2));
  /* 位置无变化绝不重排：backdrop-blur 玻璃随窗口重合成会像「按钮被刷新」 */
  const nb = { x: Math.round(x), y: Math.round(y), width: W, height: H };
  const ob = cardWin.getBounds();
  if(ob.x === nb.x && ob.y === nb.y && ob.width === nb.width && ob.height === nb.height) return;
  cardWin.setBounds(nb);
  syncCardPillBand(nb);
}
/* 药丸带屏幕坐标：按布局约定从窗口矩形推算（不读渲染层 getBoundingClientRect，避免 flip 切换时公式打架） */
function syncCardPillBand(b){
  if(!b) return;
  cardPillBand = {
    bottom: cardFlipped ? b.y + 8 + cardPillH : b.y + b.height,
    cx: b.x + b.width / 2,
  };
}
/* 窗口变形但药丸带纹丝不动（2026-11-02 八次定稿）：
   展开/收起只允许这一次 setBounds——以 cardPillBand（药丸底缘/中心的屏幕位置）为基准
   反推新窗口矩形，药丸在变形前后一个像素都不挪，玻璃不重采样 = 点击零抖动零刷新感。
   翻面态窗口顶钉在药丸带顶上方 8px；常规态窗口底贴药丸带底。 */
function resizeCardKeepingPill(W, H){
  if(!cardWin || cardWin.isDestroyed()) return;
  const ob = cardWin.getBounds();
  const band = cardPillBand || { bottom: ob.y + ob.height, cx: ob.x + ob.width / 2 };
  let x = band.cx - W / 2, y;
  if(cardFlipped){
    y = band.bottom - cardPillH - 8;
  } else {
    y = band.bottom - H;
  }
  const wa = screen.getDisplayNearestPoint({ x: band.cx, y: band.bottom }).workArea;
  x = Math.max(wa.x + 2, Math.min(wa.x + wa.width  - W - 2, x));
  y = Math.max(wa.y + 2, Math.min(y, wa.y + wa.height - H - 2));
  const nb = { x: Math.round(x), y: Math.round(y), width: W, height: H };
  if(ob.x === nb.x && ob.y === nb.y && ob.width === nb.width && ob.height === nb.height) return;
  cardWin.setBounds(nb);
  syncCardPillBand(nb);
}
/* 药丸常驻可见性：随鸭子走（监控开 + 鸭可见 + 非老板键 + pillMode 档位） */
function pillVisibleByMode(){
  if(!monitoringOn() || petHidden || lastState === 'boss') return false;
  if((codexCfg().pillMode || 'always') === 'always') return true;
  /* active 档：只在忙碌态亮（空闲/完成/失败庆祝过后隐去） */
  const st = aggSnap && aggSnap.ok && aggSnap.duck && aggSnap.duck.state;
  return ['run', 'sprint', 'angry', 'overload', 'playdead'].includes(st);
}
function applyCardVisibility(){
  if(!pillVisibleByMode()){
    if(cardWin && !cardWin.isDestroyed() && cardWin.isVisible()) cardWin.hide();
    stopCardPassLoop();
    return;
  }
  const w = ensureCardWin();
  pushCardData();
  const bb = w.getBounds();
  if(bb.width < 100 || bb.height < 28){
    w.setBounds({ x: bb.x, y: bb.y, width: 336, height: Math.max(48, bb.height) });
    syncCardPillBand(w.getBounds());
  }
  placeCard();
  if(!w.isVisible()) w.showInactive();
  applyCardMousePassThrough();
  startCardPassLoop();
}
function pushCardData(){
  /* 不判 isVisible：expandCard 里先推数据后 showInactive，判可见会让首次弹出丢数据 */
  if(!cardWin || cardWin.isDestroyed()) return;
  try { cardWin.webContents.send('yaliya-card', { rows: cardRows(), pill: pillInfo() }); } catch {}
}
/* 展开/收起（v0.4：点击切换展开/收起，悬停不做任何动作） */
/* 展开（CodexNotch 同版锚点差异：锚在鸭头顶）：
   方向判定在展开瞬间锁定、收起前不变——
   展开高 > 头顶上方可用空间 → 翻面向下（列表盖住鸭子身体，A）；
   翻下去下方也放不下 → 下发限高，渲染层卡内滚动兜底（B） */
function expandCard(){
  if(lastState === 'boss' || petHidden) return;
  const w = ensureCardWin();
  if(!w.isVisible()) w.showInactive();
  pushCardData();
  /* 翻向判定用冻结锚点（= 药丸当前实际位置），不用新 headPos：
     展开瞬间药丸带必须纹丝不动，重算锚点 = 微位移 = 点击抖动 */
  const a = cardAnchorLock
    || (headPos && win && !win.isDestroyed()
        ? (() => { const d = win.getBounds(); return { x: d.x + headPos.x, y: d.y + headPos.y }; })()
        : null);
  cardFlipped = false;
  let cardMaxH = 0;
  if(a){
    const wa = screen.getDisplayNearestPoint(a).workArea;
    const eh = cardExpandedH || (w.getBounds().height + 320);   /* 未量到时粗兜底 */
    const above = a.y - 12 - wa.y;                               /* 药丸带底上方可用高度 */
    if(above < eh){
      cardFlipped = true;
      const below = wa.y + wa.height - 2 - (a.y - 12 + cardPillH + 5);  /* 面板可用高度 */
      if(below < eh - cardPillH - 5) cardMaxH = Math.max(64, below);
    }
  }
  cardExpanded = true;
  /* 展开只让渲染层量测后 card:size 改一次窗口——主进程抢先 setBounds 会跟 card:size
     连打两次，backdrop/药丸像被点刷新一样闪一下 */
  try { w.webContents.send('yaliya-card-show', { expanded: true, flipped: cardFlipped, maxH: cardMaxH }); } catch {}
}
function collapseCard(){
  cardExpanded = false;
  /* cardFlipped 由渲染层 card:size 带 flipped；收起时不改 cardAnchorLock，避免与 band 底边锚点打架 */
  try { if(cardWin && !cardWin.isDestroyed()) cardWin.webContents.send('yaliya-card-show', { expanded: false }); } catch {}
  /* 只收卡体；药丸是否留在头顶由 pillMode 决定（active 档 + 空闲 → 整窗收回）。
     200ms 内若又被点击展开（cardExpanded 翻回 true），不可整窗收回。 */
  setTimeout(() => {
    if(!cardExpanded && !pillVisibleByMode()
       && cardWin && !cardWin.isDestroyed() && cardWin.isVisible()){
      cardWin.hide();
      stopCardPassLoop();
    }
  }, 200);
}
ipcMain.on('card:size', (e, d) => {
  if(!cardWin || cardWin.isDestroyed() || cardWin.webContents !== e.sender) return;
  const W = Math.max(100, Math.round(d.w) || 336), H = Math.max(30, Math.round(d.h) || 60);
  const b = cardWin.getBounds();
  if(d && Number(d.expandedH) > 0) cardExpandedH = Math.round(Number(d.expandedH));
  if(d && d.pill && Number(d.pill.h) > 0) cardPillH = Math.round(Number(d.pill.h));  /* 药丸实测高（34，非 32） */
  if(d && d.flipped !== undefined) cardFlipped = !!d.flipped;
  if(d && d.pill){
    const p = d.pill;
    cardPillRect = {
      x: Number(p.x) || 0, y: Number(p.y) || 0,
      w: Number(p.w) || 0, h: Number(p.h) || cardPillH,
    };
    const fromPill = {
      bottom: Math.round(b.y + cardPillRect.y + cardPillRect.h),
      cx: Math.round(b.x + cardPillRect.x + cardPillRect.w / 2),
    };
    if(!cardPillBand || H < b.height - 1) cardPillBand = fromPill;
  }
  if(H < b.height - 1) cardSettleUntil = Date.now() + 480;
  resizeCardKeepingPill(W, H);
  /* 改高后以头顶锚点校正（resizeCardKeepingPill 只保 band，不跟鸭） */
  placeCard(true);
  applyCardMousePassThrough();
});
/* card 事件落盘：open 启动的打包版没有 stdout，点击不灵时靠这个查 */
let cardLogPath = null, cardLogBuf = [];
function cardLog(msg){
  console.log('[card]', msg);
  try {
    if(!cardLogPath) cardLogPath = path.join(app.getPath('userData'), 'card-debug.log');
    cardLogBuf.push(new Date().toISOString().slice(11, 23) + ' ' + msg + '\n');
    if(cardLogBuf.length > 30 || Date.now() - (cardLog._t || 0) > 2000){
      const stat = fs.existsSync(cardLogPath) && fs.statSync(cardLogPath);
      if(stat && stat.size > 200 * 1024) fs.writeFileSync(cardLogPath, '');
      fs.appendFileSync(cardLogPath, cardLogBuf.join(''));
      cardLogBuf = []; cardLog._t = Date.now();
    }
  } catch {}
}
/* ---------- 展开/收回（纯点击切换）----------
 * 点药丸/箭头/边距 → 展开；再点一次 → 收起。悬停不做任何动作。
 * 窗口永远吃鼠标，没有穿透/命中轮询，点击零猜测必响应。 */
ipcMain.on('ui:card-expand', (e, v) => {
  if(!cardWin || cardWin.isDestroyed() || cardWin.webContents !== e.sender) return;
  cardLog('expand req ' + v);
  if(v) expandCard(); else collapseCard();
});

let saveTimer = null;
function savePos(){
  if(!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  writeCfg({ x, y });
}
function savePosLater(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePos, 600);
}

/* ---------- IPC（模块层注册：渲染层启动期极快的消息也不会丢） ---------- */
ipcMain.on('ui:click-through', (e, v) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if(!w || w.isDestroyed()) return;
  w.setIgnoreMouseEvents(!!v, { forward: !!v });
});
ipcMain.on('win:move', (e, { dx, dy }) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if(!w || w.isDestroyed()) return;
  const [x, y] = w.getPosition();
  w.setPosition(Math.round(x + dx), Math.round(y + dy));
  if(w === win){
    lastDragAt = Date.now();
    if(cardWin && !cardWin.isDestroyed() && cardWin.isVisible()) placeCard(true);
  }
});
ipcMain.on('win:save', savePos);
ipcMain.on('state:announce', (e, s) => {
  lastState = s;
  if(tray) refreshTray();
  /* 老板键进出都会走到这里：静默/恢复要立刻反映到监控推送上 */
  pushMonitorToRenderer();
  applyCardVisibility();     /* 药丸随老板键一起消失/回来 */
});
ipcMain.on('ctx:open', () => buildMenu().popup());
ipcMain.on('ui:hidewin', () => {
  hidePending = false;
  if(win && !win.isDestroyed()) win.hide();
});
/* 屏幕级气泡：只接受萌宠渲染层的坐标上报（屏基换算+定位由主进程完成） */
ipcMain.on('ui:bubble', (e, d) => {
  if(!d || typeof d.text !== 'string') return;
  if(!win || win.isDestroyed() || e.sender !== win.webContents) return;
  spawnBubbleOnScreen(d.text, d.x, d.y, d.k);
});
/* 头顶投影点（萌宠渲染层每帧节流上报，窗口内 CSS px）→ 药丸岛锚点 */
ipcMain.on('ui:head-pos', (e, d) => {
  if(!d || e.sender !== (win && win.webContents)) return;
  const x = Number(d.x) || 0, y = Number(d.y) || 0;
  if(headPos && Math.abs(headPos.x - x) < 0.5 && Math.abs(headPos.y - y) < 0.5) return;
  headPos = { x, y };
  if(cardWin && !cardWin.isDestroyed() && cardWin.isVisible()) placeCard(true);
});
ipcMain.on('ui:screen-origin', (e) => {
  e.returnValue = (win && !win.isDestroyed())
    ? { x: win.getBounds().x, y: win.getBounds().y }
    : { x: 0, y: 0 };
});

/* 抱飞：渲染层上报甩出初速度 → 主进程接管惯性滑行（衰减+撞联合屏幕边缘反弹，
   越界会卡死窗体）。空速度 = 抓停（飞行中开始新一轮拖拽时由渲染层调用） */
let flingLoop = null;
ipcMain.on('ui:fling', (e, d) => {
  if(!win || win.isDestroyed() || e.sender !== win.webContents) return;
  const vx = Math.max(-38, Math.min(38, Number(d && d.vx) || 0));
  const vy = Math.max(-38, Math.min(38, Number(d && d.vy) || 0));
  if(!vx && !vy){ clearInterval(flingLoop); flingLoop = null; return; }
  if(Math.hypot(vx, vy) < 4) return;
  clearInterval(flingLoop);
  let bvx = vx, bvy = vy;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for(const dp of screen.getAllDisplays()){
    minX = Math.min(minX, dp.workArea.x);          minY = Math.min(minY, dp.workArea.y);
    maxX = Math.max(maxX, dp.workArea.x + dp.workArea.width);
    maxY = Math.max(maxY, dp.workArea.y + dp.workArea.height);
  }
  flingLoop = setInterval(() => {
    if(!win || win.isDestroyed()){ clearInterval(flingLoop); flingLoop = null; return; }
    const b = win.getBounds();
    let nx = b.x + Math.round(bvx), ny = b.y + Math.round(bvy);
    if(nx < minX || nx + b.width > maxX){ bvx = -bvx * 0.55; nx = Math.max(minX, Math.min(nx, maxX - b.width)); }
    if(ny < minY || ny + b.height > maxY){ bvy = -bvy * 0.55; ny = Math.max(minY, Math.min(ny, maxY - b.height)); }
    win.setPosition(nx, ny);
    bvx *= 0.90; bvy *= 0.90;
    if(Math.hypot(bvx, bvy) < 0.6){
      clearInterval(flingLoop); flingLoop = null;
      savePos();
      if(win && !win.isDestroyed()) win.webContents.send('yaliya-act', 'fling-land');
    }
  }, 16);
});

/* 摸头好感度：限频 25s（刷太快不涨），喂食走 feedNow */
let lastBond = 0;
ipcMain.on('ui:pet-bond', () => {
  if(Date.now() - lastBond < 25000) return;
  lastBond = Date.now();
  const c = readCfg();
  const s = c.hud || {};
  s.love = Math.round(((s.love || 0) + 0.2) * 10) / 10;
  writeCfg({ hud: s });
  pushHud();
});

app.whenReady().then(() => {
  /* 习惯正在用别的窗口看视频？置顶等级拉满，同时不进 Dock 区 */
  const gotLock = app.requestSingleInstanceLock();
  if(!gotLock){ app.quit(); return; }

  const cfg = readCfg();
  sizeId = Object.keys(SIZES).includes(cfg.size) ? cfg.size : 'xl';
  const [W, H] = SIZES[sizeId];

  /* 先变身 accessory（不进 Dock 区），再建窗——气泡窗正是这样「出生即悬浮」；
     顺序反了的话，窗口先以普通 App 窗注册，空间归属行为可能被锁定 */
  if(process.platform === 'darwin'){ try { app.dock.hide(); } catch {} }

  /* 打包版：默认开机自启（托盘菜单随时可关） */
  if(app.isPackaged){
    try { app.setLoginItemSettings({ openAtLogin: true }); } catch (err) { console.log('[launch] setLoginItemSettings threw:', err.message); }
    console.log('[launch] execPath:', process.execPath, '| loginItem:', JSON.stringify(app.getLoginItemSettings()));
  }

  win = new BrowserWindow({
    /* 与气泡窗逐字同一配置（气泡窗已实证能进全屏空间）——不留任何自创选项；
       show:false + 未显示时挂「全屏可见」标签，ready 后才展示 */
    show: false,
    width: W, height: H,
    transparent: true, frame: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false,
    fullscreenable: false, minimizable: false, maximizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  /* 顶层钉死 + 全屏空间可见（一次性设定，与气泡窗完全同一配方）。
     已知界限：三指切屏扫过动画（约0.3-0.5s）期间，macOS 会把所有
     第三方 App 的窗口从合成画面里剔除——菜单栏/Dock 由系统特殊进程
     渲染所以不动，普通 App 窗口无公开接口可以留下。
     注意：不要反复 setAlwaysOnTop 重钉——macOS 上它会重置集合行为 */
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const { workArea } = screen.getPrimaryDisplay();
  /* 一次性旧配置迁移：早期 320×360 小窗时代的视觉中心校正（只跑一次） */
  if(!cfg.legacy){
    const patch = { legacy: true };
    if(typeof cfg.x === 'number') patch.x = cfg.x - 64;
    if(typeof cfg.y === 'number') patch.y = cfg.y - 18;
    writeCfg(patch);
    cfg.x = patch.x ?? cfg.x;
    cfg.y = patch.y ?? cfg.y;
  }
  win.setPosition(
    typeof cfg.x === 'number' ? Math.round(cfg.x) : workArea.x + workArea.width - W - 60,
    typeof cfg.y === 'number' ? Math.round(cfg.y) : workArea.y + workArea.height - H - 24
  );
  win.loadFile('pet.html');
  /* 气泡窗同款出场顺序的最后一环：内容就绪后才 inactive 展示（不抢焦点）。
     show:false 创建 + 标签已挂好 → 此时展示即继承全屏空间可见的集合行为 */
  win.once('ready-to-show', () => {
    if(win && !win.isDestroyed()) win.showInactive();
  });

  /* 渲染进程日志转发到终端（桌面端排错用） */
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    const m = message || (e && e.message) || '(empty)';
    console.log('[pet:' + (level ?? '?') + ']', m, '@' + (sourceId || e.sourceId || '') + ':' + (line ?? e.lineNumber ?? ''));
  });
  win.webContents.on('preload-error', (e, p, err) => console.log('[preload]', err && err.message));
  win.webContents.on('did-fail-load', (e, code, desc) => console.log('[load-fail]', code, desc));
  win.webContents.on('render-process-gone', (e, d) => {
    console.log('[crash]', d && d.reason);
    /* 崩溃重启后必须重推一次当前状态，否则鸭子会停在旧姿态 */
    lastMonitorPayloadSig = '';
    setTimeout(() => { pushHud(); pushMonitorToRenderer(); }, 600);
  });
  /* 渲染层首次加载完成 → 立刻推一次皮肤/养成数据（启动早期最推的那条可能被丢） */
  win.webContents.on('did-finish-load', () => setTimeout(() => {
    pushHud();
    lastMonitorPayloadSig = '';
    pushMonitorToRenderer();
  }, 400));

  win.on('moved', () => {
    savePosLater();
    if(cardWin && !cardWin.isDestroyed() && cardWin.isVisible()) placeCard(true);
  });
  win.on('resize', () => {
    if(cardWin && !cardWin.isDestroyed() && cardWin.isVisible()) placeCard(true);
  });
  win.on('close', savePos);
  win.on('hide', () => { cancelAllBubbles(); applyCardVisibility(); });  /* 鸭子藏 → 药丸岛随鸭消失 */
  win.on('show', () => applyCardVisibility());

  /* 菜单栏托盘：macOS 上图像两连败（白图 → 空块高亮）——放弃图像管道，
     改用空图 + emoji 标题(系统原生渲染，任何外观 100% 可见，块头与微信一致)。
     非 macOS 仍走图像（assets/tray.png + tray@2x.png 为打包保留） */
  const trayPath = path.join(__dirname, 'assets', 'tray.png');
  const img = fs.existsSync(trayPath) ? nativeImage.createFromPath(trayPath) : nativeImage.createEmpty();
  console.log('[tray] darwin?', process.platform === 'darwin', '| img-valid:', !img.isEmpty(), '| mode:', process.platform === 'darwin' ? 'emoji-title' : 'image');
  tray = new Tray(process.platform === 'darwin' ? nativeImage.createEmpty() : img);
  if(process.platform === 'darwin') tray.setTitle('🐤');
  tray.setToolTip('鸭力鸭 · 正在发呆摸鱼，嘎～');
  tray.setContextMenu(buildMenu());

  /* Codex 监控：按配置启动（默认开），拿不到数据就降级成 💤 而不是假装空闲 */
  applyMonitorsEnabled();

  /* 老板键 */
  try { globalShortcut.register('Control+Option+B', () => send('boss')); } catch {}

  /* 养成数据节拍：启动即推 + 每 30s（定义在模块层 pushHud，含解锁播报） */
  pushHud();
  setInterval(pushHud, 30000);
});

app.on('window-all-closed', () => { /* 托盘常驻，不退出 */ });
app.on('before-quit', () => {
  try { globalShortcut.unregisterAll(); } catch {}
  try { hub.stopAll(); } catch {}
  for(const s of bubbleSlots){ try { s.win.destroy(); } catch {} }   /* 气泡小窗一并收场 */
  try { cardWin && cardWin.destroy(); } catch {}                     /* 任务卡一并收场 */
});
