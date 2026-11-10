'use strict';
/* 鸭力鸭 · Codex 状态采集器
 *
 * 职责：只读 ~/.codex 下的 SQLite 状态库，算出「Codex 现在在干什么」，
 * 输出一份快照给主进程做仲裁。本模块不依赖 Electron，可单独用 node 跑：
 *
 *     node codex-monitor.js --probe        # 打印一次快照
 *     node codex-monitor.js --watch        # 持续打印状态变化
 *
 * 设计约束（见 docs/codex-monitor-design.md）：
 *   - 事实以 thread_turns 为准；logs 只做加速器，这里暂时不读 logs
 *   - status='inProgress' 不可信：实测存在崩溃遗留的僵尸回合，必须叠加
 *     「最后一条 item 距今 < 90s」才算真的在跑
 *   - 待授权没有落盘，只给弱信号「可能卡在等你」，不许谎称待授权
 *   - 零写操作：sqlite3 一律 -readonly
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
/* 允许指向另一份 Codex 目录（自测/回归用：复制一份库改数据，不碰真库） */
const CODEX_DIR = process.env.YALIYA_CODEX_DIR
  ? path.resolve(process.env.YALIYA_CODEX_DIR)
  : path.join(HOME, '.codex');

const DB = {
  history: path.join(CODEX_DIR, 'thread_history_1.sqlite'),
  state: path.join(CODEX_DIR, 'state_5.sqlite'),
  goals: path.join(CODEX_DIR, 'goals_1.sqlite'),
};

/* macOS 自带 sqlite3；Homebrew 版优先（版本更新，-json 更稳） */
const SQLITE_BIN = [
  '/opt/homebrew/bin/sqlite3',
  '/usr/bin/sqlite3',
].find(p => { try { return fs.existsSync(p); } catch { return false; } }) || 'sqlite3';

const DEFAULTS = {
  activeIdleMs: 90 * 1000,      /* 最后活动在此之内才算「真的在跑」 */
  stallMaxMs: 15 * 60 * 1000,   /* 停滞超过这个时长 → 疑似僵尸，不再报「卡在等你」 */
  longTurnMs: 20 * 60 * 1000,   /* 单回合跑太久 → 过劳 */
  cryMs: 60 * 1000,             /* 失败哭多久 */
  celebrateMs: 9 * 1000,        /* 完成庆祝多久（与渲染层 9s 回收对齐） */
  overloadMs: 15 * 1000,        /* 被打断后躺平多久 */
  staleMs: 5 * 60 * 1000,       /* 多久没读到数据算「过期」 */
  pollMs: 5000,                 /* 兜底心跳 */
  debounceMs: 120,              /* WAL 变动后的防抖 */
  minIntervalMs: 400,           /* 两次查询最短间隔 */
};

/* 鸭子状态优先级（数字越大越优先）。90 以上留给 M2 的真待授权/待回答 */
const PRIORITY = {
  approval: 100,
  question: 95,
  stuck: 80,
  goalBlocked: 78,
  goalLimited: 70,
  overwork: 65,
  failed: 60,
  completed: 50,
  sprint: 45,
  run: 40,
  disconnected: 25,
};

