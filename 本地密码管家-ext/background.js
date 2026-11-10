// 本地密码管家 —— 后台 Service Worker
// 职责：接收弹窗指令，打开目标网站并执行「表单填充 + 登录触发」。
// 不保存任何密码、不与任何外部服务器交互。

const FILL_FUNC = function (payload) {
  const { username, password, submit } = payload;

  const setNativeValue = (el, value) => {
    const proto =
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const visible = (el) =>
    !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  const pwdInputs = Array.from(document.querySelectorAll('input[type="password"]'));
  const pwd = pwdInputs.find(visible) || pwdInputs[0] || null;

  let user = null;
  if (pwd) {
    const scope = pwd.form || document;
    const cands = Array.from(scope.querySelectorAll('input')).filter((i) => {
      const t = (i.getAttribute('type') || 'text').toLowerCase();
      if (['password', 'hidden', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(t)) return false;
      if (!visible(i)) return false;
      return ['text', 'email', 'tel', 'url', ''].includes(t);
    });
    const named = cands.find((i) => {
      const hint = `${i.name || ''} ${i.id || ''} ${i.getAttribute('autocomplete') || ''} ${i.placeholder || ''}`;
      return /user|login|email|account|mail/i.test(hint);
    });
    let near = null;
    if (named) {
      near = named;
    } else {
      const preceding = cands.filter(
        (c) => pwd.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_PRECEDING
      );
      near = preceding.length ? preceding[preceding.length - 1] : cands[0] || null;
    }
    user = near;
  } else {
    user = document.querySelector(
      'input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[id*="user" i]'
    );
  }

  if (user && username != null) setNativeValue(user, username);
  if (pwd && password != null) setNativeValue(pwd, password);

  let clicked = false;
  if (submit) {
    const scope = (pwd && pwd.form) || document;
    const btns = Array.from(
      scope.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"], div[class*="btn" i], span[class*="btn" i]')
    ).filter(visible);
    const btn = btns.find((b) => {
      const t = `${b.innerText || ''} ${b.value || ''} ${b.getAttribute('aria-label') || ''}`;
      return /登[录陆]|登录|登入|确定|进入|log\s?in|sign\s?in|submit/i.test(t);
    });
    if (btn) {
      btn.click();
      clicked = true;
    } else if (pwd && pwd.form) {
      try {
        pwd.form.requestSubmit();
        clicked = true;
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  return { ok: true, userFilled: !!user, pwdFilled: !!pwd, clicked };
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch (e) {
    return null;
  }
}

async function waitForLoad(tabId, timeoutMs = 15000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      throw new Error('目标标签页已关闭');
    }
    last = tab.url || '';
    if (tab.status === 'complete' && /^https?:/i.test(last)) return { url: last, complete: true };
    await sleep(300);
  }
  return { url: last, complete: false };
}

async function handleFill(msg) {
  const url = normalizeUrl(msg.url);
  if (!url) return { ok: false, error: '登录地址无效，请检查是否为 http/https 链接' };

  const tab = await chrome.tabs.create({ url, active: true });
  const loaded = await waitForLoad(tab.id);

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: FILL_FUNC,
      args: [{ username: msg.username, password: msg.password, submit: msg.submit !== false }]
    });
  } catch (e) {
    return {
      ok: false,
      error: loaded.complete
        ? '页面禁止脚本注入（该站点可能限制扩展），已打开页面请手动输入'
        : '页面加载未完成，已打开页面请手动输入'
    };
  }

  return {
    ok: true,
    tabId: tab.id,
    url: loaded.url,
    result: results && results[0] ? results[0].result : null
  };
}

async function handleOpen(msg) {
  const url = normalizeUrl(msg.url);
  if (!url) return { ok: false, error: '登录地址无效' };
  await chrome.tabs.create({ url, active: true });
  return { ok: true };
}

/** 把导出内容写到本机磁盘；dir 非空时写到指定目录，否则用浏览器默认下载目录 */
async function handleExport(msg) {
  const ext = msg.fmt === 'json' ? 'json' : 'csv';
  const mime = ext === 'json' ? 'application/json' : 'text/csv';
  const name = `${msg.base || 'export'}.${ext}`;
  // MV3 Service Worker 没有 URL.createObjectURL，改用 data URL
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(msg.text || '')}`;

  try {
    const item = await chrome.downloads.download({
      url,
      filename: msg.dir ? `${msg.dir.replace(/\/+$/, '')}/${name}` : name,
      conflictAction: 'uniquify',
      saveAs: false
    });
    return { ok: true, id: item };
  } catch (e) {
    return { ok: false, error: '写入文件失败：' + (e && e.message ? e.message : String(e)) };
  }
}

// 安装/更新时确保侧边栏可用（点工具栏图标仍优先弹悬浮窗）
chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setOptions) {
      await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
    }
  } catch (e) {
    // 旧版 Chrome 不支持侧边栏时静默降级为「弹窗 / 全屏」两种形态
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'PV_FILL') {
    handleFill(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }));
    return true;
  }

  if (msg.type === 'PV_OPEN') {
    handleOpen(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }));
    return true;
  }

  if (msg.type === 'PV_EXPORT') {
    handleExport(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e && e.message ? e.message : String(e) }));
    return true;
  }

  if (msg.type === 'PV_PING') {
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
