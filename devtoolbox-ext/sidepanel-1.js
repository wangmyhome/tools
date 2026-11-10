/* DevToolbox 侧边栏脚本
   - 工具列表 + 搜索
   - 点工具 → 面板内 iframe 打开（不跳转标签页）
   - ↗ 全屏按钮 / 头部标签页按钮 → 标签页打开
   - 主题切换（与工具页共享 localStorage） */
(function () {
  'use strict';

  var THEME_KEY = 'devtoolbox.theme.v1';
  var THEMES = [
    { id: 'dark',  name: '深色' },
    { id: 'light', name: '浅色' },
    { id: 'eye',   name: '护眼绿' },
    { id: 'solar', name: '暖米黄' }
  ];

  /* ------------------------------------------------ 主题 */
  function applyTheme(id) {
    document.documentElement.dataset.theme = id;
    try { localStorage.setItem(THEME_KEY, id); } catch (e) {}
    var btn = document.getElementById('themeBtn');
    if (btn) {
      var t = THEMES.filter(function (x) { return x.id === id; })[0] || THEMES[0];
      btn.title = '当前主题：' + t.name + '（点击切换）';
    }
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (THEMES.some(function (t) { return t.id === saved; })) { applyTheme(saved); return; }
    var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(light ? 'light' : 'dark');
  }

  /* ------------------------------------------------ chrome API 降级封装 */
  function openTab(url) {
    try {
      if (window.chrome && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: url });
        return;
      }
    } catch (e) {}
    try { window.open(url, '_blank'); } catch (e2) {}
  }

  function absUrl(page) {
    try {
      if (window.chrome && chrome.runtime && chrome.runtime.getURL) {
        return chrome.runtime.getURL(page);
      }
    } catch (e) {}
    return page;
  }

  /* ------------------------------------------------ 面板内工具视图 */
  var toolview = document.getElementById('toolview');
  var tvFrame = document.getElementById('tvFrame');
  var tvTitle = document.getElementById('tvTitle');
  var backBtn = document.getElementById('backBtn');
  var fsBtn = document.getElementById('fsBtn');
  var currentTool = null;   // { href, name }

  function openToolInPanel(href, name) {
    currentTool = { href: href, name: name || '工具' };
    if (tvTitle) tvTitle.textContent = currentTool.name;
    if (tvFrame) tvFrame.setAttribute('src', href);
    if (toolview) {
      toolview.classList.add('open');
      toolview.setAttribute('aria-hidden', 'false');
    }
  }

  function closeTool() {
    if (toolview) {
      toolview.classList.remove('open');
      toolview.setAttribute('aria-hidden', 'true');
    }
    // 清空 iframe，停掉定时器/监听
    setTimeout(function () {
      if (tvFrame && !toolview.classList.contains('open')) {
        tvFrame.setAttribute('src', 'about:blank');
      }
    }, 220);
  }

  if (backBtn) {
    backBtn.addEventListener('click', function () {
      closeTool();
      currentTool = null;
    });
  }

  /* 采集面板内工具页的填写内容与选项，随 URL hash 一起带到标签页 */
  function collectState() {
    var doc = null;
    try { doc = tvFrame && tvFrame.contentDocument; } catch (e) { return null; }
    if (!doc || !doc.body) return null;

    var f = {}, s = {}, has = false;

    Array.prototype.forEach.call(
      doc.querySelectorAll('textarea[id], input[id], select[id]'),
      function (el) {
        if (!el.id) return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          f[el.id] = { c: !!el.checked };
        } else {
          f[el.id] = { v: el.value };
        }
        has = true;
      });

    Array.prototype.forEach.call(doc.querySelectorAll('.seg[id]'), function (seg) {
      var active = seg.querySelector('button[aria-pressed="true"]');
      if (active && active.dataset && active.dataset.value != null) {
        s[seg.id] = active.dataset.value;
        has = true;
      }
    });

    return has ? { f: f, s: s } : null;
  }

  if (fsBtn) {
    fsBtn.addEventListener('click', function () {
      // 全屏：把当前工具 + 面板里的填写状态原封不动搬进标签页
      if (!currentTool) { openTab(absUrl('index.html')); return; }

      var url = absUrl(currentTool.href);
      var st = collectState();
      if (st) {
        try {
          var payload = encodeURIComponent(JSON.stringify(st));
          // URL 上限保护：超长时退回只开页面（避免打开失败）
          if (payload.length < 1500000) url += '#dtstate=' + payload;
        } catch (e) {}
      }
      openTab(url);
    });
  }

  /* ------------------------------------------------ 头部按钮 */
  initTheme();

  var themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = document.documentElement.dataset.theme || 'dark';
      var idx = 0;
      THEMES.forEach(function (t, i) { if (t.id === cur) idx = i; });
      applyTheme(THEMES[(idx + 1) % THEMES.length].id);
    });
  }

  var tabBtn = document.getElementById('tabBtn');
  if (tabBtn) {
    tabBtn.addEventListener('click', function () { openTab(absUrl('index.html')); });
  }

  /* ------------------------------------------------ 列表 + 搜索 + 点击进面板 */
  var q = document.getElementById('q');
  var list = document.getElementById('list');
  var empty = document.getElementById('empty');

  if (list) {
    var items = Array.prototype.slice.call(list.querySelectorAll('li'));

    function filter() {
      var kw = (q.value || '').trim().toLowerCase();
      var shown = 0;
      items.forEach(function (li) {
        var hay = (li.getAttribute('data-keys') || '') + ' ' + li.textContent;
        var hit = !kw || hay.toLowerCase().indexOf(kw) >= 0;
        li.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      if (empty) empty.classList.toggle('show', shown === 0);
      list.style.display = shown ? '' : 'none';
    }

    items.forEach(function (li) {
      var a = li.querySelector('a');
      if (!a) return;
      a.addEventListener('click', function (e) {
        // 面板内打开：拦住默认的标签页跳转
        e.preventDefault();
        var name = a.querySelector('b') ? a.querySelector('b').textContent : '工具';
        openToolInPanel(a.getAttribute('href'), name);
      });
    });

    if (q) {
      q.addEventListener('input', filter);
      q.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var first = items.filter(function (li) { return li.style.display !== 'none'; })[0];
        var a = first && first.querySelector('a');
        if (!a) return;
        var name = a.querySelector('b') ? a.querySelector('b').textContent : '工具';
        openToolInPanel(a.getAttribute('href'), name);
      });
      filter();
    }
  }
})();
