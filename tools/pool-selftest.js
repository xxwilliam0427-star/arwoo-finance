'use strict';

// Test the real API and UI against an in-memory ledger; never read or write user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
let state = {
  accounts: [
    { id: 'bank', name: '储蓄卡', pool: 'cash', type: 'bank', openingBalance: 2100, valuations: [], archived: false },
    { id: 'fund', name: '基金', pool: 'goose', type: 'fund', openingBalance: 10000,
      valuations: [{ date: '2026-03-01', value: 12000 }], archived: false }
  ],
  goals: [{ id: 'trip', name: '旅游', targetAmount: 10000 }],
  transactions: [], categories: [], settings: {}
};

const apiContext = vm.createContext({ require, __dirname: root, Buffer, console });
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
vm.runInContext(serverSource.slice(0, serverSource.indexOf('const server = http.createServer')), apiContext);
apiContext.loadState = () => structuredClone(state);
apiContext.writeState = next => { state = structuredClone(next); };
apiContext.readBody = async req => req.body;

const elements = new Map();
function element(key) {
  if (!elements.has(key)) elements.set(key, {
    innerHTML: '', textContent: '', style: {},
    classList: { add() {}, remove() {} }, addEventListener() {}, focus() {}
  });
  return elements.get(key);
}
const uiContext = vm.createContext({
  document: { querySelector: element, addEventListener() {} },
  setTimeout() {}, clearTimeout() {}, console
});
for (const name of ['core.js', 'ui.js', 'app.js']) {
  let source = fs.readFileSync(path.join(root, 'web', 'js', name), 'utf8');
  if (name === 'app.js') source = source.slice(0, source.indexOf('(async function boot()'));
  vm.runInContext(source, uiContext);
}
function sync() { uiContext.fixture = state; vm.runInContext('S = fixture;', uiContext); }
function calc(expression) { sync(); return vm.runInContext(expression, uiContext); }
async function request(method, endpoint, body = {}) {
  let response;
  const res = { writeHead(code) { assert.equal(code, 200); }, end(buf) { response = JSON.parse(buf.toString()); } };
  await apiContext.handleApi({ method, body }, res, new URL('http://localhost/api' + endpoint));
  assert.equal(response.ok, true);
  return response;
}

(async () => {
  const total = calc('totalAssets()');
  assert.equal(total, 14100);
  await request('POST', '/accounts/bank/pools', { pool: 'goose' });
  await request('POST', '/accounts/bank/pools', { pool: 'goal', goalId: 'trip' });
  await request('POST', '/accounts/bank/pools', { pool: 'goal', goalId: 'trip' });
  await request('POST', '/accounts/bank/pools', { pool: 'cash' });
  assert.equal(state.accounts.length, 2);
  assert.equal(state.accounts[0].poolLinks.length, 2);
  assert.equal(calc('totalAssets()'), total);
  assert.equal(calc('poolTotal("cash")'), 2100);
  assert.equal(calc('poolTotal("goal")'), 2100);
  assert.equal(calc('poolTotal("goose")'), 14100);
  assert.equal(calc('goalProgress(S.goals[0]).saved'), 2100);
  assert.equal(calc('accountsOfPool("goal").length'), 1);

  // Transactions added in any pool update the same account everywhere.
  await request('POST', '/transactions', { type: 'income', date: '2026-03-02', amount: 500, accountId: 'bank' });
  assert.equal(calc('poolTotal("cash")'), 2600);
  assert.equal(calc('poolTotal("goal")'), 2600);
  assert.equal(calc('poolTotal("goose")'), 14600);
  assert.equal(calc('totalAssets()'), total + 500);
  assert.equal(calc('monthSummary("2026-03", { poolId: "goal" }).income'), 500);
  assert.equal(calc('filterTransactions({poolId: "goal"}).length'), 1);
  assert.equal(calc('assetSeries(1, "2026-03", {poolId: "goal"})[0].value'), 2600);

  // A goose account retains its market valuation even when also shown in cash.
  await request('POST', '/accounts/fund/pools', { pool: 'cash' });
  assert.equal(calc('poolTotal("cash")'), 14600);
  assert.equal(calc('totalAssets()'), 14600);
  const html = calc('viewAccounts()');
  for (const pool of ['cash', 'goal', 'goose']) assert.ok(html.includes('data-act="add-pool-acc" data-pool="' + pool + '"'));
  assert.ok(html.includes('共用账户'));
  assert.ok(html.includes('data-act="unlink-pool-acc"'));

  // The UI picker sends a membership request rather than creating an account.
  sync();
  let mutation;
  uiContext.mutateReq = async (method, endpoint, body) => { mutation = { method, endpoint, body }; };
  uiContext.render = () => {};
  uiContext.toast = () => {};
  uiContext.openPoolAccountForm('goal', 'trip');
  await element('#modalOk').onclick();
  assert.equal(mutation.method, 'POST');
  assert.equal(mutation.endpoint, '/accounts/bank/pools');
  assert.equal(mutation.body.goalId, 'trip');

  await assert.rejects(request('DELETE', '/goals/trip'), /还有账户/);
  await assert.rejects(request('POST', '/accounts/bank/pools', { pool: 'invalid' }), /正确的账户池/);
  await assert.rejects(request('POST', '/accounts/bank/pools', { pool: 'goal', goalId: 'missing' }), /正确的目标/);
  await assert.rejects(request('POST', '/accounts/missing/pools', { pool: 'cash' }), /账户不存在/);
  await assert.rejects(request('DELETE', '/accounts/bank/pools', { pool: 'cash' }), /主要池/);
  await request('DELETE', '/accounts/bank/pools', { pool: 'goal' });
  assert.equal(calc('poolTotal("goal")'), 0);
  assert.equal(calc('totalAssets()'), 14600);
  assert.equal(state.transactions.length, 1);
  await request('DELETE', '/goals/trip');

  await request('PUT', '/accounts/bank', { archived: true });
  assert.equal(calc('totalAssets()'), 12000);
  assert.equal(calc('accountsOfPool("goose").length'), 1);
  await assert.rejects(request('POST', '/accounts/bank/pools', { pool: 'goal' }), /恢复/);
  await request('PUT', '/accounts/bank', { archived: false });
  assert.equal(calc('totalAssets()'), 14600);

  // Export/import round trip preserves memberships and normalizes duplicates.
  apiContext.imported = JSON.parse(JSON.stringify(state));
  const restored = vm.runInContext('ensureState(imported)', apiContext);
  assert.equal(restored.accounts[0].poolLinks.length, 1);
  state = structuredClone(restored);
  assert.equal(calc('totalAssets()'), 14600);
  await request('PUT', '/accounts/bank', { pool: 'goose' });
  assert.equal(state.accounts[0].poolLinks.length, 0);
  assert.equal(calc('totalAssets()'), 14600);
  console.log('账户跨池回归测试通过：添加、重复添加、余额同步、市值、报表、移除、归档、导入及界面入口。');
})().catch(err => { console.error(err); process.exitCode = 1; });
