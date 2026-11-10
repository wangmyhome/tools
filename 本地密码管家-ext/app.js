// 本地密码管家 —— 统一界面逻辑（弹窗 / 侧边栏 / 全屏标签页 三种形态共用）
// 记录以明文形式存放在本机 chrome.storage.local，打开即用，不需要主密码。
// crypto.js 只服务于「一次性迁移旧加密数据」：迁移后旧密文与主密码一并丢弃。

import { deriveKey, decryptValue } from './crypto.js';

const RECS_KEY = 'lv_records';
const LEGACY_META_KEY = 'lv_meta';
const LEGACY_VERIFIER = 'local-password-manager-verifier-v1';
const DEFAULT_ITERATIONS = 600000;

/** 容器形态：由外壳页的 <body data-ctx="popup|side|tab"> 决定 */
const CTX = document.body.dataset.ctx || 'popup';

/* ---------------- 界面模板（三种形态共用同一份 DOM） ---------------- */

const TEMPLATE = `
  <div class="wrap">
    <div class="topbar">
      <div class="searchbar">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        <input id="search" type="search" autocomplete="off" placeholder="搜索备注 / 站点 / 账号" />
        <button id="searchToggle" class="chev" title="展开 / 收起" aria-label="展开或收起">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <polyline points="6 9 12 15 18 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
      <div class="modes">
        <button id="modeSide" class="mode-btn" title="在侧边栏打开" aria-label="在侧边栏打开">
          <svg viewBox="0 0 24 24" width="17" height="17">
            <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8" />
            <line x1="15" y1="4" x2="15" y2="20" stroke="currentColor" stroke-width="1.8" />
          </svg>
        </button>
        <button id="modeTab" class="mode-btn" title="全屏打开" aria-label="全屏打开">
          <svg viewBox="0 0 24 24" width="17" height="17">
            <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>
    </div>
    <p class="hint center" id="searchHint">优先匹配备注，点击条目直接跳转登录</p>

    <section id="legacyNote" class="card hidden">
      <p class="hint">
        检测到旧版本留下的<b>主密码加密数据</b>。新版本已不再需要主密码，只需输入<b>最后一次</b>设置的主密码，把旧记录一次性转成新格式即可，之后永不再问。
      </p>
      <button id="legacyBtn" class="btn primary block-btn">开始一次性迁移</button>
    </section>

    <section id="vaultPanel" class="card">
      <div id="groups"></div>
      <p id="emptyHint" class="hint center">还没有账号，点下方「新增账号」开始</p>
    </section>

    <div class="card actions">
      <button id="addBtn" class="btn primary">新增账号</button>
      <button id="importBtn" class="btn ghost">批量导入</button>
      <button id="exportBtn" class="btn ghost">导出</button>
    </div>
    <p class="foot">数据全部保存在本机浏览器 · 无任何外部上报</p>
  </div>

  <dialog id="editorDlg">
    <form id="editorForm">
      <h2 id="editorTitle">新增账号</h2>
      <label>网站域名<input id="fDomain" type="text" placeholder="例：oa1.com" /></label>
      <label>登录地址<input id="fUrl" type="text" placeholder="例：https://oa1.com/login" /></label>
      <label>账号<input id="fUser" type="text" placeholder="例：wang@oa1.com" /></label>
      <label>密码<input id="fPass" type="password" autocomplete="new-password" placeholder="登录密码" /></label>
      <label>备注<input id="fNotes" type="text" placeholder="自定义备注（搜索时优先匹配）" /></label>
      <p id="editorMsg" class="msg"></p>
      <div class="dlg-actions">
        <button type="button" id="editorDelete" class="btn danger hidden">删除</button>
        <span class="spacer"></span>
        <button type="button" id="editorCancel" class="btn ghost">取消</button>
        <button type="button" id="editorSave" class="btn primary">保存</button>
      </div>
    </form>
  </dialog>

  <dialog id="importDlg">
    <form id="importForm">
      <h2>批量导入账号</h2>
      <p class="hint">
        一行填一个账号，四样东西按顺序写：<b>网址、账号、密码、备注</b>。备注可以不写。
      </p>
      <div id="impDemo" class="imp-demo" title="点一下填入示例">
        <div class="imp-demo-line">oa1.com  wang@oa1.com  123456  工作系统</div>
        <div class="imp-demo-line">mail.qq.com  me@qq.com  abc123</div>
        <div class="imp-demo-tip">↑ 点这里把示例填进去试试</div>
      </div>
      <p class="hint">中间用空格、Tab 或逗号分开都行；从表格或浏览器导出的密码文件里直接复制粘贴也行。</p>
      <label>粘贴到这里<textarea id="impText" rows="6" spellcheck="false" placeholder="oa1.com  wang@oa1.com  123456  工作系统"></textarea></label>
      <div id="impPreview" class="imp-preview"></div>
      <p id="impMsg" class="msg"></p>
      <div class="dlg-actions">
        <button type="button" id="impCancel" class="btn ghost">取消</button>
        <span class="spacer"></span>
        <button type="button" id="impParse" class="btn ghost">预览</button>
        <button type="button" id="impOk" class="btn primary" disabled>导入</button>
      </div>
    </form>
  </dialog>

  <dialog id="migDlg">
    <form id="migForm">
      <h2>迁移旧加密数据</h2>
      <p class="hint">输入你上一次设置的主密码。迁移完成后旧密文与主密码一起丢弃，以后打开插件不再需要任何密码。</p>
      <label>旧主密码<input id="migPwd" type="password" autocomplete="off" placeholder="仅本次使用" /></label>
      <p id="migMsg" class="msg"></p>
      <div class="dlg-actions">
        <button type="button" id="migDiscard" class="btn danger">清空旧数据</button>
        <span class="spacer"></span>
        <button type="button" id="migBtn" class="btn primary">迁移</button>
      </div>
    </form>
  </dialog>

  <dialog id="exportDlg">
    <h2>导出账号</h2>
    <p class="hint">
      <b>CSV</b> 可以重新用「批量导入」粘回来；<b>JSON</b> 保留全部字段，适合做完整备份。
    </p>
    <div class="exp-format">
      <label class="exp-opt">
        <input type="radio" name="expFormat" value="csv" checked />
        <span>CSV（可重新导入）</span>
      </label>
      <label class="exp-opt">
        <input type="radio" name="expFormat" value="json" />
        <span>JSON（完整备份）</span>
      </label>
    </div>
    <p class="hint">文件将保存到浏览器默认下载文件夹。密码会以明文写出，导出后请妥善保管。</p>
    <p id="expMsg" class="msg"></p>
    <div class="dlg-actions">
      <button type="button" id="expCancel" class="btn ghost">取消</button>
      <span class="spacer"></span>
      <button type="button" id="expOk" class="btn primary">导出</button>
    </div>
  </dialog>
`;

