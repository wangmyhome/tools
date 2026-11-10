(function () {
  'use strict';

  var el = {
    clock: document.getElementById('clock'),
    today: document.getElementById('today'),
    nowList: document.getElementById('nowList'),
    tsIn: document.getElementById('tsIn'),
    tsOut: document.getElementById('tsOut'),
    tsWarn: document.getElementById('tsWarn'),
    dtIn: document.getElementById('dtIn'),
    dtOut: document.getElementById('dtOut'),
    dtWarn: document.getElementById('dtWarn'),
    pauseBtn: document.getElementById('pauseBtn')
  };

  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function pad(n) { return String(n).padStart(2, '0'); }

  function fmtLocal(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function fmtCn(d) {
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 '
      + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* ------------------------------------------------ 键值行 */
  function kvRow(key, value, copyValue) {
    return '<div class="kv">'
      + '<span class="kv-k">' + TB.escapeHtml(key) + '</span>'
      + '<span class="kv-v" data-copy="' + TB.escapeHtml(copyValue == null ? value : copyValue) + '">'
      + TB.escapeHtml(value) + '</span></div>';
  }

  function kvList(rows) {
    return rows.map(function (r) { return kvRow(r[0], r[1], r[2]); }).join('');
  }

  document.addEventListener('click', function (e) {
    var v = e.target.closest('.kv-v');
    if (v) TB.copyWithToast(v.dataset.copy, v.dataset.copy.length > 28
      ? v.dataset.copy.slice(0, 28) + '…' : v.dataset.copy);
  });

  el.clock.addEventListener('click', function () {
    TB.copyWithToast(el.clock.textContent, '当前本地时间');
  });

  /* ------------------------------------------------ 实时时钟 */
  var paused = false;

  function renderNow() {
    if (paused) return;
    var d = new Date();
    el.clock.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    el.today.textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月'
      + d.getDate() + '日 · ' + WEEK[d.getDay()];

    el.nowList.innerHTML = kvList([
      ['Unix 秒', String(Math.floor(d.getTime() / 1000))],
      ['Unix 毫秒', String(d.getTime())],
      ['ISO 8601', d.toISOString()],
      ['本地时间', fmtLocal(d)],
      ['UTC', d.toUTCString()],
      ['本年第几天', String(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000))]
    ]);
  }

  setInterval(renderNow, 1000);
  renderNow();

  el.pauseBtn.addEventListener('click', function () {
    paused = !paused;
    el.pauseBtn.textContent = paused ? '继续' : '暂停';
    if (!paused) renderNow();
  });

  /* ------------------------------------------------ 时间戳 → 日期 */
  function fmtTs(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return [
      ['Unix 秒', String(Math.floor(ms / 1000))],
      ['Unix 毫秒', String(ms)],
      ['ISO 8601', d.toISOString()],
      ['本地时间', fmtLocal(d)],
      ['UTC', d.toUTCString()],
      ['中文格式', fmtCn(d) + ' ' + WEEK[d.getDay()]]
    ];
  }

  function tsRun() {
    var raw = el.tsIn.value.trim();
    if (!raw) {
      el.tsOut.innerHTML = '<div class="empty" style="min-height:150px"><strong>等待输入</strong>'
        + '<span>支持 10 位（秒）与 13 位（毫秒）</span></div>';
      el.tsWarn.classList.remove('show');
      return;
    }
    if (!/^-?\d+$/.test(raw)) {
      el.tsOut.innerHTML = '<div class="empty error" style="min-height:150px"><strong>不是合法时间戳</strong>'
        + '<span>请输入纯数字，例如 1750000000</span></div>';
      return;
    }
    var n = Number(raw);
    if (Math.abs(n) > 1e11 && Math.abs(n) < 1e14) { /* 已是毫秒 */ }
    else if (Math.abs(n) < 1e11) n *= 1000; // 秒 → 毫秒

    var rows = fmtTs(n);
    if (!rows) {
      el.tsOut.innerHTML = '<div class="empty error" style="min-height:150px"><strong>超出可表示范围</strong>'
        + '<span>请检查数值是否正确</span></div>';
      el.tsWarn.classList.add('show');
      el.tsWarn.textContent = '⚠ 该时间戳无法转换为有效日期';
      return;
    }
    el.tsWarn.classList.remove('show');
    el.tsOut.innerHTML = kvList(rows);
  }

  /* ------------------------------------------------ 日期 → 时间戳 */
  function parseDate(raw) {
    var s = raw.trim();
    if (!s) return null;
    // 纯数字 → 当时间戳处理
    if (/^-?\d+$/.test(s)) {
      var n = Number(s);
      return s.length <= 10 ? n * 1000 : n;
    }
    // 2026-10-26 14:30:00 / 2026/10/26 等
    var m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(s);
    if (m) {
      var d = new Date(
        Number(m[1]), Number(m[2]) - 1, Number(m[3]),
        Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
      );
      return isNaN(d.getTime()) ? null : d.getTime();
    }
    // 其余交给原生解析（ISO 等）
    var nd = new Date(s);
    return isNaN(nd.getTime()) ? null : nd.getTime();
  }

  function dtRun() {
    var raw = el.dtIn.value.trim();
    if (!raw) {
      el.dtOut.innerHTML = '<div class="empty" style="min-height:150px"><strong>等待输入</strong>'
        + '<span>支持 2026-10-26、2026/10/26 14:30、ISO 格式</span></div>';
      el.dtWarn.classList.remove('show');
      return;
    }
    var ms = parseDate(raw);
    if (ms == null) {
      el.dtOut.innerHTML = '<div class="empty error" style="min-height:150px"><strong>无法解析这个日期</strong>'
        + '<span>示例：2026-10-26、2026/10/26 14:30、2026-10-26T14:30:00Z</span></div>';
      el.dtWarn.classList.add('show');
      el.dtWarn.textContent = '⚠ 请检查日期格式';
      return;
    }
    el.dtWarn.classList.remove('show');

    var d = new Date(ms);
    var diff = Math.round((Date.now() - ms) / 1000);
    var rel = '';
    var abs = Math.abs(diff);
    if (abs < 60) rel = diff >= 0 ? abs + ' 秒前' : abs + ' 秒后';
    else if (abs < 3600) rel = Math.round(abs / 60) + ' 分钟' + (diff >= 0 ? '前' : '后');
    else if (abs < 86400) rel = Math.round(abs / 3600) + ' 小时' + (diff >= 0 ? '前' : '后');
    else rel = Math.round(abs / 86400) + ' 天' + (diff >= 0 ? '前' : '后');

    el.dtOut.innerHTML = kvList([
      ['Unix 秒', String(Math.floor(ms / 1000))],
      ['Unix 毫秒', String(ms)],
      ['ISO 8601', d.toISOString()],
      ['本地时间', fmtLocal(d)],
      ['UTC', d.toUTCString()],
      ['相对现在', rel + '（' + WEEK[d.getDay()] + '）']
    ]);
  }

  /* ------------------------------------------------ 按钮 */
  document.getElementById('tsBtn').addEventListener('click', tsRun);
  document.getElementById('dtBtn').addEventListener('click', dtRun);

  document.getElementById('tsNowBtn').addEventListener('click', function () {
    el.tsIn.value = String(Math.floor(Date.now() / 1000));
    tsRun();
  });
  document.getElementById('dtNowBtn').addEventListener('click', function () {
    el.dtIn.value = fmtLocal(new Date());
    dtRun();
  });

  TB.bindRunKey(tsRun);
  el.tsIn.addEventListener('input', TB.debounce(tsRun, 200));
  el.tsIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) tsRun();
  });

  el.dtIn.addEventListener('input', TB.debounce(dtRun, 200));
  el.dtIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') dtRun();
  });

  el.tsIn.focus();
})();
