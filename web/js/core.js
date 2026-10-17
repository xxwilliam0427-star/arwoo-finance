'use strict';

/* ============================================================ 全局状态 */

let S = null;                                   // 服务器返回的完整数据
let META = { pools: [], accountTypes: [] };     // 池与账户类型定义

const POOL_FALLBACK = [
  { id: 'cash', name: '日常现金池', desc: '货币基金、银行活期，随取随用' },
  { id: 'goal', name: '中短期目标池', desc: '房租、旅游、买车等目标，专款专用' },
  { id: 'goose', name: '长期金鹅池', desc: '长期投资账户，让金鹅慢慢长大' }
];

const TYPE_FALLBACK = [
  { id: 'bank', name: '银行卡' },
  { id: 'deposit', name: '银行活期/定期' },
  { id: 'money_fund', name: '货币基金' },
  { id: 'fund', name: '基金' },
  { id: 'stock', name: '股票' },
  { id: 'other', name: '其他' }
];

const TX_TYPES = {
  expense: { name: '支出', cls: 'tx-expense' },
  income: { name: '收入', cls: 'tx-income' },
  transfer: { name: '调拨', cls: 'tx-transfer' },
  adjust: { name: '校准', cls: 'tx-adjust' }
};

/* ============================================================ 小工具 */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(cents, opts) {
  const o = opts || {};
  if (cents === null || cents === undefined || !isFinite(cents)) return '—';
  const n = Math.round(cents);
  const neg = n < 0;
  const abs = Math.abs(n);
  const body = (abs / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const symbol = o.symbol === false ? '' : '¥';
  const sign = neg ? '-' : (o.sign ? '+' : '');
  return sign + symbol + body;
}

function fmtShort(cents) {
  if (cents === null || cents === undefined || !isFinite(cents)) return '—';
  const n = cents / 100;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 10000) return sign + (abs / 10000).toFixed(abs >= 100000 ? 0 : 1) + '万';
  return sign + abs.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function parseMoney(text) {
  if (text === null || text === undefined) return NaN;
  const clean = String(text).replace(/[¥,\s￥]/g, '');
  if (clean === '' || clean === '-' || clean === '.') return NaN;
  const n = Number(clean);
  if (!isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function todayIso() {
  return isoOf(new Date());
}

function isoOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function thisMonthKey() {
  return todayIso().slice(0, 7);
}

function monthKeyOf(iso) {
  return String(iso || '').slice(0, 7);
}

function monthLabel(key) {
  if (!key) return '';
  return key.slice(0, 4) + '年' + Number(key.slice(5, 7)) + '月';
}

function monthShort(key) {
  if (!key) return '';
  return Number(key.slice(5, 7)) + '月';
}

function monthEndIso(key) {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return isoOf(new Date(y, m, 0));
}

function shiftMonth(key, delta) {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + delta;
  const d = new Date(y, m, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function lastMonths(n, endKey) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(endKey, -i));
  return out;
}

function daysInMonth(key) {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return new Date(y, m, 0).getDate();
}

function dateLabel(iso) {
  return iso ? iso.slice(5).replace('-', '/') : '';
}

function uid() {
  return 'tmp_' + Math.random().toString(36).slice(2, 10);
}

/* ============================================================ 元数据查询 */

function pools() { return META.pools.length ? META.pools : POOL_FALLBACK; }
function accountTypes() { return META.accountTypes.length ? META.accountTypes : TYPE_FALLBACK; }
function poolById(id) { return pools().find(p => p.id === id) || { id: id, name: id, desc: '' }; }
function typeName(id) { const t = accountTypes().find(x => x.id === id); return t ? t.name : '其他'; }
function categoryById(id) { return (S.categories || []).find(c => c.id === id) || null; }
function accountById(id) { return (S.accounts || []).find(a => a.id === id) || null; }
function goalById(id) { return (S.goals || []).find(g => g.id === id) || null; }

function categoriesOf(kind) { return (S.categories || []).filter(c => c.kind === kind); }
function goalsOf(poolId) { return (S.goals || []).filter(g => g.status !== 'done' || true); }
function accountsOfPool(poolId, includeArchived) {
  return (S.accounts || []).filter(a => accountInPool(a, poolId) && (includeArchived || !a.archived));
}
function accountInPool(acc, poolId) {
  return !!acc && (acc.pool === poolId || (acc.poolLinks || []).some(link => link.pool === poolId));
}
function accountGoalId(acc) {
  return acc.pool === 'goal' ? acc.goalId : ((acc.poolLinks || []).find(link => link.pool === 'goal') || {}).goalId;
}
function accountsOfGoal(goalId, includeArchived) {
  return (S.accounts || []).filter(a => accountGoalId(a) === goalId && (includeArchived || !a.archived));
}

/* ============================================================ 核心算法（全应用统一） */

/**
 * 账户的资金净流入 = Σ收入 − Σ支出 + Σ调入 − Σ调出 ± 校准差额
 * afterDate 传日期时只算「该日期之后」的流水；upto 传日期时只算「该日期（含）之前」的流水。
 */
function accountFlowSum(acc, afterDate, upto, includeAfterDate) {
  let sum = 0;
  const txs = S.transactions || [];
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i];
    if (afterDate && (t.date < afterDate || (!includeAfterDate && t.date === afterDate))) continue;
    if (upto && t.date > upto) continue;
    if (t.accountId === acc.id) {
      if (t.type === 'income') sum += t.amount;
      else if (t.type === 'expense') sum -= t.amount;
      else if (t.type === 'transfer') sum -= t.amount;
      else if (t.type === 'adjust') sum += t.amount;
    } else if (t.type === 'transfer' && t.toAccountId === acc.id) {
      sum += t.amount;
    }
  }
  return sum;
}

/**
 * 账户成本口径余额 = 期初余额 + 资金净流入
 * upto 传入 'YYYY-MM-DD' 时只统计该日期（含）之前的流水。
 */
function accountCostBalance(acc, upto) {
  return (acc.openingBalance || 0) + accountFlowSum(acc, null, upto);
}

function latestValuation(acc, upto) {
  const list = (acc.valuations || []).filter(v => !upto || v.date <= upto);
  if (!list.length) return null;
  return list[list.length - 1];
}

function valuationFlowSince(acc, valuation, upto) {
  const later = accountFlowSum(acc, valuation.date, upto);
  // 市值包含保存时已有的当日流水，之后新增、修改、删除的差额仍需计入。
  if (!Number.isInteger(valuation.flowOnDate)) return later;
  return later + accountFlowSum(acc, valuation.date, valuation.date, true) - valuation.flowOnDate;
}

/**
 * 账户口径价值：
 * - 金鹅池：以最近一次填写的市值为锚点，再加上锚点之后又投进去/取出来的钱，
 *   这样平时定投不会让总资产看起来莫名缩水，等下次更新市值时再重新校准。
 * - 其他池：直接用成本口径余额。
 */
function accountValue(acc, upto) {
  if (acc.pool === 'goose') {
    const v = latestValuation(acc, upto);
    if (v) return v.value + valuationFlowSince(acc, v, upto);
  }
  return accountCostBalance(acc, upto);
}

/** 账户当前状态：余额、成本、市值、盈亏 */
function accountStat(acc, upto) {
  const cost = accountCostBalance(acc, upto);
  const v = latestValuation(acc, upto);
  const added = v ? valuationFlowSince(acc, v, upto) : 0;
  const hasMarket = !!v;
  const market = hasMarket ? v.value + added : cost;
  return {
    cost: cost,
    market: market,
    value: market,
    hasMarket: hasMarket,
    anchor: v ? v.value : null,
    added: added,
    marketDate: v ? v.date : null,
    profit: hasMarket ? market - cost : 0,
    profitRate: (hasMarket && cost !== 0) ? (market - cost) / Math.abs(cost) : 0
  };
}

function poolTotal(poolId, upto) {
  return accountsOfPool(poolId, false).reduce((sum, a) => sum + accountValue(a, upto), 0);
}

function totalAssets(upto) {
  return (S.accounts || []).filter(a => !a.archived).reduce((sum, a) => sum + accountValue(a, upto), 0);
}

function gooseStat(upto) {
  const list = accountsOfPool('goose', false);
  let cost = 0, market = 0;
  list.forEach(a => {
    const st = accountStat(a, upto);
    cost += st.cost;
    market += st.market;
  });
  return { cost: cost, market: market, profit: market - cost, profitRate: cost !== 0 ? (market - cost) / Math.abs(cost) : 0, count: list.length };
}

function goalProgress(goal, upto) {
  const list = accountsOfGoal(goal.id, false);
  const saved = list.reduce((sum, a) => sum + accountValue(a, upto), 0);
  const target = goal.targetAmount || 0;
  return {
    goal: goal,
    accounts: list,
    saved: saved,
    target: target,
    remaining: Math.max(0, target - saved),
    ratio: target > 0 ? Math.max(0, saved / target) : 0,
    done: target > 0 && saved >= target
  };
}

/* 流水筛选 */

function filterTransactions(f) {
  const q = (f.keyword || '').trim().toLowerCase();
  return (S.transactions || []).filter(t => {
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.categoryId && (f.categoryId === '__none__' ? !!t.categoryId : t.categoryId !== f.categoryId)) return false;
    if (f.accountId) {
      if (t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
    }
    if (f.poolId && f.poolId !== 'all') {
      const a1 = accountById(t.accountId);
      const a2 = t.toAccountId ? accountById(t.toAccountId) : null;
      const hit = accountInPool(a1, f.poolId) || accountInPool(a2, f.poolId);
      if (!hit) return false;
    }
    if (q) {
      const cat = categoryById(t.categoryId);
      const a1 = accountById(t.accountId);
      const a2 = t.toAccountId ? accountById(t.toAccountId) : null;
      const hay = [t.note, cat ? cat.name : '', a1 ? a1.name : '', a2 ? a2.name : '', t.date].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }).sort((x, y) => (x.date === y.date ? (y.createdAt || '').localeCompare(x.createdAt || '') : y.date.localeCompare(x.date)));
}

/* 报表计算 */

function txBelongsTo(t, filter) {
  if (!filter || (!filter.poolId || filter.poolId === 'all') && (!filter.accountId || filter.accountId === 'all')) return true;
  if (filter.accountId && filter.accountId !== 'all') {
    return t.accountId === filter.accountId || t.toAccountId === filter.accountId;
  }
  const a1 = accountById(t.accountId);
  const a2 = t.toAccountId ? accountById(t.toAccountId) : null;
  return accountInPool(a1, filter.poolId) || accountInPool(a2, filter.poolId);
}

function monthSummary(monthKey, filter) {
  let income = 0, expense = 0, count = 0;
  (S.transactions || []).forEach(t => {
    if (monthKeyOf(t.date) !== monthKey) return;
    if (!txBelongsTo(t, filter)) return;
    if (t.type === 'income') { income += t.amount; count++; }
    else if (t.type === 'expense') { expense += t.amount; count++; }
  });
  return { income: income, expense: expense, net: income - expense, count: count };
}

function categoryBreakdown(monthKey, kind, filter) {
  const map = {};
  (S.transactions || []).forEach(t => {
    if (t.type !== kind) return;
    if (monthKey && monthKeyOf(t.date) !== monthKey) return;
    if (!txBelongsTo(t, filter)) return;
    const id = t.categoryId || '__none__';
    map[id] = (map[id] || 0) + t.amount;
  });
  const items = Object.keys(map).map(id => {
    const c = categoryById(id);
    return {
      id: id,
      label: c ? c.name : '未分类',
      value: map[id],
      color: c ? c.color : '#8d9bb5'
    };
  }).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
  return items;
}

function monthlyFlowSeries(n, endKey, filter) {
  return lastMonths(n, endKey).map(key => {
    const m = monthSummary(key, filter);
    return { key: key, label: monthShort(key), income: m.income, expense: m.expense, net: m.net };
  });
}

function assetSeries(n, endKey, filter) {
  const accounts = (S.accounts || []).filter(a => {
    if (a.archived) return false;
    if (filter && filter.poolId && filter.poolId !== 'all') return accountInPool(a, filter.poolId);
    return true;
  }).filter(a => {
    if (filter && filter.accountId && filter.accountId !== 'all') return a.id === filter.accountId;
    return true;
  });
  return lastMonths(n, endKey).map(key => {
    const end = monthEndIso(key);
    const value = accounts.reduce((sum, a) => sum + accountValue(a, end), 0);
    return { key: key, label: monthShort(key), value: value };
  });
}

/* ============================================================ 与服务器通信 */

async function api(method, path, body) {
  const opts = { method: method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    throw new Error((data && data.error) || ('请求失败（' + res.status + '）'));
  }
  return data;
}

function applyState(next) {
  if (!next) return;
  if (next.meta) {
    META = { pools: next.meta.pools || [], accountTypes: next.meta.accountTypes || [] };
  }
  S = next;
  if (!S.transactions) S.transactions = [];
  if (!S.accounts) S.accounts = [];
  if (!S.goals) S.goals = [];
  if (!S.categories) S.categories = [];
}

async function refresh() {
  const data = await api('GET', '/state');
  applyState(data);
  return S;
}

/** 所有写操作的统一入口：成功后会刷新界面 */
async function mutateReq(method, path, body) {
  const data = await api(method, path, body);
  if (data && data.state) applyState(data.state);
  else await refresh();
  return data;
}