document.body.insertAdjacentHTML('afterbegin', TEMPLATE);

/* ---------------- DOM 引用 ---------------- */

const $ = (id) => document.getElementById(id);
const els = {
  search: $('search'),
  searchToggle: $('searchToggle'),
  searchHint: $('searchHint'),
  modeSide: $('modeSide'),
  modeTab: $('modeTab'),
  groups: $('groups'),
  emptyHint: $('emptyHint'),
  addBtn: $('addBtn'),
  legacyNote: $('legacyNote'),
  legacyBtn: $('legacyBtn'),
  migDlg: $('migDlg'),
  migPwd: $('migPwd'),
  migMsg: $('migMsg'),
  migBtn: $('migBtn'),
  migDiscard: $('migDiscard'),
  exportBtn: $('exportBtn'),
  expDlg: $('exportDlg'),
  expMsg: $('expMsg'),
  expOk: $('expOk'),
  expCancel: $('expCancel'),
  importBtn: $('importBtn'),
  impDlg: $('importDlg'),
  impText: $('impText'),
  impDemo: $('impDemo'),
  impPreview: $('impPreview'),
  impMsg: $('impMsg'),
  impParse: $('impParse'),
  impOk: $('impOk'),
  impCancel: $('impCancel'),
  editorDlg: $('editorDlg'),
  editorTitle: $('editorTitle'),
  editorDelete: $('editorDelete'),
  editorCancel: $('editorCancel'),
  editorSave: $('editorSave'),
  editorMsg: $('editorMsg'),
  fDomain: $('fDomain'),
  fUrl: $('fUrl'),
  fUser: $('fUser'),
  fPass: $('fPass'),
  fNotes: $('fNotes')
};

