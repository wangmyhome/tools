(function () {
  'use strict';

  var SAMPLE = [
    '# Markdown 示例',
    '',
    '支持 **加粗**、*斜体*、~~删除线~~、`行内代码`，以及 [超链接](https://example.com)。',
    '',
    '## 列表',
    '',
    '- 无序列表项',
    '  - 嵌套项',
    '  - 又一个',
    '- [x] 已完成的任务',
    '- [ ] 待办的任务',
    '',
    '## 表格',
    '',
    '| 工具 | 用途 | 快捷键 |',
    '| --- | --- | --- |',
    '| JSON | 格式化 | ⌘⏎ |',
    '| SQL | 排版 | ⌘⏎ |',
    '| Diff | 对比 | ⌘⏎ |',
    '',
    '## 代码',
    '',
    '```js',
    'function greet(name) {',
    '  return `你好，${name}`;',
    '}',
    '```',
    '',
    '> 引用：内容只保存在浏览器本地，不会上传。',
    '',
    '---',
    '',
    '1. 有序列表第一项',
    '2. 第二项'
  ].join('\n');

  var STORE_KEY = 'devtoolbox.md.draft.v1';

  var el = {
    editor: document.getElementById('editor'),
    preview: document.getElementById('preview'),
    statsMd: document.getElementById('statsMd'),
    statsHtml: document.getElementById('statsHtml'),
    editPane: document.getElementById('editPane'),
    previewPane: document.getElementById('previewPane'),
    segView: document.getElementById('segView'),
    segBreak: document.getElementById('segBreak'),
    tocBtn: document.getElementById('tocBtn'),
    outline: document.getElementById('outline'),
    outlineList: document.getElementById('outlineList'),
    outlineClose: document.getElementById('outlineClose')
  };

  var opts = { view: 'both', breaks: false };

  window.marked.setOptions({ gfm: true, breaks: opts.breaks });

  function saveDraft() {
    try { localStorage.setItem(STORE_KEY, el.editor.value); } catch (e) {}
  }

  /* ================================================================
     一、渲染（Markdown → HTML）
     ================================================================ */
  function updateStats() {
    var src = el.editor.value;
    var lines = src ? src.split('\n').length : 0;
    var chars = src.replace(/\s/g, '').length;
    el.statsMd.textContent = lines + ' 行 · ' + chars + ' 字';
    el.statsHtml.textContent = el.preview.querySelectorAll('*').length + ' 个元素';
  }

  var previewDirty = false;

  function render() {
    el.preview.innerHTML = window.marked.parse(el.editor.value);
    previewDirty = false;
    updateStats();
    buildToc();
  }

  var renderSoon = TB.debounce(function () {
    render();
    saveDraft();
  }, 220);

  el.editor.addEventListener('input', renderSoon);

  /* ================================================================
     二、预览可直接编辑（Typora 式）：DOM → Markdown 回写
     ================================================================ */
  var IND = '  ';

  function pad(indent) {
    var s = '';
    for (var i = 0; i < indent; i++) s += IND;
    return s;
  }

  function inlineMd(node) {
    var out = '';
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toLowerCase();

      if (tag === 'br') { out += '  \n'; return; }
      if (tag === 'input') return;   // 任务列表勾选框

      var inner = inlineMd(n);
      if (tag === 'strong' || tag === 'b') out += '**' + inner + '**';
      else if (tag === 'em' || tag === 'i') out += '*' + inner + '*';
      else if (tag === 'del' || tag === 's' || tag === 'strike') out += '~~' + inner + '~~';
      else if (tag === 'code') out += '`' + inner + '`';
      else if (tag === 'a') out += '[' + inner + '](' + (n.getAttribute('href') || '') + ')';
      else if (tag === 'img') {
        out += '![' + (n.getAttribute('alt') || '') + '](' + (n.getAttribute('src') || '') + ')';
      } else if (tag === 'sup') out += '<sup>' + inner + '</sup>';
      else if (tag === 'sub') out += '<sub>' + inner + '</sub>';
      else out += inner;
    });
    return out;
  }

  function listMd(list, indent, out) {
    var ordered = list.tagName.toLowerCase() === 'ol';
    var start = parseInt(list.getAttribute('start') || '1', 10);
    if (isNaN(start)) start = 1;

    Array.prototype.forEach.call(list.children, function (li, i) {
      if (li.tagName.toLowerCase() !== 'li') return;

      var box = null, content = '', nested = [];
      Array.prototype.forEach.call(li.childNodes, function (cn) {
        if (cn.nodeType === 1) {
          var t = cn.tagName.toLowerCase();
          if (t === 'ul' || t === 'ol') { nested.push(cn); return; }
          if (t === 'input' && cn.type === 'checkbox') { box = cn; return; }
        }
        content += cn.nodeType === 3 ? cn.nodeValue : inlineMd(cn);
      });

      var marker = ordered ? (start + i) + '.' : '-';
      var line = pad(indent) + marker + ' ';
      if (box) line += (box.checked ? '[x] ' : '[ ] ');
      out.push(line + content.trim());

      nested.forEach(function (nl) { listMd(nl, indent + 1, out); });
    });
  }

  function tableMd(tableEl, out) {
    var rows = [];
    Array.prototype.forEach.call(tableEl.querySelectorAll('tr'), function (tr) {
      var cells = [];
      Array.prototype.forEach.call(tr.children, function (c) {
        cells.push(inlineMd(c).trim().replace(/\|/g, '\\|'));
      });
      if (cells.length) rows.push(cells);
    });
    if (!rows.length) return;

    var width = rows[0].length;
    out.push('| ' + rows[0].join(' | ') + ' |');
    var sep = [];
    for (var i = 0; i < width; i++) sep.push('---');
    out.push('| ' + sep.join(' | ') + ' |');
    for (var r = 1; r < rows.length; r++) {
      while (rows[r].length < width) rows[r].push('');
      out.push('| ' + rows[r].slice(0, width).join(' | ') + ' |');
    }
  }

  function blockMd(node, indent, out) {
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) {
        var t = n.nodeValue.trim();
        if (t) out.push(t);
        return;
      }
      if (n.nodeType !== 1) return;

      var tag = n.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        out.push(new Array(+tag.charAt(1) + 1).join('#') + ' ' + inlineMd(n).trim());
      } else if (tag === 'p') {
        out.push(inlineMd(n).trim());
      } else if (tag === 'div' || tag === 'section' || tag === 'article') {
        // contenteditable 插入的新行常是 div
        if (n.querySelector('ul,ol,table,pre,blockquote,h1,h2,h3,h4,h5,h6')) {
          blockMd(n, indent, out);
        } else {
          var t2 = inlineMd(n).trim();
          out.push(t2);
        }
      } else if (tag === 'ul' || tag === 'ol') {
        listMd(n, indent, out);
      } else if (tag === 'blockquote') {
        var sub = [];
        blockMd(n, 0, sub);
        out.push(sub.map(function (l) { return '> ' + l; }).join('\n'));
      } else if (tag === 'pre') {
        var codeEl = n.querySelector('code') || n;
        var cls = (codeEl.className || '');
        var langMatch = /language-([\w+-]+)/.exec(cls);
        out.push('```' + (langMatch ? langMatch[1] : ''));
        out.push(codeEl.textContent.replace(/\n$/, ''));
        out.push('```');
      } else if (tag === 'hr') {
        out.push('---');
      } else if (tag === 'table') {
        tableMd(n, out);
      } else if (tag === 'input') {
        // 忽略
      } else {
        var t3 = inlineMd(n).trim();
        if (t3) out.push(t3);
      }
    });
  }

  function domToMarkdown(root) {
    var out = [];
    blockMd(root, 0, out);
    // 压缩多余空行，保留段落间一个空行
    var text = out.join('\n\n');
    return text.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
  }

  /* 预览 DOM → Markdown 源码（同步执行，供按钮/切换视图前强制回写） */
  function flushPreviewEdits() {
    if (!previewDirty) return;
    var md = domToMarkdown(el.preview);
    if (md === el.editor.value) return;
    el.editor.value = md;
    previewDirty = false;
    saveDraft();
    updateStats();
  }

  var syncToSource = TB.debounce(function () {
    flushPreviewEdits();
    buildToc();
  }, 260);

  el.preview.addEventListener('input', function () {
    previewDirty = true;
    syncToSource();
  });

  el.preview.addEventListener('blur', function () {
    flushPreviewEdits();
    // 失焦后按源码重排一次，保证 Markdown 与渲染一致
    render();
  });

  /* 预览里的链接：点击不跳转，走新标签页 */
  el.preview.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    var href = a.getAttribute('href') || '';
    if (!/^https?:/i.test(href)) return;
    try {
      if (window.chrome && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: href });
        return;
      }
    } catch (err) {}
    window.open(href, '_blank');
  });

  /* ================================================================
     三、大纲目录
     ================================================================ */
  function tocOpen(on) {
    if (!el.outline) return;
    el.outline.classList.toggle('open', !!on);
    el.outline.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (el.tocBtn) el.tocBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function buildToc() {
    if (!el.outlineList) return;
    var heads = el.preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    var html = [];

    Array.prototype.forEach.call(heads, function (h, i) {
      var id = 'mdh-' + i;
      h.setAttribute('id', id);
      var lvl = Math.min(6, +h.tagName.charAt(1));
      var text = (h.textContent || '').trim() || '(无标题)';
      html.push(
        '<a class="outline-item" data-target="' + id + '" data-level="' + lvl + '"' +
        ' style="padding-left:' + (6 + (lvl - 1) * 9) + 'px">' +
        TB.escapeHtml(text) + '</a>'
      );
    });

    el.outlineList.innerHTML = html.length
      ? html.join('')
      : '<div class="outline-empty">还没有标题，用 # 添加</div>';

    Array.prototype.forEach.call(el.outlineList.querySelectorAll('.outline-item'), function (a) {
      a.addEventListener('click', function () {
        var id = a.getAttribute('data-target');
        var h = document.getElementById(id);
        if (!h) return;
        var delta = h.getBoundingClientRect().top - el.preview.getBoundingClientRect().top;
        el.preview.scrollTop = Math.max(0, el.preview.scrollTop + delta - 10);
        highlightToc();
      });
    });

    highlightToc();
  }

  function highlightToc() {
    if (!el.outlineList) return;
    var items = el.outlineList.querySelectorAll('.outline-item');
    if (!items.length) return;

    var headTop = el.preview.getBoundingClientRect().top;
    var activeId = null;

    Array.prototype.forEach.call(items, function (a) {
      var h = document.getElementById(a.getAttribute('data-target'));
      if (!h) return;
      if (h.getBoundingClientRect().top - headTop <= 24) activeId = a.getAttribute('data-target');
      a.classList.remove('active');
    });

    if (!activeId && items.length) activeId = items[0].getAttribute('data-target');
    if (activeId) {
      var cur = el.outlineList.querySelector('.outline-item[data-target="' + activeId + '"]');
      if (cur) cur.classList.add('active');
    }
  }

  if (el.tocBtn) {
    el.tocBtn.addEventListener('click', function () {
      tocOpen(!el.outline.classList.contains('open'));
    });
  }
  if (el.outlineClose) {
    el.outlineClose.addEventListener('click', function () { tocOpen(false); });
  }

  var hlTick = false;
  el.preview.addEventListener('scroll', function () {
    if (hlTick) return;
    hlTick = true;
    requestAnimationFrame(function () { hlTick = false; highlightToc(); });
  });

  /* ================================================================
     四、编辑 ↔ 预览 同步滚动
     ================================================================ */
  var syncing = false;

  function bindSync(src, dst) {
    src.addEventListener('scroll', function () {
      if (syncing || !dst) return;
      syncing = true;
      var srcMax = src.scrollHeight - src.clientHeight;
      var dstMax = dst.scrollHeight - dst.clientHeight;
      if (srcMax > 0 && dstMax > 0) {
        dst.scrollTop = (src.scrollTop / srcMax) * dstMax;
      }
      syncing = false;
    });
  }
  bindSync(el.editor, el.preview);
  bindSync(el.preview, el.editor);

  el.editor.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    var s = this.selectionStart;
    this.setRangeText('  ', s, this.selectionEnd, 'end');
    this.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* ================================================================
     五、视图
     ================================================================ */
  function applyView(v) {
    flushPreviewEdits();
    opts.view = v;
    el.editPane.style.display = v === 'preview' ? 'none' : '';
    el.previewPane.style.display = v === 'edit' ? 'none' : '';
    var b = document.body;
    b.classList.toggle('view-edit', v === 'edit');
    b.classList.toggle('view-preview', v === 'preview');
    b.classList.toggle('view-both', v === 'both');
    if (v === 'edit') tocOpen(false);
    render();
  }

  TB.bindSeg(el.segView, opts.view, applyView);
  TB.bindFullscreenButton(document.getElementById('fullBtn'));
  TB.bindSeg(el.segBreak, opts.breaks ? 'hard' : 'soft', function (v) {
    opts.breaks = (v === 'hard');
    window.marked.setOptions({ gfm: true, breaks: opts.breaks });
    render();
  });

  /* ================================================================
     六、按钮
     ================================================================ */
  document.getElementById('sampleBtn').addEventListener('click', function () {
    el.editor.value = SAMPLE;
    render(); saveDraft();
    TB.toast('已载入示例');
  });

  document.getElementById('clearBtn').addEventListener('click', function () {
    el.editor.value = '';
    render(); saveDraft();
    el.editor.focus();
  });

  document.getElementById('copyMdBtn').addEventListener('click', function () {
    render();
    flushPreviewEdits();
    TB.copyWithToast(el.editor.value, 'Markdown 源码');
  });

  document.getElementById('copyHtmlBtn').addEventListener('click', function () {
    TB.copyWithToast(el.preview.innerHTML, '渲染后的 HTML');
  });

  document.getElementById('downloadBtn').addEventListener('click', function () {
    flushPreviewEdits();
    var text = el.editor.value;
    if (!text.trim()) { TB.toast('还没有内容可下载'); return; }
    var firstLine = text.split('\n').find(function (l) { return l.trim(); }) || 'note';
    var name = firstLine.replace(/^#+\s*/, '').replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 40) || 'note';
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name + '.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    TB.toast('已下载 ' + name + '.md');
  });

  /* ================================================================
     七、启动
     ================================================================ */
  /* 支持从 URL hash 直接载入本地文件：
     #md=<urlencoded markdown>&name=<文件名> */
  var hashMd = null, hashName = '';
  var hm = /[#&]md=([^&]*)/.exec(location.hash || '');
  if (hm) {
    try { hashMd = decodeURIComponent(hm[1]); } catch (e) {}
    var nm = /[#&]name=([^&]*)/.exec(location.hash || '');
    if (nm) { try { hashName = decodeURIComponent(nm[1]); } catch (e2) {} }
  }

  var draft = null;
  try { draft = localStorage.getItem(STORE_KEY); } catch (e) {}
  el.editor.value = hashMd != null ? hashMd : (draft != null ? draft : SAMPLE);
  render();
  saveDraft();

  if (hashMd != null) {
    if (hashName) document.title = hashName + ' · Markdown 编辑预览 · DevToolbox';
    TB.toast('已载入' + (hashName ? ' ' + hashName : '本地 Markdown 文件'));
  }
})();
