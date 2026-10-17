'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const handlers = {};
const context = vm.createContext({ document: {
  addEventListener(name, callback) { handlers[name] = callback; },
  querySelector() { return { scrollIntoView() {} }; }
} });
for (const file of ['core.js', 'charts.js', 'app.js']) {
  let source = fs.readFileSync(path.join(root, 'web/js', file), 'utf8');
  if (file === 'app.js') source = source.slice(0, source.indexOf('(async function boot()'));
  vm.runInContext(source, context);
}
context.render = () => {};
context.fixture = {
  accounts: [{ id: 'bank', pool: 'cash', poolLinks: [{ pool: 'goal' }] }, { id: 'fund', pool: 'goose' }],
  categories: [{ id: 'food', name: '餐饮', kind: 'expense', color: '#123456' }, { id: 'pay', name: '工资', kind: 'income', color: '#abcdef' }],
  transactions: [
    { id: '1', date: '2024-02-01', type: 'expense', categoryId: 'food', accountId: 'bank', amount: 2100 },
    { id: '2', date: '2024-02-29', type: 'expense', categoryId: 'food', accountId: 'bank', amount: 3700 },
    { id: '3', date: '2024-02-28', type: 'expense', categoryId: null, accountId: 'bank', amount: 100 },
    { id: '4', date: '2024-02-28', type: 'expense', accountId: 'bank', amount: 200 },
    { id: '5', date: '2024-02-28', type: 'income', categoryId: 'pay', accountId: 'bank', amount: 10000 },
    { id: '6', date: '2024-02-28', type: 'expense', categoryId: 'food', accountId: 'fund', amount: 500 },
    { id: '7', date: '2024-03-01', type: 'expense', categoryId: 'food', accountId: 'bank', amount: 9999 }
  ]
};
vm.runInContext('S = fixture;', context);
const calc = expression => vm.runInContext(expression, context);
(async () => {
  let checked = 0;
  for (const kind of ['expense', 'income']) {
    for (const filter of [{ poolId: 'all', accountId: 'all' }, { poolId: 'cash', accountId: 'all' },
      { poolId: 'goal', accountId: 'all' }, { poolId: 'goal', accountId: 'bank' }, { poolId: 'goose', accountId: 'fund' }]) {
      context.kind = kind;
      context.filter = filter;
      const slices = calc('categoryBreakdown("2024-02", kind, filter)');
      for (const slice of slices) {
        const dataset = { month: '2024-02', kind, categoryId: slice.id, ...filter };
        // Use the actual delegated click handler, not just a filter constructed in the test.
        await handlers.click({ target: { closest(selector) { return selector === '[data-act]' ? { dataset: { act: 'category-records', ...dataset } } : null; } } });
        assert.equal(calc('ui.tab'), 'ledger');
        assert.equal(calc('ui.ledger.from'), '2024-02-01');
        assert.equal(calc('ui.ledger.to'), '2024-02-29');
        assert.equal(calc('ui.ledger.poolId'), filter.poolId);
        assert.equal(calc('filterTransactions(ui.ledger).reduce((sum, t) => sum + t.amount, 0)'), slice.value, '圆环金额必须等于对应流水合计');
        checked++;
      }
    }
  }
  assert.ok(checked >= 10);
  const single = context.donutChart([{ id: 'food', label: '<分类"测试>', value: 2100, color: '#123456' }], {
    drilldown: { month: '2024-02', kind: 'expense', poolId: 'goal', accountId: 'bank' }
  });
  assert.ok(single.includes('<circle'));
  assert.ok(single.includes('data-percent="100.0%"'));
  assert.ok(single.includes('data-act="category-records"'));
  assert.ok(single.includes('data-account-id="bank"'));
  assert.ok(single.includes('&lt;分类&quot;测试&gt;'));
  assert.ok(!single.includes('<分类'));
  assert.ok(context.donutChart([]).includes('chart-empty'));
  console.log('圆环回归测试通过：' + checked + ' 组分类金额与流水一致，覆盖月份、收支、跨池账户、未分类及单分类。');
})().catch(err => { console.error(err); process.exitCode = 1; });
