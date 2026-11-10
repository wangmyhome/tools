'use strict';
/* 鸭力鸭 · Codex Provider 适配器
 *
 * 把 codex-monitor.js 采集器包装成标准 Provider（见 docs/monitor-provider-spec.md §3）。
 * 采集算法全部在 codex-monitor.js（纯 node 可单测）；这里只补 provider 身份与生命周期，
 * 不做任何业务判断。未来 Qoder / DeepSeek Harness 各写一个同类文件即可接入。
 */

const { CodexMonitor } = require('../codex-monitor');

class CodexProvider {
  constructor(opts = {}){
    this.id = 'codex';
    this.onSnapshot = opts.onSnapshot || (() => {});
    this.mon = new CodexMonitor({
      onSnapshot: snap => this.onSnapshot(Object.assign({}, snap, { provider: this.id })),
    });
  }
  start(){ this.mon.start(); }
  stop(){ this.mon.stop(); }   /* CodexMonitor.stop 幂等 */
}

module.exports = { CodexProvider };