/** @type {Array<{id,domain,loginUrl,username,password,notes,createdAt,updatedAt}>} 明文记录 */
let records = [];
/** 存在旧加密数据且尚未迁移：此时禁止增删改，避免新旧格式混存 */
let migrationPending = false;
let editingId = null;

/* ---------------- 存储读写 ---------------- */

async function readStorage() {
  const r = await chrome.storage.local.get([RECS_KEY, LEGACY_META_KEY]);
  return {
    recs: Array.isArray(r[RECS_KEY]) ? r[RECS_KEY] : [],
    meta: r[LEGACY_META_KEY] || null
  };
}

async function persist() {
  await chrome.storage.local.set({ [RECS_KEY]: records });
}

function normalizeRec(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id || crypto.randomUUID(),
    domain: String(raw.domain || ''),
    loginUrl: String(raw.loginUrl || ''),
    username: String(raw.username || ''),
    password: String(raw.password || ''),
    notes: String(raw.notes || ''),
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now()
  };
}

/* ---------------- 初始化 ---------------- */

init();

async function init() {
  applyContext();
  bindEvents();
  const { recs, meta } = await readStorage();
  const legacy = !!meta || recs.some((r) => r && r.encPassword);

  if (legacy) {
    migrationPending = true;
    records = [];
    render();
    openMigrate();
    return;
  }

  records = recs.map(normalizeRec).filter(Boolean);
  render();
}

/** 按容器形态裁剪界面元素 */
function applyContext() {
  document.title = '本地密码管家';
  els.modeSide.classList.toggle('hidden', CTX === 'side');
  els.modeTab.classList.toggle('hidden', CTX === 'tab');
  if (CTX === 'tab') els.search.focus();
}

function bindEvents() {
  els.search.addEventListener('input', render);
  els.searchToggle.addEventListener('click', () => {
    els.search.focus();
    els.search.select();
  });

  els.modeSide.addEventListener('click', openSidePanel);
  els.modeTab.addEventListener('click', openFullPage);

  els.addBtn.addEventListener('click', () => {
    if (migrationPending) {
      openMigrate();
      return;
    }
    openEditor(null);
  });
  els.legacyBtn.addEventListener('click', openMigrate);

  els.importBtn.addEventListener('click', () => {
    if (migrationPending) {
      openMigrate();
      return;
    }
    openImport();
  });
  els.exportBtn.addEventListener('click', () => {
    if (migrationPending) {
      openMigrate();
      return;
    }
    openExport();
  });
  els.expCancel.addEventListener('click', () => els.expDlg.close());
  els.expOk.addEventListener('click', runExport);
  els.impCancel.addEventListener('click', () => els.impDlg.close());
  els.impParse.addEventListener('click', previewImport);
  els.impDemo.addEventListener('click', () => {
    els.impText.value = DEMO_TEXT;
    previewImport();
  });
  els.impOk.addEventListener('click', runImport);
  $('importForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runImport();
  });

  els.migBtn.addEventListener('click', runMigrate);
  els.migDiscard.addEventListener('click', discardLegacy);
  $('migForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runMigrate();
  });

  els.editorCancel.addEventListener('click', () => els.editorDlg.close());
  els.editorSave.addEventListener('click', saveEditor);
  els.editorDelete.addEventListener('click', deleteEditor);
  $('editorForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveEditor();
  });
}

/* ---------------- 形态切换 ---------------- */

