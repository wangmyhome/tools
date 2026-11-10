(function () {
  'use strict';

  var el = {
    a: document.getElementById('a'),
    b: document.getElementById('b'),
    out: document.getElementById('out'),
    stat: document.getElementById('stat'),
    statsA: document.getElementById('statsA'),
    statsB: document.getElementById('statsB'),
    segWs: document.getElementById('segWs'),
    segView: document.getElementById('segView'),
    segCtx: document.getElementById('segCtx')
  };

  var opts = { ignore: false, collapse: true };

  function esc(s) { return TB.escapeHtml(s); }
  function countLines(t) { return t ? t.split('\n').length : 0; }

  function updateCounts() {
    el.statsA.textContent = countLines(el.a.value) + ' 行';
    el.statsB.textContent = countLines(el.b.value) + ' 行';
  }

  function splitLines(v) {
    var arr = v.split('\n');
    if (arr.length && arr[arr.length - 1] === '') arr.pop();
    return arr;
  }

  /* ------------------------------------------------ 构建对齐行
     row: { type: same|mod|add|del, l, r, lnL, lnR } */
  /* 内容相似度：字符二元组 Dice 系数，0～1；≥0.6 才算「修改」配对 */
  function bigrams(s) {
    var set = {};
    var n = 0;
    for (var i = 0; i < s.length - 1; i++) {
      var b = s.slice(i, i + 2);
      set[b] = (set[b] || 0) + 1;
      n++;
    }
    return { set: set, n: n };
  }

  function similar(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    var A = bigrams(a), B = bigrams(b);
    if (!A.n || !B.n) return 0;
    var common = 0;
    for (var k in A.set) common += Math.min(A.set[k], B.set[k] || 0);
    return (2 * common) / (A.n + B.n);
  }

  var SIM_THRESHOLD = 0.6;

  // 把一组删除行与一组新增行配对：相似度≥阈值才算「修改」
  function pairDelAdd(dels, adds) {
    var mods = [];
    var usedAdd = new Array(adds.length).fill(false);
    var delUsed = new Array(dels.length).fill(false);
    for (var i = 0; i < dels.length; i++) {
      var best = -1, bestSim = SIM_THRESHOLD;
      for (var j = 0; j < adds.length; j++) {
        if (usedAdd[j]) continue;
        var s = similar(dels[i], adds[j]);
        if (s >= bestSim) { bestSim = s; best = j; }
      }
      if (best >= 0) { usedAdd[best] = true; delUsed[i] = true; mods.push([dels[i], adds[best]]); }
    }
    var leftDels = [], addLeft = [];
    for (var d = 0; d < dels.length; d++) if (!delUsed[d]) leftDels.push(dels[d]);
    for (var a2 = 0; a2 < adds.length; a2++) if (!usedAdd[a2]) addLeft.push(adds[a2]);
    return { mods: mods, dels: leftDels, adds: addLeft };
  }

  function buildRows(parts) {
    var rows = [];
    var lnL = 0, lnR = 0;
    var pendDel = null;   // 待与新增配对的删除行
    var pendAdd = null;   // 先出现的新增行（可能与后面的删除配对）

    function emitDel(line) { lnL++; rows.push({ type: 'del', l: line, r: null, lnL: lnL, lnR: null }); }
    function emitAdd(line) { lnR++; rows.push({ type: 'add', l: null, r: line, lnL: null, lnR: lnR }); }
    function emitPair(pair) {
      lnL++; lnR++;
      rows.push({ type: 'mod', l: pair[0], r: pair[1], lnL: lnL, lnR: lnR });
    }
    function flush() {
      if (pendDel) { pendDel.forEach(emitDel); pendDel = null; }
      if (pendAdd) { pendAdd.forEach(emitAdd); pendAdd = null; }
    }

    parts.forEach(function (part) {
      if (part.added) {
        var adds = splitLines(part.value);
        if (pendDel) {
          var p = pairDelAdd(pendDel, adds);
          p.mods.forEach(emitPair);
          p.dels.forEach(emitDel);
          pendAdd = p.adds.length ? p.adds : null;
          pendDel = null;
        } else {
          pendAdd = (pendAdd || []).concat(adds);
        }
      } else if (part.removed) {
        if (pendAdd) {
          var p2 = pairDelAdd(splitLines(part.value), pendAdd);
          p2.mods.forEach(emitPair);
          p2.dels.forEach(emitDel);
          pendAdd = p2.adds.length ? p2.adds : null;
        } else {
          pendDel = (pendDel || []).concat(splitLines(part.value));
        }
      } else {
        flush();
        splitLines(part.value).forEach(function (line) {
          lnL++; lnR++;
          rows.push({ type: 'same', l: line, r: line, lnL: lnL, lnR: lnR });
        });
      }
    });
    flush();
    return rows;
  }

  /* ------------------------------------------------ 输入区对齐视图 */
  var el2 = {
    hlA: document.getElementById('hlA'),
    hlB: document.getElementById('hlB')
  };
  var lastTypeL = {};   // 行号 -> 差异类型（上次对比结果）
  var lastTypeR = {};
  var anchors = [[0, 0], [1, 1]];  // [A行号, B行号] 对齐锚点

  function esc(s) { return TB.escapeHtml(s); }

  function renderSideOverlay(pre, lines, typeMap, signOf) {
    var html = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = i + 1;
      var type = typeMap[ln] || 'same';
      var sign = signOf(type);
      html.push('<div class="oline ' + type + '">'
        + '<span class="sign">' + sign + '</span>'
        + '<span class="ln">' + ln + '</span>'
        + '<span class="otext">' + esc(lines[i]) + '</span></div>');
    }
    pre.innerHTML = html.join('');
  }

  function renderInputOverlay(rows) {
    lastTypeL = {}; lastTypeR = {};
    var maxL = 0, maxR = 0;
    anchors = [[0, 0]];
    rows.forEach(function (r) {
      if (r.lnL != null) { lastTypeL[r.lnL] = r.type; maxL = Math.max(maxL, r.lnL); }
      if (r.lnR != null) { lastTypeR[r.lnR] = r.type; maxR = Math.max(maxR, r.lnR); }
      if (r.lnL != null && r.lnR != null) anchors.push([r.lnL, r.lnR]);
    });
    anchors.push([maxL + 1, maxR + 1]);

    var linesA = el.a.value.split('\n');
    var linesB = el.b.value.split('\n');
    renderSideOverlay(el2.hlA, linesA, lastTypeL, function (t) {
      return t === 'mod' ? 'M' : t === 'del' ? '−' : '';
    });
    renderSideOverlay(el2.hlB, linesB, lastTypeR, function (t) {
      return t === 'mod' ? 'M' : t === 'add' ? '+' : '';
    });
  }

  // 编辑时立即用旧映射重渲染（文字不消失），颜色等重新对比后更新
  function quickRender() {
    renderSideOverlay(el2.hlA, el.a.value.split('\n'), lastTypeL, function (t) {
      return t === 'mod' ? 'M' : t === 'del' ? '−' : '';
    });
    renderSideOverlay(el2.hlB, el.b.value.split('\n'), lastTypeR, function (t) {
      return t === 'mod' ? 'M' : t === 'add' ? '+' : '';
    });
  }

  // A 行号 → B 行号（锚点线性插值）
  function mapLine(x, fromB) {
    var pts = anchors;
    if (fromB) pts = anchors.map(function (p) { return [p[1], p[0]]; });
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        var a1 = pts[i - 1], a2 = pts[i];
        if (a2[0] === a1[0]) return a2[1];
        return a1[1] + (x - a1[0]) * (a2[1] - a1[1]) / (a2[0] - a1[0]);
      }
    }
    var last = pts[pts.length - 1];
    return last[1] + (x - last[0]);
  }

  function lineH() {
    var lh = parseFloat(getComputedStyle(el.a).lineHeight);
    return isNaN(lh) ? 22.1 : lh;
  }

  var syncLock = false;
  function syncScroll(src, dst, fromB) {
    if (syncLock) return;
    syncLock = true;
    var lh = lineH();
    var topLine = src.scrollTop / lh + 1;
    var target = mapLine(topLine, fromB);
    dst.scrollTop = (target - 1) * lh;
    // 可见高亮层跟随各自的 textarea
    var srcHl = fromB ? el2.hlB : el2.hlA;
    var dstHl = fromB ? el2.hlA : el2.hlB;
    srcHl.scrollTop = src.scrollTop;
    srcHl.scrollLeft = src.scrollLeft;
    dstHl.scrollTop = dst.scrollTop;
    dstHl.scrollLeft = dst.scrollLeft;
    syncLock = false;
  }

  /* ------------------------------------------------ 渲染 */
  function sideHtml(cls, ln, text, empty, sign) {
    return '<div class="side ' + cls + '">'
      + '<div class="sign">' + sign + '</div>'
      + '<div class="num">' + (ln == null ? '' : ln) + '</div>'
      + '<div class="txt' + (empty ? ' empty-cell' : '') + '">' + (text == null ? '' : esc(text)) + '</div>'
      + '</div>';
  }

  function rowHtml(row) {
    var lSign = row.type === 'mod' ? 'M' : row.type === 'del' ? '−' : '';
    var rSign = row.type === 'mod' ? 'M' : row.type === 'add' ? '+' : '';
    return '<div class="sbs-row ' + row.type + '">'
      + sideHtml('left', row.lnL, row.l, row.l == null, lSign)
      + sideHtml('right', row.lnR, row.r, row.r == null, rSign)
      + '</div>';
  }

  function skipHtml(n) {
    return '<div class="skip-row"><div>⋯ 跳过 ' + n + ' 行未变内容 ⋯</div>'
      + '<div>⋯ 跳过 ' + n + ' 行未变内容 ⋯</div></div>';
  }

  function run() {
    updateCounts();
    var a = el.a.value, b = el.b.value;

    if (!a && !b) {
      el.out.innerHTML = '<div class="empty" style="grid-column:1/-1"><strong>差异会显示在这里</strong>'
        + '<span>填入两段文本，按 <kbd data-kbd>⌘⏎</kbd> 开始对比</span></div>';
      el.stat.textContent = '';
      return;
    }

    var parts = window.Diff.diffLines(a, b, { ignoreWhitespace: opts.ignore });
    var rows = buildRows(parts);

    var mods = 0, adds = 0, dels = 0;
    rows.forEach(function (r) {
      if (r.type === 'mod') mods++;
      else if (r.type === 'add') adds++;
      else if (r.type === 'del') dels++;
    });

    // 未变行折叠
    var html = [];
    var CTX = 3;
    var i = 0;
    while (i < rows.length) {
      if (rows[i].type !== 'same') { html.push(rowHtml(rows[i])); i++; continue; }

      var j = i;
      while (j < rows.length && rows[j].type === 'same') j++;
      var runLen = j - i;

      if (!opts.collapse || runLen <= CTX * 2 + 1) {
        for (var k = i; k < j; k++) html.push(rowHtml(rows[k]));
      } else {
        for (var h1 = i; h1 < i + CTX; h1++) html.push(rowHtml(rows[h1]));
        var hidden = (j - CTX) - (i + CTX);
        if (hidden > 0) html.push(skipHtml(hidden));
        for (var h2 = j - CTX; h2 < j; h2++) html.push(rowHtml(rows[h2]));
      }
      i = j;
    }

    el.out.innerHTML = html.length ? html.join('')
      : '<div class="empty" style="grid-column:1/-1"><strong>两段文本完全相同</strong>'
        + '<span>没有任何差异</span></div>';

    el.stat.innerHTML =
      (mods ? '<span style="color:#eab308">' + mods + ' 处修改</span>' : '')
      + (adds ? ' <span class="plus">+' + adds + '</span>' : '')
      + (dels ? ' <span class="minus">-' + dels + '</span>' : '');

    renderInputOverlay(rows);

    document.title = '文本对比 (' + mods + '改 +' + adds + ' -' + dels + ') · DevToolbox';
    TB.toast(mods || adds || dels
      ? '已对比：' + mods + ' 处修改，+' + adds + '，-' + dels
      : '两段文本完全相同');
  }

  /* ------------------------------------------------ 视图模式 */
  var view = 'both';
  function applyView(v) {
    view = v;
    var body = document.body;
    body.classList.toggle('view-both', v === 'both');
    body.classList.toggle('view-input', v === 'input');
    body.classList.toggle('view-result', v === 'result');
  }
  TB.bindSeg(el.segView, 'both', applyView);

  /* ------------------------------------------------ 控件 */
  TB.bindSeg(el.segWs, opts.ignore ? 'ignore' : 'strict', function (v) {
    opts.ignore = (v === 'ignore'); run();
  });
  TB.bindSeg(el.segCtx, opts.collapse ? 'collapse' : 'full', function (v) {
    opts.collapse = (v === 'collapse'); run();
  });

  document.getElementById('diffBtn').addEventListener('click', run);

  document.getElementById('sampleBtn').addEventListener('click', function () {
    el.a.value = [
      '-- 用户表同步任务 v1.2',
      'insert overwrite table dw.user_profile partition (ds="2026-10-26")',
      'select',
      '    user_id,',
      '    user_name,',
      '    age,',
      '    city_code,',
      '    register_time,',
      '    status',
      'from ods.user_info',
      'where ds = "2026-10-26";'
    ].join('\n');
    el.b.value = [
      '-- 用户表同步任务 v1.3',
      'insert overwrite table dw.user_profile partition (ds="${bizdate}")',
      'select',
      '    user_id,',
      '    user_name,',
      '    case when age < 0 then null else age end as age,',
      '    city_code,',
      '    register_time,',
      '    status,',
      '    last_login_time,',
      '    tag_list',
      'from ods.user_info',
      'where ds = "${bizdate}"',
      '  and user_id > 0;'
    ].join('\n');
    run();
    TB.toast('已载入示例：黄色=修改，绿色=新增，红色=删除');
  });

  document.getElementById('swapBtn').addEventListener('click', function () {
    var t = el.a.value;
    el.a.value = el.b.value;
    el.b.value = t;
    run();
  });

  document.getElementById('clearBtn').addEventListener('click', function () {
    el.a.value = '';
    el.b.value = '';
    run();
    el.a.focus();
  });

  document.getElementById('copyBtn').addEventListener('click', function () {
    var lines = [];
    document.querySelectorAll('#out .sbs-row').forEach(function (r) {
      var l = r.querySelector('.side.left .txt').textContent;
      var rr = r.querySelector('.side.right .txt').textContent;
      var type = r.classList.contains('mod') ? 'M'
        : r.classList.contains('add') ? '+' : r.classList.contains('del') ? '-' : ' ';
      lines.push(type + ' ' + (l || rr));
    });
    TB.copyWithToast(lines.join('\n'), '差异文本');
  });

  TB.bindRunKey(run);
  TB.bindFullscreenButton(document.getElementById('fullBtn'));
  TB.enableTabIndent(el.a, 2);
  TB.enableTabIndent(el.b, 2);

  /* ------------------------------------------------ 输入后自动对比 */
  var runSoon = TB.debounce(run, 300);
  el.a.addEventListener('input', function () { updateCounts(); quickRender(); runSoon(); });
  el.b.addEventListener('input', function () { updateCounts(); quickRender(); runSoon(); });
  el.a.addEventListener('paste', function () { setTimeout(function () { updateCounts(); run(); }, 0); });
  el.b.addEventListener('paste', function () { setTimeout(function () { updateCounts(); run(); }, 0); });

  el.a.addEventListener('scroll', function () { syncScroll(el.a, el.b, false); });
  el.b.addEventListener('scroll', function () { syncScroll(el.b, el.a, true); });

  updateCounts();
  renderInputOverlay([{ type: 'same', lnL: 1, lnR: 1 }]);
})();
