'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function environment(hash = '') {
  const events = {};
  const location = { hash };
  let index = 0;
  const entries = [{ state: null, hash }];
  const history = {
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    replaceState(state, unused, url) { entries[index] = { state: structuredClone(state), hash: url }; location.hash = url; },
    pushState(state, unused, url) { entries.splice(++index); entries.push({ state: structuredClone(state), hash: url }); location.hash = url; },
    back() { if (index) { index--; location.hash = entries[index].hash; events.popstate({ state: history.state }); } },
    forward() { if (index + 1 < entries.length) { index++; location.hash = entries[index].hash; events.popstate({ state: history.state }); } }
  };
  return { history, location, scrollY: 0, requestAnimationFrame(callback) { callback(); },
    scrollTo(opts) { this.scrollY = opts.top; }, addEventListener(name, callback) { events[name] = callback; } };
}
function app(window) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', type: 'text', tagName: 'INPUT', events: {},
      addEventListener(name, callback) { this.events[name] = callback; }, scrollIntoView() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({ window, document: { addEventListener() {}, querySelector: node, getElementById: node } });
  for (const file of ['core.js', 'app.js']) {
    let source = fs.readFileSync(path.join(root, 'web/js', file), 'utf8');
    if (file === 'app.js') source = source.slice(0, source.indexOf('(async function boot()'));
    vm.runInContext(source, context);
  }
  context.render = context.closeModal = context.updateLedger = () => {};
  return { context, node, calc: expression => vm.runInContext(expression, context) };
}

const window = environment();
let { context, node, calc } = app(window);
context.initializeNavigation();
assert.equal(window.history.length, 1);
context.navigateTo('reports');
context.bindReportFilters();
for (const [id, value] of [['rMonth', '2024-02'], ['rPool', 'goal'], ['rAcc', 'bank']]) {
  node(id).value = value;
  node(id).events.change();
}
assert.equal(window.history.length, 2, '筛选不会增加历史条目');
context.openCategoryRecords({ month: '2024-02', kind: 'expense', categoryId: 'food', poolId: 'goal', accountId: 'bank' });
assert.equal(window.history.length, 3);
assert.equal(window.location.hash, '#ledger');
context.bindLedgerFilters();
node('fKw').value = '午饭';
node('fKw').events.input();
assert.equal(window.history.length, 3);
window.history.back();
assert.equal(calc('ui.tab'), 'reports');
assert.equal(calc('ui.report.month'), '2024-02');
assert.equal(calc('ui.report.poolId'), 'goal');
assert.equal(calc('ui.report.accountId'), 'bank');
window.history.forward();
assert.equal(calc('ui.tab'), 'ledger');
assert.equal(calc('ui.ledger.to'), '2024-02-29');
assert.equal(calc('ui.ledger.categoryId'), 'food');
assert.equal(calc('ui.ledger.keyword'), '午饭');
context.navigateTo('ledger');
assert.equal(window.history.length, 3, '重复点击当前页面不增加历史');

// Refresh uses the existing entry and restores its filters.
({ context, calc } = app(window));
context.initializeNavigation();
assert.equal(calc('ui.tab'), 'ledger');
assert.equal(calc('ui.ledger.keyword'), '午饭');
assert.equal(window.history.length, 3);
window.history.back();
context.navigateTo('accounts');
window.history.forward();
assert.equal(calc('ui.tab'), 'accounts', '后退后开启新页面会替换前进分支');
const direct = app(environment('#reports'));
direct.context.initializeNavigation();
assert.equal(direct.calc('ui.tab'), 'reports');
const invalid = app(environment('#invalid'));
invalid.context.initializeNavigation();
assert.equal(invalid.calc('ui.tab'), 'overview');
console.log('导航回归测试通过：前进后退、报表下钻、筛选恢复、刷新、重复导航及直接打开页面。');