async function openSidePanel() {
  if (!chrome.sidePanel || !chrome.sidePanel.open) {
    alert('当前 Chrome 不支持侧边栏（需 114 及以上），可用「全屏打开」。');
    return;
  }
  const fail = (e) => {
    alert(
      '无法打开侧边栏：' +
        (e && e.message ? e.message : String(e)) +
        '\n可在 chrome://extensions/ 本插件详情页把「在侧边栏中打开」设为默认，或用「全屏打开」。'
    );
  };
  try {
    // 注意：必须在用户点击的同步阶段调用，中间不能 await，否则会失去手势授权
    const winId = (chrome.windows && chrome.windows.WINDOW_ID_CURRENT) ?? -2;
    const opening = chrome.sidePanel.open({ windowId: winId });
    if (opening && typeof opening.then === 'function') {
      opening.then(() => {
        if (CTX === 'popup') window.close();
      }).catch(fail);
    } else if (CTX === 'popup') {
      window.close();
    }
  } catch (e) {
    fail(e);
  }
}

function openFullPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
  if (CTX === 'popup') window.close();
}

/* ---------------- 渲染与搜索 ---------------- */

function matchRank(rec, q) {
  if (!q) return 0;
  const note = (rec.notes || '').toLowerCase();
  const domain = (rec.domain || '').toLowerCase();
  const user = (rec.username || '').toLowerCase();
  const url = (rec.loginUrl || '').toLowerCase();
  if (note.includes(q)) return 0; // 备注优先
  if (domain.includes(q)) return 1;
  if (user.includes(q)) return 2;
  if (url.includes(q)) return 3;
  return null;
}

function render() {
  els.legacyNote.classList.toggle('hidden', !migrationPending);
  els.addBtn.disabled = migrationPending;
  els.addBtn.title = migrationPending ? '请先处理旧加密数据' : '';
  els.groups.innerHTML = '';

  if (migrationPending) {
    els.emptyHint.classList.add('hidden');
    return;
  }

  const q = els.search.value.trim().toLowerCase();
  els.searchHint.textContent = q
    ? `匹配 ${q}：备注优先，其次域名与账号`
    : '优先匹配备注，点击条目直接跳转登录';

  const ranked = records
    .map((r) => ({ r, rank: matchRank(r, q) }))
    .filter((x) => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || (a.r.domain || '').localeCompare(b.r.domain || ''));

  const groups = new Map();
  for (const item of ranked) {
    const key = item.r.domain || '未分组';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.r);
  }

  for (const [domain, items] of groups) {
    const g = document.createElement('div');
    g.className = 'group';

    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = domain;
    g.appendChild(title);

    for (const rec of items) g.appendChild(buildEntry(rec));
    els.groups.appendChild(g);
  }

  els.emptyHint.classList.toggle('hidden', ranked.length > 0);
}

/** 超长网址用 * 号中段省略：保留开头（协议+域名）和结尾（关键参数），中间用 *** 代替 */
function abbreviateUrl(raw) {
  const s = String(raw || '');
  const limit = CTX === 'tab' ? 62 : CTX === 'side' ? 46 : 36;
  if (s.length <= limit) return s;
  const star = '***';
  const headLen = Math.ceil((limit - star.length) * 0.62);
  const tailLen = limit - star.length - headLen;
  return s.slice(0, headLen) + star + (tailLen > 0 ? s.slice(-tailLen) : '');
}

