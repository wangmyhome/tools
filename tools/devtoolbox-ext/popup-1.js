/* DevToolbox 扩展弹窗脚本：
   - 工具搜索过滤
   - 主题循环切换（与工具页共用 localStorage 键，切换后工具页同步生效）
   - 打开首页 / 打开工具（chrome.tabs 失败时降级 window.open） */
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
    var valid = THEMES.some(function (t) { return t.id === saved; });
    if (valid) { applyTheme(saved); return; }
    var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(light ? 'light' : 'dark');
  }

  function bindTheme() {
    var btn = document.getElementById('themeBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur = document.documentElement.dataset.theme || 'dark';
      var idx = 0;
      THEMES.forEach(function (t, i) { if (t.id === cur) idx = i; });
      applyTheme(THEMES[(idx + 1) % THEMES.length].id);
    });
  }

  /* ------------------------------------------------ 打开地址（扩展页 / 降级） */
  function openUrl(url) {
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

  /* ------------------------------------------------ 搜索过滤 */
  function bindSearch() {
    var q = document.getElementById('q');
    var list = document.getElementById('list');
    var empty = document.getElementById('empty');
    if (!q || !list) return;

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

    q.addEventListener('input', filter);
    q.addEventListener('search', filter);

    q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var first = items.filter(function (li) { return li.style.display !== 'none'; })[0];
      if (!first) return;
      var a = first.querySelector('a');
      if (a) openUrl(a.href);
    });

    filter();
  }

  /* ------------------------------------------------ 初始化 */
  initTheme();
  bindTheme();
  bindSearch();

  var homeBtn = document.getElementById('homeBtn');
  if (homeBtn) {
    homeBtn.addEventListener('click', function () {
      openUrl(absUrl('index.html'));
    });
  }

  /* 切换为侧边栏形态 */
  var sideBtn = document.getElementById('sideBtn');
  if (sideBtn) {
    sideBtn.addEventListener('click', function () {
      var open = function (windowId) {
        try {
          chrome.sidePanel.open(windowId ? { windowId: windowId } : undefined)
            .then(function () { window.close(); })
            .catch(function () { openUrl(absUrl('index.html')); });
          return true;
        } catch (e) { return false; }
      };
      try {
        if (window.chrome && chrome.sidePanel && chrome.windows && chrome.windows.getCurrent) {
          chrome.windows.getCurrent(function (w) {
            if (!open(w && w.id)) openUrl(absUrl('index.html'));
          });
          return;
        }
      } catch (e) {}
      openUrl(absUrl('index.html'));
    });
  }
})();
