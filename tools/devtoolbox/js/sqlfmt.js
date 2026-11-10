/*
 * SQL 格式化 + 语法着色引擎
 * 纯前端、零依赖：先分词，再把 token 流排版成带颜色标记的行，
 * 排版和着色共用同一份 token，保证「颜色和文字永远对得上」。
 */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- 词表 */

  // 会被合并成一个 token 的多词关键字（按词数从多到少匹配）
  var PHRASES = [
    'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN', 'NATURAL LEFT JOIN',
    'NATURAL RIGHT JOIN', 'NATURAL JOIN', 'CROSS JOIN', 'INNER JOIN', 'LEFT JOIN',
    'RIGHT JOIN', 'FULL JOIN', 'OUTER JOIN', 'LEFT SEMI JOIN', 'LEFT ANTI JOIN',
    'GROUP BY', 'ORDER BY', 'CLUSTER BY', 'DISTRIBUTE BY', 'SORT BY',
    'PARTITION BY', 'INSERT INTO', 'DELETE FROM', 'UNION ALL',
    'IS NOT NULL', 'IS NULL', 'NOT NULL', 'NOT IN', 'NOT LIKE', 'NOT BETWEEN', 'NOT EXISTS',
    'PRIMARY KEY', 'FOREIGN KEY', 'IF NOT EXISTS', 'IF EXISTS', 'ON CONFLICT',
    'DO NOTHING', 'DO UPDATE', 'ON DUPLICATE KEY UPDATE',
    'UNBOUNDED PRECEDING', 'UNBOUNDED FOLLOWING', 'CURRENT ROW', 'ROWS BETWEEN', 'RANGE BETWEEN',
    'CREATE TABLE', 'CREATE VIEW', 'CREATE INDEX', 'CREATE OR REPLACE', 'CREATE UNIQUE INDEX',
    'CREATE EXTERNAL TABLE', 'ALTER TABLE', 'DROP TABLE', 'DROP VIEW', 'DROP INDEX',
    'INSERT OVERWRITE TABLE', 'INSERT OVERWRITE', 'INSERT OVERWRITE DIRECTORY',
    'FETCH NEXT', 'DISTINCT ON', 'SIMILAR TO', 'DOUBLE PRECISION', 'CHARACTER SET',
    'ROW FORMAT', 'STORED AS', 'LATERAL VIEW', 'WITH ORDINALITY'
  ];

  var STATEMENT_START = new Set([
    'SELECT', 'WITH', 'INSERT', 'INSERT INTO', 'INSERT OVERWRITE', 'INSERT OVERWRITE TABLE',
    'INSERT OVERWRITE DIRECTORY', 'UPDATE', 'DELETE', 'DELETE FROM',
    'CREATE', 'CREATE TABLE', 'CREATE EXTERNAL TABLE', 'CREATE VIEW', 'CREATE INDEX',
    'CREATE UNIQUE INDEX', 'CREATE OR REPLACE', 'ALTER', 'ALTER TABLE', 'DROP', 'DROP TABLE',
    'DROP VIEW', 'DROP INDEX', 'TRUNCATE', 'EXPLAIN', 'ANALYZE', 'MERGE', 'REPLACE INTO', 'VALUES'
  ]);

  var CLAUSE = new Set([
    'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'WINDOW',
    'RETURNING', 'SET', 'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT', 'MINUS',
    'ON CONFLICT', 'INTO', 'CLUSTER BY', 'DISTRIBUTE BY', 'SORT BY'
  ]);

  var JOINS = new Set([
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'LEFT OUTER JOIN', 'RIGHT JOIN', 'RIGHT OUTER JOIN',
    'FULL JOIN', 'FULL OUTER JOIN', 'CROSS JOIN', 'OUTER JOIN', 'NATURAL JOIN',
    'LEFT SEMI JOIN', 'LEFT ANTI JOIN'
  ]);

  var KEYWORDS = new Set(PHRASES.concat([
    'SELECT', 'FROM', 'WHERE', 'HAVING', 'LIMIT', 'OFFSET', 'WINDOW', 'RETURNING', 'SET',
    'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT', 'MINUS',
    'VALUES', 'INTO', 'JOIN', 'INNER', 'OUTER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL',
    'ON', 'USING', 'AND', 'OR', 'NOT', 'IN', 'IS', 'LIKE', 'ILIKE', 'RLIKE', 'REGEXP',
    'GLOB', 'BETWEEN', 'EXISTS', 'ANY', 'SOME', 'ALL', 'DISTINCT',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AS', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
    'WITH', 'RECURSIVE', 'INSERT', 'OVERWRITE', 'UPDATE', 'DELETE', 'CREATE', 'ALTER',
    'DROP', 'TRUNCATE', 'REPLACE', 'MERGE', 'MATCHED', 'TABLE', 'VIEW', 'INDEX', 'REFERENCES',
    'DEFAULT', 'CONSTRAINT', 'UNIQUE', 'CHECK', 'CASCADE', 'RESTRICT', 'AUTOINCREMENT', 'IDENTITY',
    'PARTITION', 'OVER', 'ROWS', 'RANGE', 'GROUPS', 'PRECEDING', 'FOLLOWING', 'UNBOUNDED',
    'CURRENT', 'ROW', 'FILTER', 'WITHIN', 'GROUP', 'INTERVAL', 'TOP', 'FETCH',
    'NEXT', 'ONLY', 'GRANT', 'REVOKE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'START', 'TRANSACTION',
    'EXPLAIN', 'ANALYZE', 'EXTENDED', 'LATERAL', 'COLLATE', 'ESCAPE', 'AGAINST', 'MOD', 'DIV',
    'IGNORE', 'FORCE', 'FOR', 'OF', 'TO', 'BY', 'BLOCK', 'NULLS',
    'LOCATION', 'TBLPROPERTIES', 'COMMENT', 'STORED', 'FORMAT', 'DELIMITED', 'FIELDS',
    'TERMINATED', 'COLLECTION', 'ITEMS', 'MAPKEYS', 'LINES', 'EXTERNAL', 'CACHED', 'UNCACHED',
    'REFRESH', 'DESCRIBE', 'SHOW', 'USE', 'ADD', 'REPLACE', 'COLUMNS', 'RENAME'
  ]));

  var CONSTANTS = new Set(['TRUE', 'FALSE', 'NULL', 'UNKNOWN']);

  var TYPES = new Set([
    'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT', 'SERIAL', 'BIGSERIAL',
    'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL', 'MONEY', 'NUMBER',
    'VARCHAR', 'NVARCHAR', 'VARCHAR2', 'CHAR', 'NCHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT',
    'LONGTEXT', 'BLOB', 'CLOB', 'BYTEA', 'DATE', 'TIME', 'DATETIME', 'TIMESTAMP',
    'TIMESTAMPTZ', 'BOOLEAN', 'BOOL', 'BIT', 'JSON', 'JSONB', 'UUID', 'ARRAY', 'ENUM',
    'GEOMETRY', 'POINT', 'PRECISION', 'STRING', 'MAP', 'STRUCT'
  ]);

  var TABLE_CTX = new Set([
    'INSERT INTO', 'INSERT OVERWRITE', 'INSERT OVERWRITE TABLE', 'INSERT OVERWRITE DIRECTORY',
    'INTO', 'OVERWRITE', 'TABLE', 'CREATE TABLE', 'CREATE EXTERNAL TABLE', 'CREATE VIEW',
    'ALTER TABLE', 'REFERENCES', 'FROM', 'JOIN', 'UPDATE', 'DELETE FROM', 'VIEW', 'INDEX',
    'CREATE INDEX', 'CREATE UNIQUE INDEX', 'DROP TABLE', 'TRUNCATE'
  ]);

  var PUNCT = '(),;.';
  var OPS3 = ['->>'];
  var OPS2 = ['<>', '<=', '>=', '!=', '||', '::', ':=', '=>', '->'];

  /* ---------------------------------------------------------------- 分词 */

  var RE_WORD_CHAR = /[A-Za-z0-9_\u0080-￿@#]/;
  var RE_WORD_START = /[A-Za-z_\u0080-￿@#]/;
  var RE_DIGIT = /[0-9]/;
  var RE_NUMBER = /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/;
  var RE_VAR = /^(?:@@?[A-Za-z0-9_]+|:[:A-Za-z0-9_]+|\$[0-9]+)/;

  function tokenize(src) {
    var out = [];
    var i = 0;
    var n = src.length;
    var line = 0;

    while (i < n) {
      var c = src[i];

      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === ' ' || c === '　') { i++; continue; }

      // 行注释（含 Java 风格 //）
      if ((c === '-' && src[i + 1] === '-') || c === '#' || (c === '/' && src[i + 1] === '/')) {
        var e = src.indexOf('\n', i);
        if (e < 0) e = n;
        out.push({ t: 'comment', v: src.slice(i, e).replace(/\s+$/, ''), line: true, ln: line, s: i, e: e });
        i = e;
        continue;
      }

      // 块注释
      if (c === '/' && src[i + 1] === '*') {
        var e2 = src.indexOf('*/', i + 2);
        e2 = e2 < 0 ? n : e2 + 2;
        var seg = src.slice(i, e2);
        out.push({ t: 'comment', v: seg, line: false, ln: line, s: i, e: e2 });
        line += (seg.match(/\n/g) || []).length;
        i = e2;
        continue;
      }

      // ${var} / ${hiveconf:x} 变量
      if (c === '$' && src[i + 1] === '{') {
        var e3 = src.indexOf('}', i + 2);
        if (e3 > 0) {
          out.push({ t: 'word', v: src.slice(i, e3 + 1), variable: true, ln: line, s: i, e: e3 + 1 });
          i = e3 + 1;
          continue;
        }
      }

      // 字符串 / 引号标识符
      if (c === "'" || c === '"' || c === '`') {
        var q = c;
        var j = i + 1;
        var buf = c;
        while (j < n) {
          var d = src[j];
          if (d === '\\' && q !== '`') { buf += d + (src[j + 1] || ''); j += 2; continue; }
          if (d === q) {
            if (src[j + 1] === q) { buf += d + d; j += 2; continue; }
            buf += d; j++; break;
          }
          buf += d; j++;
        }
        out.push({ t: q === "'" ? 'string' : 'ident', v: buf, ln: line, s: i, e: j });
        line += (buf.match(/\n/g) || []).length;
        i = j;
        continue;
      }

      // [方括号标识符]
      if (c === '[') {
        var e4 = src.indexOf(']', i);
        e4 = e4 < 0 ? n : e4 + 1;
        out.push({ t: 'ident', v: src.slice(i, e4), ln: line, s: i, e: e4 });
        i = e4;
        continue;
      }

      // 数字
      if (RE_DIGIT.test(c) || (c === '.' && RE_DIGIT.test(src[i + 1] || ''))) {
        var m = RE_NUMBER.exec(src.slice(i));
        if (m) { out.push({ t: 'number', v: m[0], ln: line, s: i, e: i + m[0].length }); i += m[0].length; continue; }
      }

      // 变量 / 绑定参数
      if (c === '@' || c === ':' || c === '$') {
        var mv = RE_VAR.exec(src.slice(i));
        if (mv && mv[0].length > 1) {
          out.push({ t: 'word', v: mv[0], variable: true, ln: line, s: i, e: i + mv[0].length });
          i += mv[0].length;
          continue;
        }
      }

      // 单词
      if (RE_WORD_START.test(c)) {
        var k = i + 1;
        while (k < n && RE_WORD_CHAR.test(src[k])) k++;
        out.push({ t: 'word', v: src.slice(i, k), ln: line, s: i, e: k });
        i = k;
        continue;
      }

      var s3 = src.substr(i, 3);
      if (OPS3.indexOf(s3) >= 0) { out.push({ t: 'op', v: s3, ln: line, s: i, e: i + 3 }); i += 3; continue; }

      var s2 = src.substr(i, 2);
      if (OPS2.indexOf(s2) >= 0) { out.push({ t: 'op', v: s2, ln: line, s: i, e: i + 2 }); i += 2; continue; }

      out.push({ t: PUNCT.indexOf(c) >= 0 ? 'punct' : 'op', v: c, ln: line, s: i, e: i + 1 });
      i++;
    }

    return out;
  }

  // 把 "GROUP" "BY" 这样的相邻单词合并成 "GROUP BY"
  var PHRASE_SET = new Set(PHRASES);

  function mergePhrases(tokens) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (tk.t !== 'word' || tk.variable) { out.push(tk); continue; }

      var hit = null;
      for (var k = 5; k >= 2; k--) {
        if (i + k > tokens.length) continue;
        var parts = [];
        var ok = true;
        for (var j = 0; j < k; j++) {
          var cur = tokens[i + j];
          if (!cur || cur.t !== 'word' || cur.variable) { ok = false; break; }
          if (j > 0 && cur.ln !== tokens[i].ln) { ok = false; break; }
          parts.push(cur.v);
        }
        if (!ok) continue;
        var cand = parts.join(' ').toUpperCase();
        if (PHRASE_SET.has(cand)) { hit = { v: parts.join(' '), len: k }; break; }
      }

      if (hit) {
        out.push({ t: 'word', v: hit.v, phrase: true, ln: tk.ln, s: tk.s, e: tokens[i + hit.len - 1].e });
        i += hit.len - 1;
      } else {
        out.push(tk);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- 着色 */

  function classify(tk, next, prev) {
    switch (tk.t) {
      case 'comment': return 'comment';
      case 'string': return 'str';
      case 'number': return 'num';
      case 'ident': return 'ident';
      case 'op': return 'op';
      case 'punct': return 'punct';
    }
    if (tk.t === 'word') {
      if (tk.variable) return 'var';
      // a.b 这种点号后的字段名永远当标识符，避免 hive.exec.dynamic.partition 被大写
      if (prev && prev.t === 'punct' && prev.v === '.') return 'ident';
      var up = tk.v.toUpperCase();
      if (CONSTANTS.has(up)) return 'const';
      if (KEYWORDS.has(up)) return 'kw';
      if (TYPES.has(up)) return 'type';
      // 紧跟左括号的普通标识符视为函数名（排除表名场景）
      if (next && next.t === 'punct' && next.v === '(') {
        var pu = prev && prev.t === 'word' ? prev.v.toUpperCase() : null;
        if (!(pu && TABLE_CTX.has(pu))) return 'fn';
      }
      return 'ident';
    }
    return 'ident';
  }

  function applyCase(word, mode) {
    if (mode === 'lower') return word.toLowerCase();
    if (mode === 'keep') return word;
    return word.toUpperCase();
  }

  /* ------------------------------------------------- 装饰线（原样保留） */

  // 形如 "=====step:16,spark =========" 的分步标记：不是 SQL，
  // 原样输出，绝不插入空格或拆开连续的 = * # ~
  var BANNER_RE = /[=*#~]{3,}/;

  function findBannerLines(src) {
    var out = {};
    var arr = src.split('\n');
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i].trim();
      if (!t) continue;
      if (t.slice(0, 2) === '--') continue;      // 已经是注释，本身就会原样保留
      if (t.charAt(0) === '#' || t.slice(0, 2) === '/*') continue;
      if (t.indexOf("'") >= 0 || t.indexOf('"') >= 0) continue;  // 含字符串，不做处理
      if (BANNER_RE.test(t)) out[i] = arr[i].replace(/[ \t]+$/, '');
    }
    return out;
  }

  /* ---------------------------------------------------------------- 排版 */

  function isClauseWord(up) {
    return CLAUSE.has(up) || JOINS.has(up) || STATEMENT_START.has(up) ||
      up === 'AND' || up === 'OR' || up === 'UNION' || up === 'UNION ALL' ||
      up === 'INTERSECT' || up === 'EXCEPT';
  }

  // SELECT 列表如果只有一项、且不含顶层逗号，就保持在同一行
  function listIsSimple(tokens, i) {
    var depth = 0;
    var len = 0;
    for (var k = i + 1; k < tokens.length; k++) {
      var tk = tokens[k];
      if (tk.t === 'punct') {
        if (tk.v === '(') depth++;
        else if (tk.v === ')') { if (depth === 0) break; depth--; }
        else if (tk.v === ',' && depth === 0) return false;
        else if (tk.v === ';') break;
      }
      if (tk.t === 'word') {
        var up = tk.v.toUpperCase();
        if (depth === 0 && isClauseWord(up)) break;
        len += tk.v.length + 1;
      } else {
        len += (tk.v || '').length + 1;
      }
      if (len > 60) return false;
    }
    return true;
  }

  function nextSignificant(tokens, i) {
    for (var k = i + 1; k < tokens.length; k++) {
      if (tokens[k].t !== 'comment') return tokens[k];
    }
    return null;
  }

  function formatTokens(tokens, opts, verbatim) {
    var kwCase = opts.keywordCase || 'upper';
    var breakAndOr = opts.breakAndOr !== false;
    var indSize = opts.indentSize || 2;
    var maxWidth = opts.maxWidth || 0;

    var lines = [];
    var cur = { indent: 0, toks: [], len: 0 };
    var blockBase = 0;
    var inList = false;
    var listIndent = 1;
    var inlineDepth = 0;
    var parenStack = [];
    var caseStack = [];
    var betweenPending = 0;
    var emitted = {};
    var curTok = null;
    var prevAdded = null;
    var contBase = 0;

    function newLine(level) {
      if (!cur.toks.length) { cur.indent = level; cur.len = level * indSize; contBase = level; return; }
      lines.push(cur);
      cur = { indent: level, toks: [], len: level * indSize };
      contBase = level;
    }

    // 续行：相对当前逻辑行的缩进固定 +1，连续断行也不会逐级加深
    function contLine() {
      if (!cur.toks.length) return;
      lines.push(cur);
      var lvl = contBase + 1;
      cur = { indent: lvl, toks: [], len: lvl * indSize };
    }

    function resetCur(level) {
      cur = { indent: level, toks: [], len: level * indSize };
      contBase = level;
    }

    function lastReal() {
      for (var k = cur.toks.length - 1; k >= 0; k--) {
        if (cur.toks[k].c !== 'ws') return cur.toks[k];
      }
      return null;
    }

    function canBreakBefore(v, space, p) {
      if (!space) return false;
      if (v === ')' || v === ',' || v === ';' || v === '.' || v === '::' || v === '(') return false;
      if (v === 'WHEN' || v === 'THEN' || v === 'ELSE' || v === 'END') return false;
      // 也不要在 CASE / WHEN / THEN / ELSE 后面直接断开，避免把 "ELSE 0" 拆成两行
      if (p && /^(CASE|WHEN|THEN|ELSE)$/i.test(p.v)) return false;
      // 运算符不要被甩到行首
      if (['+', '-', '*', '/', '%', '||'].indexOf(v) >= 0) return false;
      return true;
    }

    function add(v, c) {
      var p = lastReal();
      var space = !!p;
      if (p) {
        var pv = p.v;
        if (pv === '(' || pv === '.' || pv === '::' || p.noSpaceAfter) space = false;
        else if (v === ')' || v === ',' || v === ';' || v === '.' || v === '::') space = false;
        else if (v === '(' && (p.c === 'fn' || p.c === 'type')) space = false;
        // 源码里紧挨着的两个「原子」token（如 xxx_${dt}）保持贴合；
        // 运算符两侧仍然统一补空格，不保留手写的 END+ 这种
        var ATOMIC = { word: 1, number: 1, string: 1, ident: 1 };
        if (curTok && prevAdded && prevAdded.e === curTok.s &&
            ATOMIC[curTok.t] && ATOMIC[prevAdded.t]) space = false;
      }

      // 超宽折行：只在 token 之间、且本来就有空隙的地方断开
      if (maxWidth && cur.toks.length &&
          cur.len + v.length + (space ? 1 : 0) > maxWidth && canBreakBefore(v, space, p)) {
        contLine();
        space = false;
      }

      if (space) { cur.toks.push({ v: ' ', c: 'ws' }); cur.len += 1; }
      cur.toks.push({ v: v, c: c });
      cur.len += v.length;
      prevAdded = curTok;
    }

    // 该 token 是否是一个「操作数」的结尾（决定后面 + - 是不是一元符号）
    function endsOperand(p) {
      if (!p) return false;
      if (p.c === 'num' || p.c === 'str' || p.c === 'ident' || p.c === 'var' || p.c === 'const') return true;
      if (p.v === ')') return true;
      if (p.c === 'kw') {
        var u = p.v.toUpperCase();
        return u === 'END' || u === 'NULL' || u === 'TRUE' || u === 'FALSE';
      }
      return false;
    }

    // 判断 CREATE TABLE t ( ... ) 里的括号（列定义块）
    // 允许库名.表名的点号；跳过注释；也允许 AS SELECT 之类不误判
    function isTableColumns(idx) {
      for (var k = idx - 1, seen = 0; k >= 0 && seen < 8; k--) {
        var tk = tokens[k];
        if (tk.t === 'comment') continue;                 // 注释不算
        if (tk.t === 'punct' && tk.v === '.') continue;   // 库名.表名 的点不算
        seen++;
        if (tk.t !== 'word') return false;
        if (/(^|\s)TABLE$/.test(tk.v.toUpperCase())) return true;
      }
      return false;
    }

    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      var next = tokens[i + 1];
      curTok = tk;

      /* 装饰线：整行原样输出 */
      if (tk.ln != null && verbatim && verbatim[tk.ln] !== undefined) {
        if (!emitted[tk.ln]) {
          emitted[tk.ln] = 1;
          newLine(blockBase);
          lines.push({ indent: 0, toks: [], raw: verbatim[tk.ln] });
          resetCur(blockBase);
        }
        continue;
      }

      /* 注释 */
      if (tk.t === 'comment') {
        if (tk.line) {
          // 源码里跟前面的代码同一行 → 挂在行尾；源码单独一行 → 自己占一行
          if (!prevAdded || prevAdded.ln !== tk.ln) newLine(cur.indent);
          add(tk.v, 'comment');
          newLine(cur.indent);
        } else if (tk.v.indexOf('\n') >= 0) {
          var parts = tk.v.split('\n');
          for (var pi = 0; pi < parts.length; pi++) {
            if (pi > 0) newLine(cur.indent);
            add(parts[pi].replace(/\s+$/, ''), 'comment');
          }
        } else {
          add(tk.v, 'comment');
        }
        continue;
      }

      var up = tk.t === 'word' ? tk.v.toUpperCase() : null;
      var prevTok = null;
      for (var pk = i - 1; pk >= 0; pk--) {
        if (tokens[pk].t !== 'comment') { prevTok = tokens[pk]; break; }
      }
      var cls = classify(tk, next, prevTok);
      var text = cls === 'kw' ? applyCase(tk.v, kwCase) : tk.v;

      /* 左括号 */
      if (tk.t === 'punct' && tk.v === '(') {
        var sig = nextSignificant(tokens, i);          // 跳过注释再判断
        var isSub = !!(sig && sig.t === 'word' &&
          /^(SELECT|WITH|VALUES|INSERT|UPDATE|DELETE)$/.test(sig.v.toUpperCase()));
        var isCols = !isSub && isTableColumns(i);

        add('(', 'punct');

        if (isSub || isCols) {
          parenStack.push({
            block: true, base: blockBase, parenIndent: cur.indent,
            list: inList, indent: listIndent
          });
          blockBase = cur.indent + 1;
          newLine(blockBase);
          inList = isCols;
          listIndent = blockBase;
        } else {
          parenStack.push({ block: false, list: inList, indent: listIndent });
          inList = false;
          inlineDepth++;
        }
        continue;
      }

      /* 右括号 */
      if (tk.t === 'punct' && tk.v === ')') {
        var p = parenStack.pop();
        if (p && p.block) {
          newLine(blockBase);
          blockBase = p.base;
          cur.indent = p.parenIndent;
          add(')', 'punct');
          inList = p.list;
          listIndent = p.indent;
        } else {
          add(')', 'punct');
          if (inlineDepth > 0) inlineDepth--;
          if (p) { inList = p.list; listIndent = p.indent; }
        }
        continue;
      }

      /* 逗号 */
      if (tk.t === 'punct' && tk.v === ',') {
        add(',', 'punct');
        if (inlineDepth === 0 && inList) newLine(listIndent);
        continue;
      }

      /* 分号：语句结束，空一行 */
      if (tk.t === 'punct' && tk.v === ';') {
        add(';', 'punct');
        blockBase = 0;
        inlineDepth = 0;
        parenStack.length = 0;
        caseStack.length = 0;
        inList = false;
        var nxTk = nextSignificant(tokens, i);
        var nxIsSet = !!(nxTk && nxTk.t === 'word' && nxTk.v.toUpperCase() === 'SET');
        if (i < tokens.length - 1 && !nxIsSet) {
          if (cur.toks.length) { lines.push(cur); cur = { indent: 0, toks: [], len: 0 }; }
          lines.push({ indent: 0, toks: [], blank: true });
        }
        continue;
      }

      /* CASE 链：运算符后面另起一行（括号内也一样） */
      if (up === 'CASE') {
        var lpc = lastReal();
        if (lpc && lpc.c === 'op' && ['+', '-', '*', '/', '%', '||'].indexOf(lpc.v) >= 0) {
          contLine();
        }
      }

      /* 关键字 */
      if (tk.t === 'word' && inlineDepth === 0) {
        if (up === 'BETWEEN') betweenPending++;

        // 语句开头
        if (STATEMENT_START.has(up)) {
          newLine(blockBase);
          add(text, 'kw');
          inList = false;

          if (up === 'SELECT') {
            if (!listIsSimple(tokens, i)) {
              inList = true;
              listIndent = blockBase + 1;
              newLine(blockBase + 1);
            }
          } else if (up === 'WITH') {
            inList = true;
            listIndent = blockBase;
          } else if (up === 'VALUES') {
            inList = true;
            listIndent = blockBase + 1;
            newLine(blockBase + 1);
          }
          continue;
        }

        // 子句
        if (CLAUSE.has(up)) {
          newLine(blockBase);
          add(text, 'kw');
          inList = true;
          listIndent = blockBase + 1;
          // SET 只有一条赋值时保持同行，更贴近手写习惯
          if (up === 'SET' && !listIsSimple(tokens, i)) newLine(blockBase + 1);
          continue;
        }

        // JOIN
        if (JOINS.has(up)) {
          newLine(blockBase);
          add(text, 'kw');
          inList = false;
          continue;
        }

        // AND / OR
        if (up === 'AND' || up === 'OR') {
          if (up === 'AND' && betweenPending > 0) {
            betweenPending--;
            add(text, 'kw');
            continue;
          }
          if (breakAndOr) {
            var ce = caseStack.length ? caseStack[caseStack.length - 1] : null;
            // CASE 里的 AND 与 WHEN 条件对齐，且不会逐级加深
            newLine(ce ? ce.when + 1 : blockBase + 1);
          }
          add(text, 'kw');
          continue;
        }

        // CASE 家族
        if (up === 'CASE') {
          caseStack.push({ base: cur.indent, when: cur.indent + 1 });
          add(text, 'kw');
          continue;
        }
        if (up === 'WHEN' || up === 'ELSE') {
          var ent = caseStack.length ? caseStack[caseStack.length - 1] : null;
          var cbase = ent ? ent.base : blockBase;
          if (up === 'WHEN' && ent) ent.when = cbase + 1;
          newLine(cbase + 1);
          add(text, 'kw');
          continue;
        }
        if (up === 'END') {
          var lvl = caseStack.length ? caseStack.pop().base : blockBase;
          newLine(lvl);
          add(text, 'kw');
          continue;
        }
      }

      /* 一元正负号：紧贴后面的数字，如 -1 */
      if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
        var pv2 = lastReal();
        var unary = !endsOperand(pv2);
        add(text, cls);
        var lt = lastReal();
        if (unary && lt) lt.noSpaceAfter = true;
        continue;
      }

      add(text, cls);
    }

    if (cur.toks.length) lines.push(cur);

    // 去掉末尾空行
    while (lines.length && !lines[lines.length - 1].toks.length &&
           lines[lines.length - 1].raw === undefined) lines.pop();

    return lines;
  }

  /* ---------------------------------------------------------------- 输出 */

  function trimToks(toks) {
    var out = toks.slice();
    while (out.length && out[out.length - 1].c === 'ws') out.pop();
    return out;
  }

  function lineText(line, indSize) {
    if (line.raw !== undefined) return line.raw;
    var toks = trimToks(line.toks || []);
    return ' '.repeat(line.indent * indSize) + toks.map(function (t) { return t.v; }).join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function lineHtml(line, indSize) {
    if (line.raw !== undefined) {
      return '<span class="tok-banner">' + escapeHtml(line.raw) + '</span>';
    }
    var toks = trimToks(line.toks || []);
    var html = escapeHtml(' '.repeat(line.indent * indSize));
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.c === 'ws') html += ' ';
      else html += '<span class="tok-' + t.c + '">' + escapeHtml(t.v) + '</span>';
    }
    return html || '&#8203;';
  }

  function render(lines, indSize) {
    return lines.map(function (l) { return lineText(l, indSize); }).join('\n');
  }

  /* ---------------------------------------------------------------- 入口 */

  function format(src, options) {
    var opts = Object.assign(
      { indentSize: 2, keywordCase: 'upper', breakAndOr: true, maxWidth: 100 },
      options || {}
    );
    var text = src || '';
    var tokens = mergePhrases(tokenize(text));
    var lines = formatTokens(tokens, opts, findBannerLines(text));
    return {
      lines: lines,
      tokens: tokens,
      text: render(lines, opts.indentSize),
      html: lines.map(function (l) { return lineHtml(l, opts.indentSize); })
    };
  }

  root.SQLFormat = {
    tokenize: tokenize,
    parse: function (src) { return mergePhrases(tokenize(src)); },
    format: format,
    lineText: lineText,
    lineHtml: lineHtml,
    escapeHtml: escapeHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
