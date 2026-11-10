'use strict';
/* 鸭力鸭 · Codex 采集器单元测试
 *   node codex-monitor.test.js
 * 只喂合成行给 compute()，不读真库、不写任何东西。
 */

const assert = require('assert');
const { CodexMonitor } = require('./codex-monitor');

const NOW = Date.now();
const sec = ms => Math.floor(ms / 1000);

/* 一行 = SQL 结果的一行（字段名与 buildSql 的 SELECT 对齐） */
function row(over = {}){
  return Object.assign({
    thread_id: 't1', turn_id: 'u1', status: 'inProgress',
    started_at: sec(NOW - 60000), completed_at: null, duration_ms: null,
    error_json: null, title: '测试线程', cwd: '/Users/x/projects/demo', git_branch: 'main',
    archived: 0, source: 'vscode', goal_status: null,
    last_item_ms: NOW - 2000, last_item_type: 'commandExecution',
    last_user_text: null,
    project_question: null, project_question_ms: null,
    item_count: 5, file_count: 1, cmd_count: 3,
  }, over);
}
/* 已建基线的实例：模拟「不是首次加载」，这样状态跃迁才会产生事件 */
function primed(prev = {}){
  const m = new CodexMonitor({});
  m.prevSeen = true;
  m.prevStatus = new Map(Object.entries(prev));
  return m;
}

