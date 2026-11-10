/* JSONC 解析器（独立模块，供测试与页面复用） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JSONCParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function Node(type) {
    this.type = type;           // 'object' | 'array' | 'value'
    this.value = null;          // type==='value'
    this.raw = null;             // type==='value' 原始文本
    this.items = [];             // { key, node, lead: [], trail: [] }
    this.lead = [];              // 本节点之前的注释
    this.trail = [];             // 本节点之后的同行注释
    this.close = [];             // 闭括号附近的注释
    this.after = [];             // 根节点闭括号后的注释
  }

  function parse(src) {
    var i = 0, n = src.length, commentCount = 0, pending = [];
    var collectLine = 1;

    function isWs(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'; }
    function skipWs() { while (i < n && isWs(src[i])) i++; }

    function collect() {
      var out = [];
      for (;;) {
        var wsStart = i;
        while (i < n && isWs(src[i])) i++;
        collectLine += (src.slice(wsStart, i).match(/\n/g) || []).length;
        if (src[i] === '/' && src[i + 1] === '/') {
          var s = i;
          while (i < n && src[i] !== '\n') i++;
          out.push({ text: src.slice(s, i), block: false, end: i, line: collectLine });
          commentCount++;
        } else if (src[i] === '/' && src[i + 1] === '*') {
          var s2 = i;
          i += 2;
          while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
          var end = Math.min(n, i + 2);
          out.push({ text: src.slice(s2, end), block: true, end: i, line: collectLine });
          collectLine += (src.slice(s2, end).match(/\n/g) || []).length;
          commentCount++;
          i = end;
        } else {
          break;
        }
      }
      return out;
    }

    function lineAt(pos) {
      return (src.slice(0, pos).match(/\n/g) || []).length + 1;
    }

    function fail(msg, pos) {
      var e = new Error(msg);
      e.pos = (pos === undefined ? i : pos);
      throw e;
    }

    function parseString() {
      var start = i;
      if (src[i] !== '"') fail('键名必须用英文双引号包裹（如 "name"），不能单引号或不加引号');
      i++;
      while (i < n) {
        var c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '"') { i++; break; }
        if (c === '\n') fail('字符串未闭合：引号没有配对');
        i++;
      }
      var raw = src.slice(start, i);
      if (raw[raw.length - 1] !== '"' || raw.length < 2) fail('字符串未闭合：引号没有配对');
      try { return { value: JSON.parse(raw), raw: raw }; }
      catch (e2) { fail('字符串里的反斜杠 \\ 使用不正确'); }
    }

    function parseNumber() {
      var start = i;
      if (src[i] === '-') i++;
      while (i < n && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.') { i++; while (i < n && /[0-9]/.test(src[i])) i++; }
      if (src[i] === 'e' || src[i] === 'E') {
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        while (i < n && /[0-9]/.test(src[i])) i++;
      }
      var raw = src.slice(start, i);
      var v = Number(raw);
      if (raw === '' || isNaN(v)) fail('数字格式有误');
      return { value: v, raw: raw };
    }

    // 解析一个值；调用前 pending 里存着它前面的注释
    function parseValue() {
      skipWs();
      var c = src[i];
      var ownLead = pending;
      pending = [];
      var node;
      if (c === '{') node = parseObject();
      else if (c === '[') node = parseArray();
      else if (c === '"') { var ps = parseString(); node = new Node('value'); node.value = ps.value; node.raw = ps.raw; }
      else if (c === '-' || (c >= '0' && c <= '9')) { var pn = parseNumber(); node = new Node('value'); node.value = pn.value; node.raw = pn.raw; }
      else if (src.substr(i, 4) === 'true') { i += 4; node = new Node('value'); node.value = true; node.raw = 'true'; }
      else if (src.substr(i, 5) === 'false') { i += 5; node = new Node('value'); node.value = false; node.raw = 'false'; }
      else if (src.substr(i, 4) === 'null') { i += 4; node = new Node('value'); node.value = null; node.raw = 'null'; }
      else if (c === undefined) fail('内容意外结束：可能缺少结尾的 } 或 ]');
      else fail('出现意外的字符「' + c + '」：检查上一行是否少了逗号、字符串是否用了单引号或中文引号');
      node.lead = [];
      node.pre = ownLead;
      return node;
    }

    // 值之后：如果是同一行的注释 → 作为该节点的行尾注释
    // 读取当前位置的单个注释（不跳空白、不贪心收集）
    function readComment() {
      if (src[i] === '/' && src[i + 1] === '/') {
        var s = i;
        while (i < n && src[i] !== '\n') i++;
        commentCount++;
        return { text: src.slice(s, i), block: false };
      }
      if (src[i] === '/' && src[i + 1] === '*') {
        var s2 = i;
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        var end = Math.min(n, i + 2);
        commentCount++;
        i = end;
        return { text: src.slice(s2, end), block: true };
      }
      return null;
    }

    // 收集「同一行」的尾注释：fromPos 之后若没有换行则算同行
    function takeTrail(fromPos) {
      var save = i;
      while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
      var c = readComment();
      if (c) {
        var between = src.slice(fromPos, i);
        if (between.indexOf('\n') === -1) return c;   // 同行 → 尾注释
        i = save;                                        // 换行 → 不是尾注释
        return null;
      }
      i = save;
      return null;
    }

    function parseObject() {
      var node = new Node('object');
      i++; // {
      for (;;) {
        pending = pending.concat(collect());
        if (i >= n) fail('对象缺少结尾的 }');
        if (src[i] === '}') { node.close = pending; pending = []; i++; break; }

        var key = parseString();
        skipWs();
        if (src[i] !== ':') fail('键名后面缺少冒号 :');
        i++;
        skipWs();

        var child = parseValue();
        var valEnd = i;
        var item = { key: key.value, node: child, lead: child.pre, trail: [] };
        node.items.push(item);

        skipWs();
        if (src[i] === ',') {
          i++;
          item.trail = takeTrail(valEnd);  // 逗号之后的同行注释
          skipWs();
          pending = pending.concat(collect());
          if (item.trail) {
            var afterCommaLine = lineAt(i);
            var afterComma = pending.filter(function (c) { return c.line === afterCommaLine; });
            pending = pending.filter(function (c) { return c.line !== afterCommaLine; });
            item.trail = [item.trail].concat(afterComma);
          }
          if (i >= n) fail('对象缺少结尾的 }');
          if (src[i] === '}') fail('JSONC 允许注释，但不允许尾随逗号：请删除 } 前多余的逗号');
          continue;
        }
        item.trail = takeTrail(valEnd);
        skipWs();
        pending = pending.concat(collect());
        if (item.trail) {
          var trailingAfterLine = lineAt(i);
          var trailingAfter = pending.filter(function (c) { return c.line === trailingAfterLine; });
          pending = pending.filter(function (c) { return c.line !== trailingAfterLine; });
          item.trail = [item.trail].concat(trailingAfter);
        }
        if (src[i] === ',') fail('对象里有多余的逗号：闭括号 } 前不能有尾随逗号');
        if (src[i] === '}') { node.close = pending; pending = []; i++; break; }
        fail('对象里可能少了逗号，或 } 没有闭合；也检查是否用了中文逗号');
      }
      return node;
    }

    function parseArray() {
      var node = new Node('array');
      i++; // [
      for (;;) {
        pending = pending.concat(collect());
        if (i >= n) fail('数组缺少结尾的 ]');
        if (src[i] === ']') { node.close = pending; pending = []; i++; break; }

        var child = parseValue();
        var valEnd = i;
        var item = { key: null, node: child, lead: child.pre, trail: [] };
        node.items.push(item);

        skipWs();
        if (src[i] === ',') {
          i++;
          item.trail = takeTrail(valEnd);
          skipWs();
          pending = pending.concat(collect());
          if (item.trail) {
            var arrayAfterCommaLine = lineAt(i);
            var arrayAfterComma = pending.filter(function (c) { return c.line === arrayAfterCommaLine; });
            pending = pending.filter(function (c) { return c.line !== arrayAfterCommaLine; });
            item.trail = [item.trail].concat(arrayAfterComma);
          }
          if (i >= n) fail('数组缺少结尾的 ]');
          if (src[i] === ']') fail('JSONC 允许注释，但不允许尾随逗号：请删除 ] 前多余的逗号');
          continue;
        }
        item.trail = takeTrail(valEnd);
        skipWs();
        pending = pending.concat(collect());
        if (item.trail) {
          var arrayTrailingAfterLine = lineAt(i);
          var arrayTrailingAfter = pending.filter(function (c) { return c.line === arrayTrailingAfterLine; });
          pending = pending.filter(function (c) { return c.line !== arrayTrailingAfterLine; });
          item.trail = [item.trail].concat(arrayTrailingAfter);
        }
        if (src[i] === ',') fail('数组里有多余的逗号：闭括号 ] 前不能有尾随逗号');
        if (src[i] === ']') { node.close = pending; pending = []; i++; break; }
        fail('数组里可能少了逗号，或 ] 没有闭合；也检查是否用了中文逗号');
      }
      return node;
    }

    try {
      pending = pending.concat(collect());
      var root = parseValue();
      root.lead = root.pre || [];
      pending = pending.concat(collect());
      root.after = pending;
      pending = [];
      while (i < n && isWs(src[i])) i++;
      if (i < n) fail('JSON 已经结束，但后面还有多余的内容：检查是否多了字符或多了 ] }');
      return { ok: true, root: root, comments: commentCount };
    } catch (e) {
      return { ok: false, error: e.message, pos: e.pos === undefined ? i : e.pos, comments: commentCount };
    }
  }

  /* 节点树 → 普通值 */
  function toValue(node) {
    if (node.type === 'value') return node.value;
    if (node.type === 'array') return node.items.map(function (it) { return toValue(it.node); });
    var o = {};
    node.items.forEach(function (it) { o[it.key] = toValue(it.node); });
    return o;
  }

  /* 节点树 → JSON 文本（不含注释） */
  function toText(node, pad, level) {
    level = level || 0;
    if (node.type === 'value') return node.raw !== null ? node.raw : JSON.stringify(node.value);
    var open = node.type === 'array' ? '[' : '{';
    var close = node.type === 'array' ? ']' : '}';
    if (!node.items.length) return open + close;
    var ind = pad.repeat(level + 1);
    var parts = node.items.map(function (it) {
      var keyPart = it.key !== null && it.key !== undefined ? JSON.stringify(it.key) + ': ' : '';
      return ind + keyPart + toText(it.node, pad, level + 1);
    });
    return open + '\n' + parts.join(',\n') + '\n' + pad.repeat(level) + close;
  }

  /* 节点树 → 带注释的 JSON 文本（JSONC 输出） */
  function toTextWithComments(node, pad, level, skipLead) {
    level = level || 0;
    var out = '';
    if (!skipLead) {
      (node.lead || []).forEach(function (c) {
        out += (level ? pad.repeat(level) : '') + c.text + '\n';
      });
    }
    if (node.type === 'value') {
      out += node.raw !== null ? node.raw : JSON.stringify(node.value);
      (node.trail || []).forEach(function (c) { out += ' ' + c.text; });
      return out;
    }
    var open = node.type === 'array' ? '[' : '{';
    var close = node.type === 'array' ? ']' : '}';
    if (!node.items.length) {
      out += open + close;
      (node.trail || []).forEach(function (c) { out += ' ' + c.text; });
      return out;
    }
    out += open + '\n';
    node.items.forEach(function (it, idx) {
      var ind = pad.repeat(level + 1);
      (it.lead || []).forEach(function (c) { out += ind + c.text + '\n'; });
      if (it.key !== null && it.key !== undefined) out += ind + JSON.stringify(it.key) + ': ';
      out += toTextWithComments(it.node, pad, level + 1, true);
      if (idx < node.items.length - 1) out += ',';
      (it.trail || []).forEach(function (c) { out += ' ' + c.text; });
      out += '\n';
    });
    out += pad.repeat(level) + close;
    (node.trail || []).forEach(function (c) { out += ' ' + c.text; });
    return out;
  }

  /* 统计注释数（用于提示） */
  function countComments(node) {
    var c = (node.lead || []).length + (node.trail || []).length;
    c += (node.close || []).length;
    c += (node.after || []).length;
    node.items.forEach(function (it) {
      c += (it.lead || []).length + (it.trail || []).length + countComments(it.node);
    });
    return c;
  }

  return {
    parse: parse,
    toValue: toValue,
    toText: toText,
    toTextWithComments: toTextWithComments,
    countComments: countComments
  };
});