function sqlStr(s){ return "'" + String(s).replace(/'/g, "''") + "'"; }
function dbUri(p){ return 'file:' + p + '?immutable=1'; }
function walLive(p){ return exists(p + '-wal'); }

function exists(p){ try { return fs.existsSync(p); } catch { return false; } }

/* 正在被写的库要用普通只读打开（能看见 WAL 里的最新数据）；
   没有 WAL 的库走 immutable=1——完全不建 -shm 锁文件，真正做到零写入。
   两者都开不了的极端情况，整体退到 immutable。 */
function buildSql(forceImmutable){
  const immHist = forceImmutable || !walLive(DB.history);
  const immState = forceImmutable || !walLive(DB.state);
  const hasGoals = exists(DB.goals);
  const immGoals = forceImmutable || !walLive(DB.goals);
  const parts = [
    `ATTACH DATABASE ${sqlStr(immState ? dbUri(DB.state) : DB.state)} AS st;`,
  ];
  if(hasGoals) parts.push(`ATTACH DATABASE ${sqlStr(immGoals ? dbUri(DB.goals) : DB.goals)} AS g;`);
  parts.push(`
WITH recent_questions AS (
  SELECT thq.cwd,
         json_extract(qi.item_json, '$.content[0].text') AS question,
         qi.created_at_ms AS question_ms,
         ROW_NUMBER() OVER (
           PARTITION BY thq.cwd
           ORDER BY qi.created_at_ms DESC, qi.rollout_ordinal DESC
         ) AS row_num
    FROM thread_items qi
    JOIN st.threads thq ON thq.id = qi.thread_id
   WHERE qi.item_type = 'userMessage'
     AND thq.archived = 0
     AND lower(trim(thq.title)) <> 'guardian review'
     AND COALESCE(thq.source, '') NOT LIKE '%guardian%'
)
SELECT t.thread_id, t.turn_id, t.status, t.started_at, t.completed_at, t.duration_ms, t.error_json,
       th.title, th.cwd, th.git_branch, th.archived, th.source,
       ${hasGoals ? 'g.status' : 'NULL'} AS goal_status,
       (SELECT i.created_at_ms FROM thread_items i
          WHERE i.thread_id = t.thread_id AND i.turn_id = t.turn_id
          ORDER BY i.rollout_ordinal DESC LIMIT 1) AS last_item_ms,
       (SELECT i.item_type FROM thread_items i
          WHERE i.thread_id = t.thread_id AND i.turn_id = t.turn_id
          ORDER BY i.rollout_ordinal DESC LIMIT 1) AS last_item_type,
       /* 标题回退链第二级：threads.title 为空时取用户第一句话（v0.3 采纳自 CodexNotch） */
       (SELECT json_extract(ui.item_json, '$.content[0].text')
          FROM thread_items ui
         WHERE ui.thread_id = t.thread_id AND ui.item_type = 'userMessage'
         ORDER BY ui.created_at_ms DESC, ui.rollout_ordinal DESC LIMIT 1) AS last_user_text,
       rq.question AS project_question,
       rq.question_ms AS project_question_ms,
       (SELECT COUNT(*) FROM thread_items i
          WHERE i.thread_id = t.thread_id AND i.turn_id = t.turn_id) AS item_count,
       (SELECT COUNT(*) FROM thread_items i
          WHERE i.thread_id = t.thread_id AND i.turn_id = t.turn_id
            AND i.item_type = 'fileChange') AS file_count,
       (SELECT COUNT(*) FROM thread_items i
          WHERE i.thread_id = t.thread_id AND i.turn_id = t.turn_id
            AND i.item_type = 'commandExecution') AS cmd_count
FROM thread_turns t
LEFT JOIN st.threads th ON th.id = t.thread_id
${hasGoals ? 'LEFT JOIN g.thread_goals g ON g.thread_id = t.thread_id' : ''}
LEFT JOIN recent_questions rq ON rq.cwd = th.cwd AND rq.row_num = 1
WHERE COALESCE(t.completed_at, t.started_at, 0) > strftime('%s','now') - 86400
ORDER BY COALESCE(t.completed_at, t.started_at, 0) DESC
LIMIT 400;
`);
  return { sql: parts.join('\n'), main: immHist ? dbUri(DB.history) : DB.history };
}

/* 一次 sqlite3 调用拿全部，跨库 ATTACH join。实测 < 10ms */
function queryTurns(cb){
  const attempt = (forceImmutable, done) => {
    const { sql, main } = buildSql(forceImmutable);
    execFile(SQLITE_BIN, ['-readonly', '-json', main, sql], {
      timeout: 4000, maxBuffer: 8 * 1024 * 1024,
    }, done);
  };
  attempt(false, (err, stdout, stderr) => {
    if(!err) return parse(stdout, cb);
    const msg = String(stderr || err.message || '');
    /* WAL 存在但 -shm 缺失（Codex 崩过）时只读打不开 → 整体退到 immutable */
    if(/unable to open database file|database is locked|disk i\/o/i.test(msg)){
      attempt(true, (e2, out2, err2) => {
        if(e2){ cb(e2, null, String(err2 || msg)); return; }
        parse(out2, cb);
      });
      return;
    }
    cb(err, null, msg);
  });
}
function parse(stdout, cb){
  let rows;
  try { rows = JSON.parse(stdout || '[]'); }
  catch(e){ cb(e, null, 'JSON 解析失败'); return; }
  cb(null, Array.isArray(rows) ? rows : []);
}

function projectNameOf(cwd){
  const s = String(cwd || '').replace(/[\\/]+$/, '');
  if(!s) return 'Codex';
  const parts = s.split(/[\\/]/);
  return parts[parts.length - 1] || 'Codex';
}

/* 标题清洗：只取第一行有效文字，且长度封顶（隐私档位由调用方再降级） */
function cleanTitle(title, cwd){
  const lines = String(title || '').replace(/\r\n?/g, '\n').split('\n');
  for(const line of lines){
    const v = line.trim();
    if(!v || v.startsWith('#') || v.startsWith('```') || v.length < 2) continue;
    return v.length > 42 ? v.slice(0, 41) + '…' : v;
  }
  return projectNameOf(cwd);
}

/* 问题正文单独清洗：比线程标题保留更多上下文，最终仍由卡片单行省略。 */
function cleanQuestion(text){
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  for(const line of lines){
    const v = line.trim();
    if(!v || v.startsWith('```')) continue;
    return v.length > 240 ? v.slice(0, 239) + '…' : v;
  }
  return '';
}

function isInternalThread(row){
  const title = String(row.title || '').trim();
  if(/^guardian review$/i.test(title)) return true;
  if(String(row.source || '').indexOf('guardian') >= 0) return true;
  return false;
}

class CodexMonitor {
  constructor(opts = {}){
    this.opts = Object.assign({}, DEFAULTS, opts);
    this.onSnapshot = opts.onSnapshot || (() => {});
    this.timer = null;
    this.debounceTimer = null;
    this.watchers = [];
    this.lastQueryAt = 0;
    this.running = false;
    this.prevStatus = new Map();     /* key: threadId:turnId → status */
    this.prevSeen = false;
    this.lastOkAt = 0;
    this.lastError = null;
    this.snapshot = null;
    this.lastEvent = null;           /* { type, at, threadId } */
  }

  start(){
    if(this.running) return;
    this.running = true;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.opts.pollMs);
    this.watchWals();
  }

  stop(){
    this.running = false;
    if(this.timer){ clearInterval(this.timer); this.timer = null; }
    if(this.debounceTimer){ clearTimeout(this.debounceTimer); this.debounceTimer = null; }
    for(const w of this.watchers){ try { w.close(); } catch {} }
    this.watchers = [];
  }

  /* 盯 WAL 文件变动 → 立刻查一次（事件延迟从 5s 压到 ~150ms，且几乎不耗 CPU）。
     Codex 可能后启动，所以每次轮询都补挂一次监听。 */
  watchWals(){
    this.watched = this.watched || new Set();
    for(const file of [DB.history + '-wal', DB.state + '-wal']){
      if(this.watched.has(file)) continue;
      try {
        if(!exists(file)) continue;
        const w = fs.watch(file, { persistent: false }, () => this.schedule());
        w.on('error', () => {});
        this.watchers.push(w);
        this.watched.add(file);
      } catch { /* 监听失败不影响兜底轮询 */ }
    }
  }

  schedule(){
    if(!this.running || this.debounceTimer) return;
    const wait = Math.max(this.opts.debounceMs, this.lastQueryAt + this.opts.minIntervalMs - Date.now());
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.poll();
    }, Math.max(0, wait));
  }

  poll(){
    if(!this.running) return;
    this.lastQueryAt = Date.now();
    this.watchWals();          /* Codex 后启动时补挂 WAL 监听 */
    queryTurns((err, rows, detail) => {
      if(!this.running) return;
      if(err){
        this.lastError = detail || String(err && err.message || err);
        this.emit(this.degrade());
        return;
      }
      this.lastError = null;
      this.lastOkAt = Date.now();
      this.emit(this.compute(rows));
    });
  }

  /* ---------- 断连/降级：不许假平安 ---------- */
  degrade(){
    const now = Date.now();
    const stale = this.lastOkAt && (now - this.lastOkAt > this.opts.staleMs);
    return {
      ts: now,
      ok: false,
      stale: true,
      error: this.lastError || '读取失败',
      threads: [],
      counts: { active: 0, stuck: 0, failed: 0, unread: 0 },
      duck: { state: 'sleep', priority: PRIORITY.disconnected, pinned: false, reason: '看不到 Codex 状态' },
      tray: { emoji: '💤', count: 0, tip: '鸭力鸭 · Codex 状态不可用（可能过期）' },
      events: [],
    };
  }

  /* ---------- 核心：行 → 快照 ---------- */
  compute(rows){
    const now = Date.now();
    const opt = this.opts;

    const threads = new Map();     /* threadId → 该线程最新回合 */
    const events = [];
    const seenNow = new Map();

    for(const r of rows){
      if(r.archived === 1) continue;
      if(isInternalThread(r)) continue;

      const key = r.thread_id + ':' + r.turn_id;
      seenNow.set(key, r.status);

      /* 事件差分：只在「已知旧状态 → 新状态」时产生，首次加载只建基线不播报 */
      if(this.prevSeen){
        const prev = this.prevStatus.get(key);
        if(prev !== r.status){
          if(r.status === 'completed') events.push({ type: 'completed', threadId: r.thread_id, at: now, title: cleanTitle(r.title, r.cwd) });
          else if(r.status === 'failed') events.push({ type: 'failed', threadId: r.thread_id, at: now, title: cleanTitle(r.title, r.cwd), error: firstLine(r.error_json) });
          else if(r.status === 'interrupted') events.push({ type: 'interrupted', threadId: r.thread_id, at: now, title: cleanTitle(r.title, r.cwd) });
        }
      }

      const startedAt = r.started_at ? r.started_at * 1000 : null;
      const completedAt = r.completed_at ? r.completed_at * 1000 : null;
      const lastItemAt = r.last_item_ms ? Number(r.last_item_ms) : null;
      const lastActivityAt = Math.max(lastItemAt || 0, startedAt || 0) || null;
      const inProgress = r.status === 'inProgress';
      const silentFor = lastActivityAt ? now - lastActivityAt : Infinity;

      const item = {
        id: r.thread_id,
        turnId: r.turn_id,
        title: cleanTitle(r.title, r.cwd),
        /* titleFull = 完整回退链（title → 用户原话 → 目录名）；
           默认不展示，主进程按「显示任务标题」开关决定用 titleFull 还是 project */
        titleFull: cleanTitle(String(r.title || '').trim() || r.last_user_text, r.cwd),
        question: cleanQuestion(r.project_question || r.last_user_text),
        questionAt: Number(r.project_question_ms || 0) || null,
        project: projectNameOf(r.cwd),
        cwd: r.cwd || '',
        branch: r.git_branch || '',
        status: r.status,
        goal: r.goal_status || null,
        startedAt,
        completedAt,
        durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
        lastActivityAt,
        lastItemType: r.last_item_type || '',
        itemCount: Number(r.item_count) || 0,
        fileCount: Number(r.file_count) || 0,
        cmdCount: Number(r.cmd_count) || 0,
        /* inProgress 不可信：必须叠加近期活动 */
        active: inProgress && silentFor < opt.activeIdleMs,
        stalled: inProgress && silentFor >= opt.activeIdleMs && silentFor < opt.stallMaxMs,
        zombie: inProgress && silentFor >= opt.stallMaxMs,
        overwork: inProgress && startedAt && (now - startedAt) > opt.longTurnMs,
        errorText: firstLine(r.error_json),
      };

      /* 同一线程只保留最新回合（rows 已按时间倒序） */
      if(!threads.has(item.id)) threads.set(item.id, item);

      /* 单个回合的完成事件也要记：同一线程连续多轮时上层仍能收到 */
    }

    this.prevStatus = seenNow;
    this.prevSeen = true;

    /* 事件按时间倒序取最新的，落到 lastEvent 供「庆祝 9s / 哭泣 60s」计时 */
    if(events.length){
      for(const e of events){ if(!this.lastEvent || e.at >= this.lastEvent.at) this.lastEvent = e; }
    }

    const list = Array.from(threads.values());
    const active = list.filter(t => t.active);
    const stuck = list.filter(t => t.stalled);
    const failedRecent = this.recentEvent('failed', opt.cryMs, now);
    const completedRecent = this.recentEvent('completed', opt.celebrateMs, now);
    const interruptedRecent = this.recentEvent('interrupted', opt.overloadMs, now);

    const goalLimited = list.filter(t => t.goal === 'usage_limited' || t.goal === 'budget_limited');
    const goalBlocked = list.filter(t => t.goal === 'blocked');
    const overwork = active.filter(t => t.overwork);

    /* ---------- 鸭子状态：优先级从高到低取第一个命中 ---------- */
    let duck = { state: null, priority: 0, pinned: false, reason: '空闲' };

    if(stuck.length){
      duck = { state: 'angry', priority: PRIORITY.stuck, pinned: true,
        reason: stuck.length + ' 个回合可能卡在等你' };
    } else if(goalBlocked.length){
      duck = { state: 'playdead', priority: PRIORITY.goalBlocked, pinned: true,
        reason: '目标被卡住了' };
    } else if(goalLimited.length){
      duck = { state: 'overload', priority: PRIORITY.goalLimited, pinned: true,
        reason: '额度受限' };
    } else if(overwork.length){
      duck = { state: 'overload', priority: PRIORITY.overwork, pinned: false,
        reason: '单回合跑了 ' + Math.round((now - overwork[0].startedAt) / 60000) + ' 分钟' };
    } else if(failedRecent){
      duck = { state: 'cry', priority: PRIORITY.failed, pinned: false,
        reason: '回合失败' };
    } else if(completedRecent){
      duck = { state: 'celebrate', priority: PRIORITY.completed, pinned: false,
        reason: '这一轮跑完了' };
    } else if(active.length >= 2){
      duck = { state: 'sprint', priority: PRIORITY.sprint, pinned: false,
        reason: active.length + ' 个回合在跑' };
    } else if(active.length === 1){
      duck = { state: 'run', priority: PRIORITY.run, pinned: false,
        reason: '1 个回合在跑' };
    } else if(interruptedRecent){
      duck = { state: 'overload', priority: PRIORITY.overwork, pinned: false,
        reason: '回合被打断' };
    }

    /* ---------- 托盘 ---------- */
    const counts = {
      active: active.length,
      stuck: stuck.length,
      failed: failedRecent ? 1 : 0,
      unread: completedRecent ? 1 : 0,
    };
    let emoji = '🐤', count = 0, tip = '鸭力鸭 · 空闲';
    if(stuck.length){ emoji = '🟠'; count = stuck.length; tip = '鸭力鸭 · ' + stuck.length + ' 个回合可能卡在等你'; }
    else if(goalLimited.length || goalBlocked.length){ emoji = '🟠'; tip = '鸭力鸭 · 目标受限'; }
    else if(failedRecent){ emoji = '🔴'; tip = '鸭力鸭 · 回合失败'; }
    else if(active.length){ emoji = '🟢'; count = active.length; tip = '鸭力鸭 · ' + active.length + ' 个回合在跑'; }
    else if(completedRecent){ emoji = '🔵'; tip = '鸭力鸭 · 刚跑完一轮，去看一眼'; }

    return {
      ts: now,
      ok: true,
      stale: false,
      error: null,
      threads: list,
      counts,
      duck,
      tray: { emoji, count, tip },
      events,
    };
  }

  recentEvent(type, windowMs, now){
    const e = this.lastEvent;
    if(!e || e.type !== type) return false;
    return (now - e.at) <= windowMs;
  }

  emit(snap){
    const prev = this.snapshot;
    this.snapshot = snap;
    /* 内容没变就不打扰上层（耗时类字段不进比较） */
    const sig = JSON.stringify({
      d: snap.duck, c: snap.counts, t: snap.tray, ok: snap.ok,
      n: (snap.threads || []).map(t => [
        t.id, t.status, t.active, t.stalled, t.project, t.question, t.questionAt,
      ]),
    });
    if(prev && prev.__sig === sig) return;
    snap.__sig = sig;
    this.onSnapshot(snap);
  }
}