let passed = 0;
function test(name, fn){
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch(e){ console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

console.log('Codex 采集器 · 状态映射');

test('单个活动回合 → 奔跑', () => {
  const s = primed().compute([row()]);
  assert.strictEqual(s.duck.state, 'run');
  assert.strictEqual(s.counts.active, 1);
  assert.strictEqual(s.tray.emoji, '🟢');
  assert.strictEqual(s.tray.count, 1);
  assert.strictEqual(s.threads[0].project, 'demo');
});

test('两个活动回合 → 冲刺', () => {
  const s = primed().compute([
    row(),
    row({ thread_id: 't2', turn_id: 'u2', title: '另一个活' }),
  ]);
  assert.strictEqual(s.duck.state, 'sprint');
  assert.strictEqual(s.counts.active, 2);
});

test('僵尸 inProgress（40 分钟无活动）不算在跑', () => {
  const s = primed().compute([row({
    started_at: sec(NOW - 40 * 60000), last_item_ms: NOW - 40 * 60000,
  })]);
  assert.strictEqual(s.threads[0].active, false);
  assert.strictEqual(s.threads[0].zombie, true);
  assert.strictEqual(s.counts.active, 0);
  assert.strictEqual(s.duck.state, null, '不该假装在跑');
});

test('停滞 3 分钟 → 生气并钉住（弱信号「可能卡在等你」）', () => {
  const s = primed().compute([row({
    started_at: sec(NOW - 3 * 60000), last_item_ms: NOW - 3 * 60000,
  })]);
  assert.strictEqual(s.threads[0].stalled, true);
  assert.strictEqual(s.duck.state, 'angry');
  assert.strictEqual(s.duck.pinned, true);
  assert.strictEqual(s.counts.stuck, 1);
  assert.strictEqual(s.tray.emoji, '🟠');
});

test('回合完成 → 庆祝 + 蓝色未读', () => {
  const m = primed({ 't1:u1': 'inProgress' });
  const s = m.compute([row({
    status: 'completed', completed_at: sec(NOW), last_item_ms: NOW - 1000, duration_ms: 60000,
  })]);
  assert.strictEqual(s.duck.state, 'celebrate');
  assert.strictEqual(s.events.length, 1);
  assert.strictEqual(s.events[0].type, 'completed');
  assert.strictEqual(s.tray.emoji, '🔵');
});

test('回合失败 → 哭泣 + 带错误首行', () => {
  const m = primed({ 't1:u1': 'inProgress' });
  const s = m.compute([row({
    status: 'failed', completed_at: sec(NOW), duration_ms: 8000,
    error_json: JSON.stringify({ message: '退出码 1\n栈回溯略' }),
  })]);
  assert.strictEqual(s.duck.state, 'cry');
  assert.strictEqual(s.events[0].type, 'failed');
  assert.strictEqual(s.events[0].error, '退出码 1');
  assert.strictEqual(s.tray.emoji, '🔴');
});

test('完成事件过了 9 秒就不再庆祝', () => {
  const m = primed({ 't1:u1': 'inProgress' });
  m.compute([row({ status: 'completed', completed_at: sec(NOW) })]);
  /* 把事件时间戳往前拨 10 秒 */
  m.lastEvent = { type: 'completed', at: Date.now() - 10000, threadId: 't1' };
  const s = m.compute([row({ status: 'completed', completed_at: sec(NOW) })]);
  assert.notStrictEqual(s.duck.state, 'celebrate');
});

test('额度受限 → 躺平并钉住', () => {
  const s = primed().compute([row({ goal_status: 'usage_limited' })]);
  assert.strictEqual(s.duck.state, 'overload');
  assert.strictEqual(s.duck.pinned, true);
});

test('目标被卡 → 装死并钉住', () => {
  const s = primed().compute([row({ goal_status: 'blocked' })]);
  assert.strictEqual(s.duck.state, 'playdead');
  assert.strictEqual(s.duck.pinned, true);
});

test('单回合跑超 20 分钟 → 过劳躺平', () => {
  const s = primed().compute([row({
    started_at: sec(NOW - 25 * 60000), last_item_ms: NOW - 1000,
  })]);
  assert.strictEqual(s.duck.state, 'overload');
  assert.strictEqual(s.duck.pinned, false);
  assert.ok(/分钟/.test(s.duck.reason));
});

console.log('Codex 采集器 · 过滤与隐私');

test('归档线程被忽略', () => {
  const s = primed().compute([row({ archived: 1 })]);
  assert.strictEqual(s.threads.length, 0);
  assert.strictEqual(s.duck.state, null);
});

test('Guardian review 内部线程被忽略', () => {
  const byTitle = primed().compute([row({ title: 'Guardian review' })]);
  assert.strictEqual(byTitle.threads.length, 0);
  const bySource = primed().compute([row({ source: '{"subagent":{"other":"guardian"}}' })]);
  assert.strictEqual(bySource.threads.length, 0);
});

test('长标题被截断到 42 字以内', () => {
  const s = primed().compute([row({ title: '很长'.repeat(80) })]);
  assert.ok(s.threads[0].title.length <= 42, '实际 ' + s.threads[0].title.length);
});

test('标题回退链：threads.title 缺失时取最后一条用户原话', () => {
  const s = primed().compute([row({
    title: '',
    last_user_text: '帮我修一下登录页的报错\n第二行不算',
  })]);
  assert.strictEqual(s.threads[0].titleFull, '帮我修一下登录页的报错');
  assert.strictEqual(s.threads[0].project, 'demo', '目录名始终独立可得');
});

test('标题回退链：title 和用户原话都缺 → 落到目录名', () => {
  const s = primed().compute([row({ title: '', last_user_text: null })]);
  assert.strictEqual(s.threads[0].titleFull, 'demo');
});

test('title 本身非空时不看用户原话', () => {
  const s = primed().compute([row({ title: '正式标题', last_user_text: '原话' })]);
  assert.strictEqual(s.threads[0].titleFull, '正式标题');
});

test('问题内容使用项目最近一次提问，而不是线程标题', () => {
  const s = primed().compute([row({
    title: '正式标题',
    last_user_text: '本线程最后一句',
    project_question: '该项目最近一次提问\n第二行不算',
    project_question_ms: NOW - 1000,
  })]);
  assert.strictEqual(s.threads[0].titleFull, '正式标题');
  assert.strictEqual(s.threads[0].question, '该项目最近一次提问');
  assert.strictEqual(s.threads[0].questionAt, NOW - 1000);
});

test('项目最近提问缺失时回退到本线程最后一条用户消息', () => {
  const s = primed().compute([row({ last_user_text: '本线程最后一句' })]);
  assert.strictEqual(s.threads[0].question, '本线程最后一句');
});

test('同一线程只保留最新回合', () => {
  const s = primed().compute([
    row({ turn_id: 'u2', status: 'completed', completed_at: sec(NOW) }),
    row({ turn_id: 'u1', status: 'completed', completed_at: sec(NOW - 60000) }),
  ]);
  assert.strictEqual(s.threads.length, 1);
  assert.strictEqual(s.threads[0].turnId, 'u2');
});

test('首次加载只建基线，不播报历史事件（防启动通知风暴）', () => {
  const m = new CodexMonitor({});          /* prevSeen = false */
  const s = m.compute([
    row({ turn_id: 'u1', status: 'completed', completed_at: sec(NOW) }),
    row({ turn_id: 'u2', status: 'failed', completed_at: sec(NOW - 1000) }),
  ]);
  assert.strictEqual(s.events.length, 0);
  assert.strictEqual(s.duck.state, null);
});

console.log('Codex 采集器 · 降级');

test('读不到数据 → 打盹 + 💤，绝不显示空闲', () => {
  const s = new CodexMonitor({}).degrade();
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.stale, true);
  assert.strictEqual(s.duck.state, 'sleep');
  assert.strictEqual(s.tray.emoji, '💤');
});

test('快照去重：内容相同不重复回调', () => {
  const m = new CodexMonitor({});
  let calls = 0;
  m.onSnapshot = () => calls++;
  const rows = [row()];
  m.emit(m.compute(rows));
  m.emit(m.compute(rows));
  assert.strictEqual(calls, 1);
});

console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '（存在失败）' : ''));
