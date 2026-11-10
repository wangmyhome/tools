(function () {
  'use strict';

  var SAMPLE = [
    '-- 第 16 步：合并 3 个渠道的数据',
    '=====step:16,spark =========',
    'set hive.exec.dynamic.partition=true;',
    'set hive.exec.dynamic.partition.mode=nonstrict;',
    'insert overwrite table st_bd.business_analysis_send_peer_all_v2 partition (ds)',
    'select',
    '    shop_id, site_code, site_name, manage_area_code, manage_area_name,',
    '    total_sum, zto_sum, sf_sum, yto_sum, sto_sum, yunda_sum, ds',
    'from (',
    '    -- 来源 1：tuxi 发同行表',
    '    select',
    "        '' as shop_id,",
    '        site_code,',
    '        0 as sf_sum,',
    '        case when coalesce(ratio_sf, 0) = 0',
    '                  and coalesce(ratio_yto, 0) = 0',
    '                  and coalesce(ratio_sto, 0) = 0',
    '             then 100.00 else ratio_zto end as ratio_zto,',
    "        'TUXI' as source_channel,",
    '        cast(ds as int) as ds',
    '    from tmp.wsp_v2_tuxi_seed_peer_final_${dt}',
    '    union all',
    '    -- 来源 2：kdgj',
    '    select ksp.shop_id, baseorganize.site_name,',
    '           shop_info.shop_name as coop_biz_name,',
    '           (case when ksp.ratio_zto > 0 then 1 else 0 end +',
    '            case when ksp.ratio_sf > 0 then 1 else 0 end) as partner_courier_count',
    '    from tmp.wsp_v2_kdgj_seed_peer_${dt} ksp',
    "    left join (select * from st_bd.mkt_analysis_base_baseorganize_info_d1 where ds = '${dt}') baseorganize",
    '        on baseorganize.site_code = ksp.site_code',
    ') t;'
  ].join('\n');

  var el = {
    input: document.getElementById('input'),
    out: document.getElementById('out'),
    stats: document.getElementById('stats'),
    warn: document.getElementById('warn'),
    segIndent: document.getElementById('segIndent'),
    segCase: document.getElementById('segCase'),
    segAnd: document.getElementById('segAnd'),
    segWrap: document.getElementById('segWrap')
  };

  var STORE_KEY = 'devtoolbox.sql.opts.v1';
  var opts = { indentSize: 2, keywordCase: 'upper', breakAndOr: true, maxWidth: 100 };
  var last = { text: '', ok: false };

  try {
    var saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (saved.indentSize) opts.indentSize = saved.indentSize;
      if (saved.keywordCase) opts.keywordCase = saved.keywordCase;
      if (typeof saved.breakAndOr === 'boolean') opts.breakAndOr = saved.breakAndOr;
      if (typeof saved.maxWidth === 'number') opts.maxWidth = saved.maxWidth;
    }
  } catch (e) { /* 忽略 */ }

  function saveOpts() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(opts)); } catch (e) {}
  }

  function parenWarning(src) {
    var toks;
    try { toks = window.SQLFormat.parse(src); } catch (e) { return ''; }
    var depth = 0, min = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.t !== 'punct') continue;
      if (t.v === '(') depth++;
      else if (t.v === ')') { depth--; if (depth < min) min = depth; }
    }
    if (depth > 0) return '有 ' + depth + ' 个括号没有闭合，格式可能不完整';
    if (min < 0) return '多出了 ' + (-min) + ' 个右括号';
    return '';
  }

  function run() {
    var src = el.input.value;
    var warnText = src.trim() ? parenWarning(src) : '';
    el.warn.textContent = warnText ? '⚠ ' + warnText : '';
    el.warn.classList.toggle('show', !!warnText);

    if (!src.trim()) {
      el.out.innerHTML =
        '<div class="empty"><strong>格式化结果会显示在这里</strong>'
        + '<span>粘贴或输入 SQL，按 <kbd data-kbd>⌘⏎</kbd> 立即排版</span></div>';
      el.stats.textContent = '';
      last = { text: '', ok: false };
      return;
    }

    var res = window.SQLFormat.format(src, opts);
    var html = [];
    for (var i = 0; i < res.lines.length; i++) {
      html.push('<div class="line"><span class="ln">' + (i + 1) + '</span>'
        + '<span class="code">' + window.SQLFormat.lineHtml(res.lines[i], opts.indentSize)
        + '</span></div>');
    }
    el.out.innerHTML = html.join('');

    last.text = res.text;
    last.ok = true;

    var lines = res.text ? res.text.split('\n').length : 0;
    el.stats.textContent = lines + ' 行 · ' + res.text.length + ' 字符';
  }

  /* ------------------------------------------------ 分段控件 */
  TB.bindSeg(el.segIndent, String(opts.indentSize), function (v) {
    opts.indentSize = parseInt(v, 10) || 2; saveOpts(); run();
  });
  TB.bindSeg(el.segCase, opts.keywordCase, function (v) {
    opts.keywordCase = v; saveOpts(); run();
  });
  TB.bindSeg(el.segAnd, opts.breakAndOr ? 'break' : 'inline', function (v) {
    opts.breakAndOr = (v === 'break'); saveOpts(); run();
  });
  TB.bindSeg(el.segWrap, String(opts.maxWidth), function (v) {
    opts.maxWidth = parseInt(v, 10) || 0; saveOpts(); run();
  });

  /* ------------------------------------------------ 按钮 */
  document.getElementById('formatBtn').addEventListener('click', function () {
    run();
    if (last.ok) TB.toast('已格式化');
  });

  document.getElementById('sampleBtn').addEventListener('click', function () {
    el.input.value = SAMPLE;
    run();
    el.input.focus();
  });

  document.getElementById('clearBtn').addEventListener('click', function () {
    el.input.value = '';
    run();
    el.input.focus();
  });

  document.getElementById('copyBtn').addEventListener('click', function () {
    if (!last.ok) { TB.toast('还没有可复制的结果'); return; }
    TB.copyWithToast(last.text, '格式化后的 SQL');
  });

  document.getElementById('downloadBtn').addEventListener('click', function () {
    if (!last.ok) { TB.toast('还没有可下载的结果'); return; }
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    var name = 'formatted-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
      + '-' + p(d.getHours()) + p(d.getMinutes()) + '.sql';
    var blob = new Blob([last.text + '\n'], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    TB.toast('已下载 .sql 文件');
  });

  /* ------------------------------------------------ 交互细节 */
  TB.bindRunKey(run);
  TB.bindFullscreenButton(document.getElementById('fullBtn'));
  TB.enableTabIndent(el.input, opts.indentSize);


  el.input.addEventListener('paste', function () { setTimeout(run, 0); });

  ['dragover', 'drop'].forEach(function (t) {
    el.input.addEventListener(t, function (e) { e.preventDefault(); });
  });
  el.input.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      el.input.value = String(r.result || '');
      run();
      TB.toast('已载入 ' + f.name);
    };
    r.readAsText(f, 'utf-8');
  });

  /* ------------------------------------------------ 启动 */
  el.input.value = SAMPLE;
  run();
})();
