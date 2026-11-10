(function () {
  'use strict';

  var JC = window.JSONCParser;

  var SAMPLE = '{"title":"JSON在线解析","json.url":"https://wangmyhome.github.io/devtoolbox/tools/json.html",'
    + '"keywords":"JSON在线解析","Function":["JSON美化","JSON数据类型显示",'
    + '"JSON数组显示角标","高亮显示","错误提示","\\u003e","&nbsp;","","<h1>JSON在线解析</h1>"],'
    + '"About":{"QQ":661275469},"Special":["&currency","$%^&*(@)"],'
    + '"active":true,"score":98.5,"vip":null,"items":[{"sku":"A-1","qty":2},{"sku":"B-7","qty":1}]}';

  var el = {
    input: document.getElementById('input'),
    keepEsc: document.getElementById('keepEsc'),
    out: document.getElementById('out'),
    outTitle: document.getElementById('outTitle'),
    stats: document.getElementById('stats'),
    warn: document.getElementById('warn'),
    segIndent: document.getElementById('segIndent'),
    segSort: document.getElementById('segSort'),
    segMode: document.getElementById('segMode')
  };

  var opts = { indent: '2', sort: 'keep', mode: 'pretty', keepEsc: false };
  var last = { text: '', ok: false };
  var data = null;

  function esc(s) { return TB.escapeHtml(s); }

  /* ------------------------------------------------ 输入区原格式高亮
     逐 token 扫描，不改变文字内容，只加颜色；保留原始缩进与换行 */
  var RE_TOK = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}\[\],:])|(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(\s+)|(.)/g;

  function rawHighlight(text) {
    var html = '';
    var m;
    RE_TOK.lastIndex = 0;
    while ((m = RE_TOK.exec(text))) {
      if (m[1] !== undefined) {
        // 字符串：后面跟冒号的是键名
        html += m[2]
          ? '<span class="jk">' + esc(m[1]) + '</span><span class="jp">' + esc(m[2]) + '</span>'
          : '<span class="jstr">' + esc(m[1]) + '</span>';
      } else if (m[3] !== undefined) {
        html += '<span class="jnum">' + esc(m[3]) + '</span>';
      } else if (m[4] !== undefined) {
        html += '<span class="jbool">' + esc(m[4]) + '</span>';
      } else if (m[5] !== undefined) {
        html += '<span class="jp">' + esc(m[5]) + '</span>';
      } else if (m[6] !== undefined) {
        html += '<span class="tok-comment">' + esc(m[6]) + '</span>';
      } else {
        html += esc(m[0]);
      }
    }
    return { code: html };
  }

  /* ------------------------------------------------ 表格视图 */
  function cellHtml(v) {
    if (v === null) return '<span class="jnull">null</span>';
    switch (typeof v) {
      case 'string': return '<span class="jstr">' + esc(v) + '</span>';
      case 'number': return '<span class="jnum">' + String(v) + '</span>';
      case 'boolean': return '<span class="jbool">' + String(v) + '</span>';
    }
    var s = JSON.stringify(v);
    if (s.length > 80) s = s.slice(0, 80) + '…';
    return '<span class="nested" title="' + esc(JSON.stringify(v)) + '">' + esc(s) + '</span>';
  }

  // 通用表格数据：返回 { headers, rows }，供 HTML / CSV / MD 共用
  function tableData(value) {
    var plain = function (v) {
      if (v === null) return 'null';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    };
    if (Array.isArray(value)) {
      var cols = [];
      var seen = {};
      value.forEach(function (item) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          Object.keys(item).forEach(function (k) {
            if (!seen[k]) { seen[k] = true; cols.push(k); }
          });
        }
      });
      var headers = cols.length ? cols : ['value'];
      var rows = value.map(function (item) {
        if (cols.length) {
          return headers.map(function (k) {
            var v = (item && typeof item === 'object' && !Array.isArray(item)) ? item[k] : undefined;
            return v === undefined ? '' : plain(v);
          });
        }
        return [plain(item)];
      });
      return { headers: headers, rows: rows };
    }
    if (value && typeof value === 'object') {
      return {
        headers: ['键', '值'],
        rows: Object.keys(value).map(function (k) { return [k, plain(value[k])]; })
      };
    }
    return { headers: ['值'], rows: [[plain(value)]] };
  }

  function buildTable(data) {
    var t = tableData(data);
    var html = '<table><thead><tr><th class="rownum">#</th>';
    t.headers.forEach(function (k) { html += '<th>' + esc(k) + '</th>'; });
    html += '</tr></thead><tbody>';
    t.rows.forEach(function (row, i) {
      html += '<tr><td class="rownum">' + (i + 1) + '</td>';
      row.forEach(function (cell) { html += '<td>' + esc(cell) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table>';
    var note = t.rows.length + ' 行 × ' + t.headers.length + ' 列';
    return { html: html, note: note, headers: t.headers, rows: t.rows };
  }

  /* CSV：逗号/引号/换行转义，带 BOM 方便 Excel 打开中文 */
  function csvCell(s) {
    if (/[,"\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCsv(t) {
    var lines = [t.headers.map(csvCell).join(',')];
    t.rows.forEach(function (row) {
      lines.push(row.map(csvCell).join(','));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }
  function toMd(t) {
    var md = '| # | ' + t.headers.map(function (h) {
      return String(h).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    }).join(' | ') + ' |\n';
    md += '| - ' + t.headers.map(function () { return '| - '; }).join('') + '|\n';
    t.rows.forEach(function (row, i) {
      md += '| ' + (i + 1) + ' | ' + row.map(function (c) {
        return String(c).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
      }).join(' | ') + ' |\n';
    });
    return md;
  }
  function downloadText(text, ext) {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    var name = 'table-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
      + '-' + p(d.getHours()) + p(d.getMinutes()) + '.' + ext;
    var mime = ext === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8';
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  var currentTable = null;

  function openTable() {
    if (!last.ok || data == null) { TB.toast('请先格式化出有效的 JSON'); return; }
    var r = buildTable(JC.toValue(data));
    currentTable = r;
    document.getElementById('tableOut').innerHTML = r.html;
    document.getElementById('tableNote').textContent = r.note;
    document.getElementById('tableModal').classList.remove('hidden');
  }
  function closeTable() {
    document.getElementById('tableModal').classList.add('hidden');
  }

  /* 剥离注释（// 与 /*），跳过字符串内部，避免误伤值里的双斜杠 */
  /* ------------------------------------------------ JSONC 解析
     支持行注释、块注释与尾随逗号；注释位置保留，供树形视图显示 */
  function stripJsonComments(src) {
    var r = JC.parse(src);
    return {
      text: r.ok ? '' : '',
      comments: r.comments,
      parsed: r,
      error: r.ok ? null : r.message,
      pos: r.pos
    };
  }

  /* ------------------------------------------------ 值的着色 */
  function valueHtml(v, raw) {
    if (v === null) return '<span class="jnull">null</span>';
    switch (typeof v) {
      case 'string': return '<span class="jstr">' + esc(raw !== undefined && raw !== null ? raw : JSON.stringify(v)) + '</span>';
      case 'number': return '<span class="jnum">' + esc(raw !== undefined && raw !== null ? raw : String(v)) + '</span>';
      case 'boolean': return '<span class="jbool">' + String(v) + '</span>';
      default: return esc(String(v));
    }
  }

  /* ------------------------------------------------ JSON Schema 识别
     识别后：关键字高亮 + 规范化排序 + 摘要提示 */
  var SCHEMA_KEYWORDS = [
    '$schema', '$id', '$ref', '$defs', 'definitions', '$comment',
    'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
    'type', 'format', 'enum', 'const',
    'required', 'properties', 'patternProperties', 'additionalProperties', 'propertyNames',
    'items', 'prefixItems', 'contains', 'minItems', 'maxItems', 'uniqueItems',
    'minLength', 'maxLength', 'pattern', 'minimum', 'maximum',
    'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
    'nullable', 'discriminator', 'xml', 'externalDocs'
  ];
  var SCHEMA_KEYWORD_SET = {};
  SCHEMA_KEYWORDS.forEach(function (k) { SCHEMA_KEYWORD_SET[k] = true; });

  function isSchemaNode(node) {
    if (!node || node.type !== 'object') return false;
    var keys = node.items.map(function (it) { return it.key; });
    if (keys.indexOf('$schema') >= 0) return true;
    if (keys.indexOf('properties') >= 0 && keys.indexOf('type') >= 0) return true;
    if (keys.indexOf('$defs') >= 0 || keys.indexOf('definitions') >= 0) return true;
    if (keys.indexOf('oneOf') >= 0 || keys.indexOf('anyOf') >= 0 || keys.indexOf('allOf') >= 0) return true;
    return false;
  }

  // Schema 关键字顺序（规范化排序用）
  var SCHEMA_ORDER = [
    '$schema', '$id', '$ref', '$defs', 'definitions', '$comment',
    'title', 'description', 'type', 'format', 'default', 'examples',
    'enum', 'const', 'required', 'properties', 'patternProperties',
    'additionalProperties', 'propertyNames', 'items', 'prefixItems', 'contains',
    'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern',
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'nullable',
    'readOnly', 'writeOnly', 'deprecated', 'discriminator', 'xml', 'externalDocs'
  ];
  var SCHEMA_ORDER_MAP = {};
  SCHEMA_ORDER.forEach(function (k, i) { SCHEMA_ORDER_MAP[k] = i; });

  function schemaSort(node) {
    if (!node || node.type !== 'object') return node;
    var items = node.items.slice();
    items.sort(function (a, b) {
      var ia = a.key in SCHEMA_ORDER_MAP ? SCHEMA_ORDER_MAP[a.key] : 999;
      var ib = b.key in SCHEMA_ORDER_MAP ? SCHEMA_ORDER_MAP[b.key] : 999;
      if (ia !== ib) return ia - ib;
      return String(a.key).localeCompare(String(b.key));
    });
    node.items = items.map(function (it) {
      return { key: it.key, node: schemaSort(it.node), lead: it.lead, trail: it.trail };
    });
    return node;
  }

  /* ------------------------------------------------ 树渲染（带注释 + 每级复制） */
  // 每个可复制节点登记到 copyMap：{ path: '$.a.b[0]', json: '...' }
  var copyMap = [];
  var schemaMode = false;

  function registerCopy(node, path) {
    var idx = copyMap.length;
    copyMap.push({ path: path, json: nodeJson(node) });
    return idx;
  }

  function nodeJson(node) {
    if (node.type === 'value') return node.raw !== null ? node.raw : JSON.stringify(node.value);
    return JC.toText(node, '  ');
  }

  function pathOf(parentPath, key, isArr) {
    if (isArr) return parentPath + '[' + key + ']';
    return parentPath + (parentPath === '$' ? '' : '.') + key;
  }

  function commentLines(comments, indent) {
    var h = '';
    (comments || []).forEach(function (c) {
      h += '<div class="jline jcmt"><span class="jln"></span><span class="jcode">'
        + indent + '<span class="jc' + (c.block ? ' jc-block' : '') + '">' + esc(c.text) + '</span>'
        + '</span></div>';
    });
    return h;
  }

  function copyBtn(idx) {
    return '<button class="jcopy" data-cp="' + idx + '" title="复制此节点 JSON" aria-label="复制此节点 JSON">⧉</button>';
  }

  // 生成一行：<缩进><开关>键: 值[,]
  function primLine(indent, key, node, comma, toggle, nodeClass, path, copyIdx) {
    var h = '<div class="jline' + (nodeClass ? ' ' + nodeClass : '') + '"'
      + (path ? ' data-path="' + esc(path) + '"' : '') + '>'
      + '<span class="jln"></span>'
      + '<span class="jcode">'
      + '<span class="jt' + (toggle ? '' : ' leaf') + '"' + (toggle ? ' data-toggle="1"' : '') + '></span>'
      + indent;
    if (key !== null) {
      h += '<span class="jk' + (schemaMode && SCHEMA_KEYWORD_SET[key] ? ' jsk' : '') + '">'
        + '"' + esc(key) + '"</span><span class="jp">: </span>';
    }
    h += valueHtml(node.value, node.raw);
    if (comma) h += '<span class="jp">,</span>';
    h += '</span>' + copyBtn(copyIdx) + '</div>';
    return h;
  }

  function containerLine(indent, key, openCh, comma, isEmpty, path, copyIdx) {
    var h = '<div class="jline"' + (path ? ' data-path="' + esc(path) + '"' : '') + '>'
      + '<span class="jln"></span>'
      + '<span class="jcode">'
      + '<span class="jt' + (isEmpty ? ' leaf' : '') + '"' + (isEmpty ? '' : ' data-toggle="1"') + '></span>'
      + indent;
    if (key !== null) h += '<span class="jk' + (schemaMode && SCHEMA_KEYWORD_SET[key] ? ' jsk' : '') + '">'
      + '"' + esc(key) + '"</span><span class="jp">: </span>';
    h += '<span class="jp jclick"' + (isEmpty ? '' : ' data-toggle="1"') + '>' + openCh + '</span>';
    h += '</span>' + copyBtn(copyIdx) + '</div>';
    return h;
  }

  function commentLineWithIndent(comments, indent) {
    var h = '';
    (comments || []).forEach(function (c) {
      h += '<div class="jline jcmt"><span class="jln"></span><span class="jcode">'
        + indent + '<span class="jc' + (c.block ? ' jc-block' : '') + '">' + esc(c.text) + '</span>'
        + '</span></div>';
    });
    return h;
  }

  function commentLineWithIndent(comments, indent) {
    var h = '';
    (comments || []).forEach(function (c) {
      h += '<div class="jline jcmt"><span class="jln"></span><span class="jcode">'
        + indent + '<span class="jc' + (c.block ? ' jc-block' : '') + '">' + esc(c.text) + '</span>'
        + '</span></div>';
    });
    return h;
  }

  function renderNode(node, key, depth, comma, pad, path, isArr) {
    var indent = pad.repeat(depth);
    var cmt = commentLines(node.lead, indent);

    if (node.type === 'value') {
      var ci = registerCopy(node, path);
      return cmt + primLine(indent, key, node, comma, false, '', path, ci);
    }

    var isArrNode = node.type === 'array';
    var open = isArrNode ? '[' : '{';
    var close = isArrNode ? ']' : '}';
    var h = cmt;

    if (!node.items.length) {
      var ci0 = registerCopy(node, path);
      var one = indent + (key !== null ? '"' + esc(key) + '": ' : '') + open + close + (comma ? ',' : '');
      return h + '<div class="jline"' + (path ? ' data-path="' + esc(path) + '"' : '') + '>'
        + '<span class="jln"></span><span class="jcode">'
        + '<span class="jt leaf"></span>' + one + '</span>' + copyBtn(ci0) + '</div>';
    }

    var cIdx = registerCopy(node, path);
    h += '<div class="jnode" style="--d:' + depth + '">';
    h += containerLine(indent, key, open, comma, false, path, cIdx);
    h += '<div class="jchildren">';
    node.items.forEach(function (it, i) {
      var childPath = isArrNode ? pathOf(path, i, true) : pathOf(path, it.key, false);
      var line = commentLines(it.lead, indent + pad)
        + renderNode(it.node, it.key, depth + 1, i < node.items.length - 1, pad, childPath, isArrNode);
      (it.trail || []).forEach(function (c) {
        line = line.replace(/<\/div>$/, '<span class="jc jc-trail">' + esc(c.text) + '</span></div>');
      });
      h += line;
    });
    h += '</div>';
    h += commentLineWithIndent(node.close, indent);
    h += '<div class="jdots">'
      + '<div class="jline"><span class="jln"></span><span class="jcode">'
      + indent + pad + '<span class="jsummary">… ' + node.items.length + ' 项</span>'
      + '</span></div></div>';
    h += '<div class="jline jclose"><span class="jln"></span><span class="jcode">'
      + '<span class="jt leaf"></span>' + indent
      + '<span class="jp">' + close + (comma ? ',' : '') + '</span></span></div>';
    h += '</div>';
    return h;
  }

  /* ------------------------------------------------ 渲染主流程 */
  function renderTree() {
    if (!data) return;
    var pad = opts.indent === 'tab' ? '\t' : (opts.indent === '4' ? '    ' : '  ');
    copyMap = [];
    schemaMode = isSchemaNode(data);
    el.out.innerHTML = renderNode(data, null, 0, false, pad, '$', false);
    el.out.insertAdjacentHTML('beforeend', commentLineWithIndent(data.after, ''));

    var lines = countLines(data, pad);
    el.stats.textContent = lines + ' 行 · ' + last.text.length + ' 字符';
    if (schemaMode) {
      el.outTitle.textContent = (opts.mode === 'compress' ? '压缩结果' : '格式化结果') + ' · JSON Schema';
    }
  }

  function countLines(v, pad) {
    // 展开状态下的行数 = JSON.stringify 的行数
    return last.text ? last.text.split('\n').length : 1;
  }

  /* 把浏览器原始报错翻译成友好提示，并计算行号/列号 */
  function friendlyError(errMsg, src) {
    var line = 0, col = 0;
    var pm = /position (\d+)/i.exec(errMsg);
    if (pm && src) {
      var pos = Math.min(+pm[1], src.length);
      var before = src.slice(0, pos);
      line = before.split('\n').length;
      col = pos - before.lastIndexOf('\n');
    }
    var tip;
    var s = errMsg;
    if (/Unexpected end of JSON input/i.test(s)) {
      tip = 'JSON 不完整：可能缺少结尾的 } 或 ]，或字符串引号没有闭合';
    } else if (/尾随逗号|多余的逗号/.test(s)) {
      tip = s;
    } else if (/Expected property name/i.test(s)) {
      tip = '键名必须用英文双引号包裹（如 "name"），不能单引号或不加引号；也检查上一行末尾是否多了逗号';
    } else if (/Expected double-quoted/i.test(s)) {
      tip = '键名必须用英文双引号包裹';
    } else if (/Expected ',' or '\}'/i.test(s)) {
      tip = '对象里可能少了逗号，或 } 没有闭合；也检查是否用了中文逗号';
    } else if (/Expected ',' or '\]'/i.test(s)) {
      tip = '数组里可能少了逗号，或 ] 没有闭合；也检查是否用了中文逗号';
    } else if (/non-whitespace/i.test(s)) {
      tip = 'JSON 已经结束，但后面还有多余的内容：检查是否多了字符或多了 ] }';
    } else if (/Unexpected token/i.test(s)) {
      var tok = /Unexpected token (.+?)[ ,]/i.exec(s);
      tip = '出现意外的字符' + (tok ? '「' + tok[1] + '」' : '')
        + '：检查上一行是否少了逗号、字符串是否用了单引号或中文引号';
    } else if (/No number after minus/i.test(s)) {
      tip = '负号 - 后面必须是数字';
    } else if (/Bad escaped/i.test(s)) {
      tip = '字符串里的反斜杠 \\ 使用不正确（如想表示 \\ 本身要写 \\\\ ）';
    } else if (/Bad control/i.test(s)) {
      tip = '字符串里包含了不允许的换行/控制字符，请改用 \\n 转义';
    } else {
      tip = s;
    }
    var loc = line ? '第 ' + line + ' 行第 ' + col + ' 列附近：' : '';
    return loc + tip;
  }

  function showError(msg) {
    data = null;
    copyMap = [];
    el.out.innerHTML = '<div class="empty error"><strong>JSON 无法解析</strong>'
      + '<span style="white-space:normal;line-height:1.8;max-width:26em">' + esc(msg) + '</span></div>';
    el.stats.textContent = '';
    el.outTitle.textContent = '解析失败';
    last = { text: '', ok: false };
  }

  function indentation() {
    return opts.indent === 'tab' ? '\t' : parseInt(opts.indent, 10) || 2;
  }

  function sortDeep(v) {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).sort(function (a, b) { return a.localeCompare(b); })
        .forEach(function (k) { out[k] = sortDeep(v[k]); });
      return out;
    }
    return v;
  }

  function parseInput() {
    var src = el.input.value.trim();
    if (!src) return { empty: true };
    var r = JC.parse(src);
    if (!r.ok) return { error: r.error, pos: r.pos, comments: r.comments };
    var root = r.root;

    if (opts.keepEsc) {
      // 保留 \uXXXX 转义：把字符串节点里的 \uXXXX 还原成字面量文本
      walkEsc(root);
    }

    if (opts.sort === 'asc') root = sortNode(root);
    else if (opts.sort === 'schema' && isSchemaNode(root)) root = schemaSort(root);

    return { root: root, data: JC.toValue(root), comments: r.comments };
  }

  // keepEsc：把字符串中的 \uXXXX 还原成可见的字面量
  function walkEsc(node) {
    if (node.type === 'value') {
      if (typeof node.value === 'string' && node.raw) {
        var m = /"((?:[^"\\]|\\.)*)"/.exec(node.raw);
        if (m) {
          var inner = m[1].replace(/\\u([0-9a-fA-F]{4})/g, '\\\\u$1');
          node.raw = '"' + inner + '"';
          node.value = inner.replace(/\\\\u([0-9a-fA-F]{4})/g, '\\u$1');
        }
      }
      return;
    }
    node.items.forEach(function (it) { walkEsc(it.node); });
  }

  // 键名字母升序（按节点树排序，保留注释归属）
  function sortNode(node) {
    if (node.type !== 'object') {
      if (node.type === 'array') {
        node.items = node.items.map(function (it) {
          return { key: it.key, node: sortNode(it.node), lead: it.lead, trail: it.trail };
        });
      }
      return node;
    }
    var items = node.items.slice().sort(function (a, b) {
      return String(a.key).localeCompare(String(b.key));
    });
    node.items = items.map(function (it) {
      return { key: it.key, node: sortNode(it.node), lead: it.lead, trail: it.trail };
    });
    return node;
  }

  function run() {
    var trimmed = el.input.value.trim();

    el.warn.textContent = '';
    el.warn.classList.remove('show');

    if (!trimmed) {
      el.out.innerHTML = '<div class="empty"><strong>格式化结果会显示在这里</strong>'
        + '<span>粘贴 JSON，按 <kbd data-kbd>⌘⏎</kbd> 立即排版</span></div>';
      el.stats.textContent = '';
      el.outTitle.textContent = '格式化结果';
      data = null; last = { text: '', ok: false };
      copyMap = [];
      return;
    }

    var res = parseInput();
    if (res.error) {
      var friendly = friendlyError(res.error, el.input.value);
      el.warn.textContent = '⚠ ' + friendly;
      el.warn.classList.add('show');
      showError(friendly);
      return;
    }

    data = res.root;                       // 节点树（渲染用）
    var pad = opts.indent === 'tab' ? '\t' : (opts.indent === '4' ? '    ' : '  ');
    last.text = opts.mode === 'compress'
      ? JSON.stringify(JC.toValue(data))
      : JC.toText(data, pad);
    if (opts.mode === 'pretty') last.comments = JC.countComments(data);
    last.ok = true;
    el.outTitle.textContent = opts.mode === 'compress' ? '压缩结果' : '格式化结果';
    if (opts.mode === 'compress') {
      // 压缩模式：直接显示压缩后的单行文本，不走折叠树
      el.out.innerHTML = '<div class="line"><span class="ln">1</span>'
        + '<span class="code">' + rawHighlight(last.text).code + '</span></div>';
      el.stats.textContent = '1 行 · ' + last.text.length + ' 字符';
      copyMap = [];
    } else {
      renderTree();
    }
    if (res.comments > 0) {
      el.warn.textContent = opts.mode === 'compress'
        ? 'ℹ 已识别 ' + res.comments + ' 段注释；压缩结果为纯 JSON，不含注释'
        : 'ℹ 已识别并显示 ' + res.comments + ' 段注释（行注释 / 块注释）；复制与下载的结果为纯 JSON，不含注释';
      el.warn.classList.add('show');
    }
  }

  var runSoon = TB.debounce(run, 180);

  /* ------------------------------------------------ 折叠交互 */
  el.out.addEventListener('click', function (e) {
    // 复制按钮优先处理
    var cp = e.target.closest('.jcopy');
    if (cp) {
      var idx = parseInt(cp.getAttribute('data-cp'), 10);
      var item = copyMap[idx];
      if (item) {
        TB.copyWithToast(item.json, '节点 JSON');
        TB.toast('已复制 ' + item.path + ' 节点');
      }
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    var t = e.target.closest('.jt, .jclick');
    if (!t || t.classList.contains('leaf')) return;
    var node = t.closest('.jnode');
    if (node) node.classList.toggle('collapsed');
    e.stopPropagation();
  });

  function setAll(collapse) {
    Array.prototype.forEach.call(el.out.querySelectorAll('.jnode'), function (n) {
      n.classList.toggle('collapsed', collapse);
    });
    updateToggleLabel();
  }

  // 展开/折叠合并为一个智能切换按钮：有折叠就全部展开，否则全部折叠
  function updateToggleLabel() {
    var anyCollapsed = !!el.out.querySelector('.jnode.collapsed');
    document.getElementById('toggleBtn').textContent = anyCollapsed ? '全部展开' : '全部折叠';
  }

  document.getElementById('toggleBtn').addEventListener('click', function () {
    // 压缩模式下先回到格式化（树形）视图
    if (opts.mode !== 'pretty') {
      opts.mode = 'pretty';
      TB.syncSeg(el.segMode, 'pretty');
      run();
      updateToggleLabel();
      TB.toast('已切换到格式化视图');
      return;
    }
    var anyCollapsed = !!el.out.querySelector('.jnode.collapsed');
    setAll(!anyCollapsed);
  });

  /* ------------------------------------------------ 分段控件 */
  TB.bindSeg(el.segMode, opts.mode, function (v) {
    opts.mode = v;
    run();
    TB.toast(v === 'compress' ? '已压缩为单行' : '已切换到格式化');
  });
  TB.bindSeg(el.segIndent, opts.indent, function (v) {
    opts.indent = v; opts.mode = 'pretty'; TB.syncSeg(el.segMode, 'pretty'); run();
  });
  TB.bindSeg(el.segSort, opts.sort, function (v) {
    opts.sort = v; run();
    if (v === 'schema') TB.toast('已按 JSON Schema 关键字顺序规范化');
  });

  // 保留转义开关（记忆偏好）
  var ESC_KEY = 'devtoolbox.json.keepesc.v1';
  try { opts.keepEsc = localStorage.getItem(ESC_KEY) === '1'; } catch (e) {}
  el.keepEsc.checked = opts.keepEsc;
  el.keepEsc.addEventListener('change', function () {
    opts.keepEsc = el.keepEsc.checked;
    try { localStorage.setItem(ESC_KEY, opts.keepEsc ? '1' : '0'); } catch (e) {}
    run();
  });

  /* ------------------------------------------------ 按钮 */
  document.getElementById('sampleBtn').addEventListener('click', function () {
    opts.mode = 'pretty';
    TB.syncSeg(el.segMode, 'pretty');
    el.input.value = SAMPLE;
    run();
    el.input.focus();
  });

  document.getElementById('copyBtn').addEventListener('click', function () {
    if (!last.ok) { TB.toast('还没有可复制的结果'); return; }
    TB.copyWithToast(last.text, last.text.indexOf('\n') === -1 ? '压缩后的 JSON' : '格式化后的 JSON');
  });

  document.getElementById('downloadBtn').addEventListener('click', function () {
    if (!last.ok) { TB.toast('还没有可下载的结果'); return; }
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    var name = 'data-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
      + '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
    var blob = new Blob([last.text + '\n'], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    TB.toast('已下载 .json 文件');
  });

  /* ------------------------------------------------ 交互细节 */
  TB.bindRunKey(run);
  TB.enableTabIndent(el.input, 2);

  el.input.addEventListener('input', runSoon);
  el.input.addEventListener('paste', function () { setTimeout(run, 0); });

  /* ------------------------------------------------ 表格视图事件 */
  document.getElementById('tableBtn').addEventListener('click', openTable);
  document.getElementById('tableCloseBtn').addEventListener('click', closeTable);
  document.getElementById('csvBtn').addEventListener('click', function () {
    if (!currentTable) { TB.toast('没有表格数据'); return; }
    downloadText(toCsv(currentTable), 'csv');
    TB.toast('已下载 CSV（带 BOM，Excel 可直接打开）');
  });
  document.getElementById('mdBtn').addEventListener('click', function () {
    if (!currentTable) { TB.toast('没有表格数据'); return; }
    downloadText(toMd(currentTable), 'md');
    TB.toast('已下载 Markdown 表格');
  });
  document.getElementById('tableModal').addEventListener('click', function (e) {
    if (e.target === this) closeTable();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeTable();
  });

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

  /* ------------------------------------------------ 全屏 */
  TB.bindFullscreenButton(document.getElementById('fullBtn'));

  /* ------------------------------------------------ 启动 */
  el.input.value = SAMPLE;
  run();
  // 光标定位到文本末尾
  el.input.setSelectionRange(el.input.value.length, el.input.value.length);
})();