function buildEntry(rec) {
  const row = document.createElement('div');
  row.className = 'entry';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = (rec.domain || rec.username || '?').replace(/^www\./, '').charAt(0).toUpperCase();
  row.appendChild(avatar);

  const main = document.createElement('div');
  main.className = 'entry-main';

  const title = document.createElement('div');
  title.className = 'entry-title';
  title.textContent = rec.username || rec.domain || '未命名账号';
  if (rec.notes) {
    const note = document.createElement('span');
    note.className = 'entry-note';
    note.textContent = rec.notes;
    title.appendChild(note);
  }
  main.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'entry-sub';
  const fullUrl = rec.loginUrl || rec.domain || '';
  sub.textContent = abbreviateUrl(fullUrl);
  if (rec.loginUrl) sub.title = rec.loginUrl; // 悬停可看完整地址
  main.appendChild(sub);

  row.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'entry-actions';

  const rowActions = document.createElement('div');
  rowActions.className = 'row-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'icon-btn';
  copyBtn.title = '复制密码';
  copyBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="15" height="15"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(rec.password);
      copyBtn.title = '已复制';
    } catch (err) {
      copyBtn.title = '复制失败';
    }
  });
  rowActions.appendChild(copyBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.title = '编辑';
  editBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (migrationPending) {
      openMigrate();
      return;
    }
    openEditor(rec.id);
  });
  rowActions.appendChild(editBtn);

  actions.appendChild(rowActions);

  const loginBtn = document.createElement('button');
  loginBtn.className = 'btn primary small';
  loginBtn.textContent = '登录';
  loginBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    doLogin(rec);
  });
  actions.appendChild(loginBtn);

  row.appendChild(actions);

  // 点击条目 = 跳转 + 填充 + 登录
  row.addEventListener('click', () => doLogin(rec));

  return row;
}

/* ---------------- 跳转登录 ---------------- */

async function doLogin(rec) {
  if (!rec.loginUrl) {
    alert('该账号没有填写登录地址');
    return;
  }
  const idleHint = '优先匹配备注，点击条目直接跳转登录';
  els.searchHint.textContent = '正在打开并填充表单…';
  try {
    const res = await Promise.race([
      chrome.runtime.sendMessage({
        type: 'PV_FILL',
        url: rec.loginUrl,
        username: rec.username,
        password: rec.password,
        submit: true
      }),
      new Promise((r) => setTimeout(() => r({ ok: true, timeout: true }), 8000))
    ]);
    if (res && res.ok === false) {
      els.searchHint.textContent = idleHint;
      alert(res.error || '自动登录失败');
      return;
    }
    if (CTX === 'popup') window.close();
    else els.searchHint.textContent = '已在新标签页打开并填充表单';
  } catch (e) {
    els.searchHint.textContent = idleHint;
    const m = e && e.message ? e.message : String(e);
    if (/Receiving end does not exist|Could not establish connection/i.test(m)) {
      alert('后台服务未运行：请到 chrome://extensions/ 点本插件的「刷新」按钮后重试');
    } else {
      alert('跳转失败：' + m);
    }
  }
}

/* ---------------- 新增 / 编辑 / 删除 ---------------- */

function openEditor(id) {
  editingId = id || null;
  els.editorMsg.textContent = '';
  const rec = id ? records.find((r) => r.id === id) : null;

  els.editorTitle.textContent = rec ? '编辑账号' : '新增账号';
  els.editorDelete.classList.toggle('hidden', !rec);
  els.fDomain.value = rec ? rec.domain : '';
  els.fUrl.value = rec ? rec.loginUrl : '';
  els.fUser.value = rec ? rec.username : '';
  els.fPass.value = rec ? rec.password : '';
  els.fNotes.value = rec ? rec.notes : '';
  els.editorDlg.showModal();
  setTimeout(() => (rec ? els.fNotes : els.fDomain).focus(), 30);
}

function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
  return url;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

async function saveEditor() {
  const domain = els.fDomain.value.trim();
  const loginUrl = normalizeUrl(els.fUrl.value);
  const username = els.fUser.value.trim();
  const password = els.fPass.value;
  const notes = els.fNotes.value.trim();

  if (!loginUrl) {
    setMsg(els.editorMsg, '请填写登录地址');
    return;
  }
  if (!password) {
    setMsg(els.editorMsg, '请填写密码');
    return;
  }

  const rec = {
    id: editingId || crypto.randomUUID(),
    domain: (domain || hostOf(loginUrl)).toLowerCase(),
    loginUrl,
    username,
    password,
    notes
  };

  const idx = records.findIndex((r) => r.id === rec.id);
  const now = Date.now();
  rec.createdAt = idx >= 0 ? records[idx].createdAt || now : now;
  rec.updatedAt = now;

  const backup = records.slice();
  if (idx >= 0) records[idx] = rec;
  else records.push(rec);

  try {
    await persist();
    els.editorDlg.close();
    render();
  } catch (e) {
    // 写入失败则回滚内存，避免界面与磁盘不一致
    records = backup;
    setMsg(els.editorMsg, '保存失败：' + (e && e.message ? e.message : String(e)));
  }
}

