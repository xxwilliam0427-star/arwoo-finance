'use strict';

// Exercise real API handlers and browser balance calculations in memory only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const server = vm.createContext({ require, __dirname: root, Buffer, console });
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
vm.runInContext(source.slice(0, source.indexOf('const server = http.createServer')), server);
let state = {
  accounts: [
    { id: 'fund', pool: 'goose', name: '基金', type: 'fund', openingBalance: 10000, valuations: [] },
    { id: 'wechat', pool: 'cash', name: '微信', type: 'bank', openingBalance: 0, valuations: [] },
    { id: 'alipay', pool: 'cash', name: '支付宝', type: 'bank', openingBalance: 0, valuations: [] }
  ], transactions: [], goals: [], categories: [], settings: {}
};
server.loadState = () => server.ensureState(structuredClone(state));
server.writeState = next => { state = structuredClone(next); };
server.readBody = async req => req.body;
const browser = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'web/js/core.js'), 'utf8'), browser);
function calc(expression) {
  browser.fixture = structuredClone(state);
  vm.runInContext('S = fixture;', browser);
  return vm.runInContext(expression, browser);
}
async function request(method, endpoint, body = {}) {
  await server.handleApi({ method, body }, { writeHead(code) { assert.equal(code, 200); }, end() {} }, new URL('http://localhost/api' + endpoint));
}
async function transfer(amount, toAccountId, date = '2026-10-17') {
  await request('POST', '/transactions', { type: 'transfer', accountId: 'fund', toAccountId, amount, date });
  return state.transactions[state.transactions.length - 1].id;
}
function balance(expected, total = 12000) {
  assert.equal(calc('accountValue(accountById("fund"))'), expected);
  assert.equal(calc('accountStat(accountById("fund")).market'), expected);
  assert.equal(calc('poolTotal("goose")'), expected);
  assert.equal(calc('totalAssets()'), total, '调拨后总资产守恒');
}

(async () => {
  await request('POST', '/transactions', { type: 'expense', accountId: 'fund', amount: 500, date: '2026-10-17' });
  await request('POST', '/accounts/fund/valuation', { marketValue: 12000, date: '2026-10-17' });
  assert.equal(state.accounts[0].valuations[0].flowOnDate, -500);
  balance(12000);
  const first = await transfer(900, 'wechat');
  const second = await transfer(700, 'alipay');
  balance(10400);
  assert.equal(calc('accountValue(accountById("wechat"))'), 900);
  assert.equal(calc('accountValue(accountById("alipay"))'), 700);
  assert.equal(calc('accountStat(accountById("fund")).added'), -1600);
  assert.equal(calc('accountValue(accountById("fund"), "2026-10-17")'), 10400);

  await request('PUT', '/transactions/' + first, { amount: 600 });
  balance(10700);
  await request('DELETE', '/transactions/' + second);
  balance(11400);
  await request('POST', '/accounts/fund/valuation', { marketValue: 11400, date: '2026-10-17' });
  balance(11400);
  assert.equal(calc('accountStat(accountById("fund")).added'), 0, '重估后不重复扣除已有流水');
  await transfer(200, 'wechat');
  balance(11200);
  await transfer(300, 'wechat', '2026-10-18');
  balance(10900);
  assert.equal(calc('accountValue(accountById("fund"), "2026-10-17")'), 11200);

  // Incoming transfers and all other cash flows use the same baseline logic.
  await request('POST', '/transactions', { type: 'transfer', accountId: 'wechat', toAccountId: 'fund', amount: 100, date: '2026-10-17' });
  balance(11000);
  await request('POST', '/transactions', { type: 'income', accountId: 'fund', amount: 50, date: '2026-10-17' });
  balance(11050, 12050);
  await request('POST', '/transactions', { type: 'adjust', accountId: 'fund', amount: -20, date: '2026-10-17' });
  balance(11030, 12030);
  // Transactions predating the valuation remain included in its market value.
  await request('POST', '/transactions', { type: 'expense', accountId: 'fund', amount: 100, date: '2026-10-16' });
  balance(11030, 12030);

  const imported = server.ensureState(JSON.parse(JSON.stringify(state)));
  assert.equal(imported.accounts[0].valuations[0].flowOnDate, -1100);
  // Older backups retain their value when loaded, then correctly track new flows.
  delete state.accounts[0].valuations[0].flowOnDate;
  const legacyValue = calc('accountValue(accountById("fund"))');
  const legacyTotal = calc('totalAssets()');
  await transfer(100, 'wechat');
  balance(legacyValue - 100, legacyTotal);
  assert.ok(Number.isInteger(state.accounts[0].valuations[0].flowOnDate));
  console.log('市值与调拨回归测试通过：同日多笔转出、转入、编辑、删除、重新估值、跨日及旧备份兼容。');
})().catch(err => { console.error(err); process.exitCode = 1; });