function firstLine(json){
  const s = String(json || '').trim();
  if(!s || s === 'null') return '';
  try {
    const v = JSON.parse(s);
    const msg = v && (v.message || v.error || v.reason);
    if(typeof msg === 'string') return msg.split('\n')[0].slice(0, 120);
  } catch {}
  return s.split('\n')[0].slice(0, 120);
}

module.exports = {
  CodexMonitor,
  PRIORITY,
  DEFAULTS,
  DB,
  SQLITE_BIN,
  projectNameOf,
  cleanTitle,
  cleanQuestion,
};

/* ---------- 自测入口（不需要 Electron） ---------- */
if(require.main === module){
  const probe = process.argv.includes('--probe');
  const watch = process.argv.includes('--watch');
  if(!probe && !watch){
    console.log('用法: node codex-monitor.js --probe | --watch');
    process.exit(0);
  }
  const mon = new CodexMonitor({
    onSnapshot: s => {
      console.log(JSON.stringify({
        ok: s.ok, stale: s.stale, error: s.error,
        duck: s.duck, counts: s.counts, tray: s.tray,
        events: s.events,
        threads: s.threads.slice(0, 6).map(t => ({
          project: t.project, status: t.status, active: t.active, stalled: t.stalled,
          zombie: t.zombie, goal: t.goal, files: t.fileCount, cmds: t.cmdCount,
          title: t.title,
        })),
      }, null, 2));
      if(probe && !watch) { mon.stop(); process.exit(0); }
    },
  });
  mon.start();
  if(watch) console.log('[watch] 监听中，改动 Codex 会话即可看到变化…');
}
