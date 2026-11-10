const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yaliya', {
  setClickThrough: v => ipcRenderer.send('ui:click-through', v),
  moveBy: (dx, dy) => ipcRenderer.send('win:move', { dx, dy }),
  savePos: () => ipcRenderer.send('win:save'),
  announce: s => ipcRenderer.send('state:announce', s),
  openCtx: () => ipcRenderer.send('ctx:open'),
  hideNow: () => ipcRenderer.send('ui:hidewin'),
  onState: cb => ipcRenderer.on('yaliya-state', (e, s) => cb(s)),
  onAct: cb => ipcRenderer.on('yaliya-act', (e, a) => cb(a)),
  /* 屏幕级聊天气泡：pet 窗负责上传坐标，bubble.html 负责展示 */
  screenPos: () => ipcRenderer.sendSync('ui:screen-origin'),
  bubble: (text, x, y, k) => ipcRenderer.send('ui:bubble', { text, x, y, k }),
  onBubble: cb => ipcRenderer.on('yaliya-bubble', (e, d) => cb(d)),
  bubbleSize: (w, h) => ipcRenderer.send('bubble:size', { w, h }),
  bubbleDone: () => ipcRenderer.send('bubble:done'),
  /* 玩法交互：抱飞惯性 / 摸头好感度 / 饱食度推送 */
  fling: (vx, vy) => ipcRenderer.send('ui:fling', { vx, vy }),
  petBond: () => ipcRenderer.send('ui:pet-bond'),
  onHud: cb => ipcRenderer.on('yaliya-hud', (e, d) => cb(d)),
  /* Codex 监控：主进程推快照，渲染层负责「手感优先」仲裁 */
  onCodex: cb => ipcRenderer.on('codex:monitor', (e, d) => cb(d)),
  /* 头顶投影点上报（萌宠渲染层 → 药丸岛锚点） */
  headPos: (x, y) => ipcRenderer.send('ui:head-pos', { x, y }),
  /* Codex 药丸岛：点击展开/收起切换（悬停不做任何动作） */
  cardExpand: v => ipcRenderer.send('ui:card-expand', !!v),
  onCardData: cb => ipcRenderer.on('yaliya-card', (e, d) => cb(d)),
  onCardShow: cb => ipcRenderer.on('yaliya-card-show', (e, v) => cb(v)),
  cardSize: (w, h, pill, expandedH, flipped) => ipcRenderer.send('card:size', {
    w, h, pill, expandedH,
    flipped: flipped === undefined ? undefined : !!flipped,
  }),
});