async function deleteEditor() {
  if (!editingId) return;
  if (!confirm('确定删除这条账号记录？')) return;

  const idx = records.findIndex((r) => r.id === editingId);
  if (idx < 0) {
    els.editorDlg.close();
    return;
  }
  const backup = records[idx];
  records.splice(idx, 1);
  try {
    await persist();
    els.editorDlg.close();
    render();
  } catch (e) {
    records.splice(idx, 0, backup);
    setMsg(els.editorMsg, '删除失败：' + (e && e.message ? e.message : String(e)));
  }
}

/* ---------------- 批量文本导入 ---------------- */

/** 解析后待写入的记录 */
let importRows = [];

/** 示例文本：点一下就填进输入框 */
const DEMO_TEXT = 'oa1.com  wang@oa1.com  123456  工作系统\nmail.qq.com  me@qq.com  abc123';

const HEADER_RE =
  /^(网址|域名|网站|登录地址|站点|账号|账户|用户名|密码|备注|url|website|site|host|domain|loginurl|login|username|user|account|email|password|pass|note|notes|title|name)$/i;

/** 按行拆 CSV，支持双引号包裹与 "" 转义 */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function looksLikeUrl(t) {
  return /^https?:\/\//i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t);
}

/** 文本 -> 记录数组（不做去重，去重在预览阶段做） */
function parseImportText(text) {
  const rows = [];
  const errors = [];

  String(text || '')
    .split(/\r?\n/)
    .forEach((rawLine, idx) => {
      const line = rawLine.replace(/^\uFEFF/, '').trim();
      if (!line) return;

      let cells;
      if (line.includes('\t')) cells = line.split('\t').map((s) => s.trim());
      else if (line.includes(',')) cells = splitCsvLine(line);
      else if (line.includes('，')) cells = line.split('，').map((s) => s.trim());
      else {
        const parts = line.split(/\s+/);
        cells =
          parts.length >= 4
            ? [parts[0], parts[1], parts[2], parts.slice(3).join(' ')]
            : parts;
      }

      // 跳过表头行
      const filled = cells.filter(Boolean);
      if (filled.length && filled.every((c) => HEADER_RE.test(c))) return;

      let loginUrl = '';
      let domain = '';
      let username = '';
      let password = '';
      let notes = '';

      const urlIdx = cells.findIndex((c) => /^https?:\/\//i.test(c));
      if (urlIdx >= 0) {
        loginUrl = cells[urlIdx];
        username = (cells[urlIdx + 1] || '').trim();
        password = cells[urlIdx + 2] || '';
        notes = cells.slice(urlIdx + 3).join(' ').trim();
        domain = hostOf(loginUrl);
      } else {
        const hostIdx = cells.findIndex((c) => looksLikeUrl(c));
        if (hostIdx < 0) {
          errors.push(`第 ${idx + 1} 行没看懂：找不到网址，要像 oa1.com 或 https://… 这样`);
          return;
        }
        domain = cells[hostIdx].toLowerCase();
        loginUrl = normalizeUrl(cells[hostIdx]);
        username = (cells[hostIdx + 1] || '').trim();
        password = cells[hostIdx + 2] || '';
        notes = cells.slice(hostIdx + 3).join(' ').trim();
      }

      if (!password) {
        errors.push(`第 ${idx + 1} 行没看懂：缺密码`);
        return;
      }

      rows.push({
        id: crypto.randomUUID(),
        domain: domain || hostOf(loginUrl),
        loginUrl,
        username,
        password,
        notes
      });
    });

  return { rows, errors };
}

function openImport() {
  importRows = [];
  els.impText.value = '';
  els.impPreview.innerHTML = '';
  setMsg(els.impMsg, '');
  els.impOk.disabled = true;
  els.impOk.textContent = '导入';
  if (!els.impDlg.open) els.impDlg.showModal();
  setTimeout(() => els.impText.focus(), 30);
}

/** 解析 + 去重 + 渲染预览 */
function previewImport() {
  const { rows, errors } = parseImportText(els.impText.value);
  const existing = new Set(records.map((r) => `${r.domain}|${r.username}`.toLowerCase()));
  const seen = new Set();
  const fresh = [];
  let dup = 0;

  for (const r of rows) {
    const key = `${r.domain}|${r.username}`.toLowerCase();
    if (existing.has(key) || seen.has(key)) {
      dup += 1;
      continue;
    }
    seen.add(key);
    fresh.push(r);
  }
  importRows = fresh;

  els.impPreview.innerHTML = '';
  const sum = document.createElement('div');
  sum.className = 'imp-sum';
  sum.textContent =
    `能导入 ${fresh.length} 条` +
    (dup ? ` · ${dup} 条库里已有，跳过` : '') +
    (errors.length ? ` · ${errors.length} 行没看懂` : '');
  els.impPreview.appendChild(sum);

  for (const r of fresh.slice(0, 50)) {
    const rowEl = document.createElement('div');
    rowEl.className = 'imp-row';
    const d = document.createElement('div');
    d.className = 'imp-dom';
    d.textContent = r.domain;
    const u = document.createElement('div');
    u.className = 'imp-user';
    u.textContent = r.username || '（无账号）';
    const n = document.createElement('div');
    n.className = 'imp-note';
    n.textContent = r.notes || '';
    rowEl.append(d, u, n);
    els.impPreview.appendChild(rowEl);
  }
  if (fresh.length > 50) {
    const more = document.createElement('div');
    more.className = 'imp-sum';
    more.textContent = `…另有 ${fresh.length - 50} 条未在预览中显示`;
    els.impPreview.appendChild(more);
  }
  for (const err of errors.slice(0, 10)) {
    const e = document.createElement('div');
    e.className = 'imp-err';
    e.textContent = err;
    els.impPreview.appendChild(e);
  }

  els.impOk.disabled = fresh.length === 0;
  els.impOk.textContent = fresh.length ? `导入 ${fresh.length} 条` : '导入';
  if (!fresh.length && !errors.length) {
    setMsg(
      els.impMsg,
      els.impText.value.trim() ? '没认出账号：每行要有 网址、账号、密码' : '先把账号粘到上面的框里'
    );
  } else setMsg(els.impMsg, '');
}

async function runImport() {
  if (!importRows.length) {
    previewImport();
    if (!importRows.length) return;
  }

  const now = Date.now();
  const added = importRows.map((r) => ({ ...r, createdAt: now, updatedAt: now }));
  const backup = records.slice();
  records = records.concat(added);

  try {
    await persist();
    els.impDlg.close();
    render();
    els.searchHint.textContent = `已导入 ${added.length} 条账号`;
    importRows = [];
  } catch (e) {
    records = backup;
    setMsg(els.impMsg, '导入失败：' + (e && e.message ? e.message : String(e)));
  }
}

/* ---------------- 一次性迁移旧加密数据 ---------------- */

/* ---------------- 导出 ---------------- */

function openExport() {
  setMsg(els.expMsg, '');
  if (!els.expDlg.open) els.expDlg.showModal();
  setTimeout(() => els.expOk.focus(), 30);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv(rows) {
  const head = '网址,账号,密码,备注';
  const lines = rows.map((r) =>
    [r.loginUrl || r.domain, r.username, r.password, r.notes].map(csvEscape).join(',')
  );
  return '\uFEFF' + head + '\n' + lines.join('\n');
}

function buildJson(rows) {
  return JSON.stringify(
    rows.map((r) => ({
      domain: r.domain,
      loginUrl: r.loginUrl,
      username: r.username,
      password: r.password,
      notes: r.notes,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    })),
    null,
    2
  );
}

async function runExport() {
  if (!records.length) {
    setMsg(els.expMsg, '没有账号可导出');
    return;
  }

  const fmt = document.querySelector('input[name="expFormat"]:checked').value;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const base = `本地密码管家导出_${stamp}`;
  const text = fmt === 'json' ? buildJson(records) : buildCsv(records);

  els.expOk.disabled = true;
  setMsg(els.expMsg, '正在导出…', true);

  try {
    const results = await chrome.runtime.sendMessage({
      type: 'PV_EXPORT',
      base,
      fmt,
      text
    });
    if (results && results.ok === false) {
      setMsg(els.expMsg, results.error || '导出失败');
      return;
    }
    els.expDlg.close();
    els.searchHint.textContent = `已导出 ${records.length} 条账号`;
  } catch (e) {
    const m = e && e.message ? e.message : String(e);
    if (/Receiving end does not exist|Could not establish connection/i.test(m)) {
      setMsg(els.expMsg, '后台服务未运行：请到 chrome://extensions/ 点本插件的「刷新」按钮后重试');
    } else {
      setMsg(els.expMsg, '导出失败：' + m);
    }
  } finally {
    els.expOk.disabled = false;
  }
}

function openMigrate() {
  els.migMsg.textContent = '';
  els.migPwd.value = '';
  if (!els.migDlg.open) els.migDlg.showModal();
  setTimeout(() => els.migPwd.focus(), 30);
}

async function runMigrate() {
  const pwd = els.migPwd.value;
  if (!pwd) {
    setMsg(els.migMsg, '请输入旧主密码');
    return;
  }

  const { recs, meta } = await readStorage();
  els.migBtn.disabled = true;
  setMsg(els.migMsg, '正在解密旧数据…', true);

  try {
    let key = null;
    if (meta) {
      key = await deriveKey(pwd, meta.salt, meta.iterations || DEFAULT_ITERATIONS);
      let verified = false;
      try {
        verified = (await decryptValue(key, meta.verifier)) === LEGACY_VERIFIER;
      } catch (e) {
        verified = false;
      }
      if (!verified) throw new Error('旧主密码不正确');
    }

    const out = [];
    for (const raw of recs) {
      let password = String(raw.password || '');
      let notes = String(raw.notes || '');
      if (raw.encPassword) {
        if (!key) throw new Error('旧数据缺少密钥信息，无法迁移');
        password = await decryptValue(key, raw.encPassword);
        notes = raw.encNotes ? await decryptValue(key, raw.encNotes) : '';
      }
      out.push({
        id: raw.id || crypto.randomUUID(),
        domain: String(raw.domain || ''),
        loginUrl: String(raw.loginUrl || ''),
        username: String(raw.username || ''),
        password: String(password || ''),
        notes: String(notes || ''),
        createdAt: raw.createdAt || Date.now(),
        updatedAt: Date.now()
      });
    }

    // 先写新格式，再删旧元数据：中途失败时旧数据仍保留，不会丢记录
    await chrome.storage.local.set({ [RECS_KEY]: out });
    await chrome.storage.local.remove(LEGACY_META_KEY);

    records = out;
    migrationPending = false;
    els.migPwd.value = '';
    els.migDlg.close();
    render();
  } catch (e) {
    setMsg(els.migMsg, e && e.message ? e.message : String(e));
  } finally {
    els.migBtn.disabled = false;
  }
}

async function discardLegacy() {
  if (!confirm('这将永久丢弃旧的加密记录（没有主密码也无法恢复）。确定？')) return;
  if (!confirm('再次确认：删除后不可撤销，确定清空？')) return;
  try {
    await chrome.storage.local.remove([LEGACY_META_KEY, RECS_KEY]);
    records = [];
    migrationPending = false;
    els.migDlg.close();
    render();
  } catch (e) {
    setMsg(els.migMsg, '清空失败：' + (e && e.message ? e.message : String(e)));
  }
}

/* ---------------- 工具 ---------------- */

function setMsg(el, text, ok) {
  el.textContent = text || '';
  el.className = ok ? 'msg ok' : 'msg';
}
