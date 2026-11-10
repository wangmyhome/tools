/* DevToolbox 状态桥接脚本
   侧边栏点「全屏」时，把面板内工具页的填写/选择状态写进 URL hash（#dtstate=…），
   标签页加载本脚本后还原同样的内容与选项。
   由 build-ext.py 注入到各工具页。 */
(function () {
  'use strict';

  var m = /[#&]dtstate=([^&]*)/.exec(location.hash || '');
  if (!m) return;

  var state = null;
  try { state = JSON.parse(decodeURIComponent(m[1])); } catch (e) { return; }
  if (!state) return;

  function fire(el, types) {
    types.forEach(function (t) {
      try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {}
    });
  }

  function applyFields() {
    var f = state.f || {};
    Object.keys(f).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var v = f[id] || {};
      if ('c' in v) {
        el.checked = !!v.c;
        fire(el, ['input', 'change']);
      } else if ('v' in v) {
        el.value = v.v;
        fire(el, ['input', 'change']);
      }
    });
  }

  function applySegs() {
    var s = state.s || {};
    Object.keys(s).forEach(function (segId) {
      var seg = document.getElementById(segId);
      if (!seg) return;
      var want = String(s[segId]);
      var btns = seg.querySelectorAll('button[data-value]');
      for (var i = 0; i < btns.length; i++) {
        if (String(btns[i].dataset.value) === want) {
          btns[i].click();
          break;
        }
      }
    });
  }

  function run() {
    applyFields();
    // 选项切换会触发重新计算，放到下一拍避免和内容渲染互相打断
    setTimeout(function () {
      applySegs();
      // 还原后清掉 hash，避免刷新时重复套用旧状态
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (e) {}
    }, 80);
  }

  if (document.readyState === 'complete') {
    setTimeout(run, 60);
  } else {
    window.addEventListener('load', function () { setTimeout(run, 60); });
  }
})();
