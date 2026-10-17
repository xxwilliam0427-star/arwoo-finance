'use strict';

/**
 * Arwoo 财务助手 —— 本地零依赖服务
 * 只用 Node 内置模块，不联网、不安装任何依赖。
 * 数据保存在 data/finance.json，每次写操作前自动备份到 data/backups/。
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec, execFile, spawn } = require('child_process');

const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'web');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'finance.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const LAN_FILE = path.join(DATA_DIR, 'lan.json');

const BASE_PORT = 8787;
const MAX_PORT_TRIES = 20;
const MAX_BACKUPS = 200;

const POOLS = [
  { id: 'cash', name: '日常现金池', desc: '货币基金、银行活期，随取随用' },
  { id: 'goal', name: '中短期目标池', desc: '房租、旅游、买车等目标，专款专用' },
  { id: 'goose', name: '长期金鹅池', desc: '长期投资账户，让金鹅慢慢长大' }
];

const ACCOUNT_TYPES = [
  { id: 'bank', name: '银行卡' },
  { id: 'deposit', name: '银行活期/定期' },
  { id: 'money_fund', name: '货币基金' },
  { id: 'fund', name: '基金' },
  { id: 'stock', name: '股票' },
  { id: 'other', name: '其他' }
];

const EXPENSE_CATEGORIES = ['餐饮', '交通', '购物', '居住', '日用', '娱乐', '医疗', '教育', '通讯', '人情往来', '旅行', '其他'];
const INCOME_CATEGORIES = ['工资', '奖金', '投资理财收益', '副业', '红包', '报销', '其他'];
const CATEGORY_COLORS = ['#4f7ef7', '#f2994a', '#27ae60', '#eb5757', '#9b51e0', '#2d9cdb', '#f2c94c', '#56ccf2', '#bb6bd9', '#6fcf97', '#f178b6', '#8d9bb5'];

/* ------------------------------------------------------------------ utils */

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function nowIso() {
  return new Date().toISOString();
}

function isoOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function todayIso() {
  return isoOf(new Date());
}

function addMonthsToDate(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  return x;
}

function stamp() {
  const d = new Date();
  const p = (n, l) => String(n).padStart(l || 2, '0');
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + p(d.getMilliseconds(), 3)
  );
}

function yuan(x) {
  return Math.round(x * 100);
}

function fail(msg, status) {
  const e = new Error(msg);
  e.status = status || 400;
  throw e;
}

function isPlainInt(n) {
  return typeof n === 'number' && Number.isInteger(n);
}

function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00').getTime());
}

/* -------------------------------------------------------------- default state */

function defaultState() {
  const categories = [];
  EXPENSE_CATEGORIES.forEach((name, i) => {
    categories.push({ id: uid('cat'), name: name, kind: 'expense', builtin: true, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] });
  });
  INCOME_CATEGORIES.forEach((name, i) => {
    categories.push({ id: uid('cat'), name: name, kind: 'income', builtin: true, color: CATEGORY_COLORS[(i + 5) % CATEGORY_COLORS.length] });
  });
  return {
    version: 1,
    goals: [],
    accounts: [],
    categories: categories,
    transactions: [],
    settings: { createdAt: nowIso() }
  };
}

function accountFlowOnDate(state, accountId, date) {
  return state.transactions.reduce((sum, t) => {
    if (t.date !== date) return sum;
    if (t.accountId === accountId) {
      if (t.type === 'income' || t.type === 'adjust') return sum + t.amount;
      if (t.type === 'expense' || t.type === 'transfer') return sum - t.amount;
    } else if (t.type === 'transfer' && t.toAccountId === accountId) return sum + t.amount;
    return sum;
  }, 0);
}

function ensureState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const s = {
    version: 1,
    goals: Array.isArray(raw.goals) ? raw.goals : [],
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    categories: (Array.isArray(raw.categories) && raw.categories.length) ? raw.categories : base.categories,
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    settings: (raw.settings && typeof raw.settings === 'object') ? raw.settings : { createdAt: nowIso() }
  };
  s.accounts.forEach(a => {
    if (!Array.isArray(a.valuations)) a.valuations = [];
    // 旧备份没有当日流水快照：保持原有市值口径，并在下次写入前固定基线。
    a.valuations.forEach(v => {
      if (!Number.isInteger(v.flowOnDate)) v.flowOnDate = accountFlowOnDate(s, a.id, v.date);
    });
    if (a.archived !== true) a.archived = false;
    if (typeof a.openingBalance !== 'number' || !Number.isInteger(a.openingBalance)) a.openingBalance = 0;
    const linkedPools = new Set();
    a.poolLinks = (Array.isArray(a.poolLinks) ? a.poolLinks : []).filter(link => {
      if (!link || link.pool === a.pool || !POOLS.some(p => p.id === link.pool) || linkedPools.has(link.pool)) return false;
      linkedPools.add(link.pool);
      return true;
    }).map(link => ({
      pool: link.pool,
      goalId: link.pool === 'goal' && s.goals.some(g => g.id === link.goalId) ? link.goalId : null
    }));
  });
  return s;
}

function withMeta(state) {
  return Object.assign({}, state, { meta: { pools: POOLS, accountTypes: ACCOUNT_TYPES } });
}

/* -------------------------------------------------------------- persistence */

function loadState() {
  if (!fs.existsSync(DATA_FILE)) return defaultState();
  try {
    return ensureState(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch (e) {
    const broken = DATA_FILE + '.broken-' + stamp();
    try { fs.copyFileSync(DATA_FILE, broken); } catch (_) { /* ignore */ }
    return defaultState();
  }
}

function pruneBackups() {
  let files;
  try {
    files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json'));
  } catch (e) {
    return;
  }
  if (files.length <= MAX_BACKUPS) return;
  files.sort();
  files.slice(0, files.length - MAX_BACKUPS).forEach(f => {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) { /* ignore */ }
  });
}

function backupCurrent() {
  if (!fs.existsSync(DATA_FILE)) return null;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const name = 'finance-' + stamp() + '.json';
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, name));
    pruneBackups();
    return name;
  } catch (e) {
    console.error('备份失败：', e.message);
    return null;
  }
}

function writeState(state, opts) {
  const options = opts || {};
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (options.backup !== false) backupCurrent();
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
  return state;
}

function mutate(fn) {
  const state = loadState();
  const result = fn(state);
  writeState(state);
  return result === undefined ? state : result;
}

/* -------------------------------------------------------------- validation */

function pickAccount(state, id) {
  const a = state.accounts.find(x => x.id === id);
  if (!a) fail('账户不存在');
  return a;
}

function normAccountInput(state, input, existing) {
  const name = String((input.name !== undefined ? input.name : (existing ? existing.name : '')) || '').trim();
  if (!name) fail('账户名称不能为空');
  if (name.length > 40) fail('账户名称太长了');

  const pool = input.pool !== undefined ? input.pool : (existing ? existing.pool : '');
  if (!POOLS.some(p => p.id === pool)) fail('请选择正确的账户池');

  const type = input.type !== undefined ? input.type : (existing ? existing.type : 'bank');
  if (!ACCOUNT_TYPES.some(t => t.id === type)) fail('账户类型不正确');

  let goalId = input.goalId !== undefined ? (input.goalId || null) : (existing ? existing.goalId : null);
  if (goalId) {
    if (pool !== 'goal') fail('只有中短期目标池的账户才能挂到某个目标下');
    if (!state.goals.some(g => g.id === goalId)) fail('目标不存在');
  }

  let openingBalance = existing ? existing.openingBalance : 0;
  if (input.openingBalance !== undefined) {
    if (!isPlainInt(input.openingBalance)) fail('期初余额格式不正确');
    openingBalance = input.openingBalance;
  }

  const note = String((input.note !== undefined ? input.note : (existing ? existing.note : '')) || '').slice(0, 200);
  return { name, pool, type, goalId, openingBalance, note };
}

function normTransactionInput(state, input, existing) {
  const type = input.type !== undefined ? input.type : (existing ? existing.type : 'expense');
  if (!['expense', 'income', 'transfer', 'adjust'].includes(type)) fail('流水类型不正确');

  const date = input.date !== undefined ? input.date : (existing ? existing.date : '');
  if (!isDateStr(date)) fail('请选择正确的日期');

  let amount = input.amount !== undefined ? input.amount : (existing ? existing.amount : null);
  if (!isPlainInt(amount)) fail('金额格式不正确');
  if (type === 'adjust') {
    if (amount === 0) fail('校准差额为 0，无需校准');
  } else if (amount <= 0) {
    fail('金额必须大于 0');
  }
  if (Math.abs(amount) > 1000000000000) fail('金额超出范围');

  const accountId = input.accountId !== undefined ? input.accountId : (existing ? existing.accountId : null);
  if (!accountId) fail('请选择账户');
  pickAccount(state, accountId);

  let toAccountId = null;
  if (type === 'transfer') {
    toAccountId = input.toAccountId !== undefined ? input.toAccountId : (existing ? existing.toAccountId : null);
    if (!toAccountId) fail('请选择转入账户');
    if (toAccountId === accountId) fail('转出和转入不能是同一个账户');
    pickAccount(state, toAccountId);
  }

  let categoryId = null;
  if (type === 'expense' || type === 'income') {
    categoryId = input.categoryId !== undefined ? (input.categoryId || null) : (existing ? existing.categoryId : null);
    if (categoryId) {
      const c = state.categories.find(x => x.id === categoryId);
      if (!c) fail('分类不存在');
      if (c.kind !== type) fail('分类类型与流水类型不匹配');
    } else {
      const fallback = state.categories.find(x => x.kind === type && x.name === '其他') || state.categories.find(x => x.kind === type);
      categoryId = fallback ? fallback.id : null;
    }
  }

  let goalId = input.goalId !== undefined ? (input.goalId || null) : (existing ? existing.goalId : null);
  if (goalId && !state.goals.some(g => g.id === goalId)) goalId = null;

  const note = String((input.note !== undefined ? input.note : (existing ? existing.note : '')) || '').slice(0, 200);

  return { type, date, amount, accountId, toAccountId, categoryId, goalId, note };
}

/* -------------------------------------------------------------- sample data */

function buildSampleState() {
  const s = defaultState();
  const cid = (kind, name) => {
    const c = s.categories.find(x => x.kind === kind && x.name === name);
    return c ? c.id : null;
  };
  const today = new Date();
  const goals = {};
  const accounts = {};

  function addGoal(name, targetYuan, dueDate, note) {
    const g = {
      id: uid('goal'), name: name, targetAmount: yuan(targetYuan), dueDate: dueDate,
      note: note || '', status: 'active', createdAt: nowIso()
    };
    s.goals.push(g);
    return g;
  }

  function addAccount(name, type, pool, opts) {
    const o = opts || {};
    const a = {
      id: uid('acc'), name: name, type: type, pool: pool, goalId: o.goalId || null,
      openingBalance: yuan(o.opening || 0),
      marketValue: null, marketValueDate: null, valuations: [],
      note: o.note || '', archived: false, createdAt: nowIso()
    };
    if (o.marketValue !== undefined && o.marketValue !== null) {
      a.marketValue = yuan(o.marketValue);
      a.marketValueDate = todayIso();
      a.valuations.push({ date: todayIso(), value: a.marketValue });
    }
    s.accounts.push(a);
    return a;
  }

  const gRent = addGoal('房租', 12000, isoOf(addMonthsToDate(today, 6)), '押一付三备用金');
  const gTrip = addGoal('旅游计划', 20000, isoOf(addMonthsToDate(today, 8)), '明年春天的旅行');
  const gCar = addGoal('买车计划', 150000, isoOf(addMonthsToDate(today, 36)), '慢慢攒，不着急');

  const aSalary = addAccount('招商银行储蓄卡', 'bank', 'cash', { opening: 8000, note: '工资卡' });
  const aYuEbao = addAccount('余额宝', 'money_fund', 'cash', { opening: 6000, note: '日常零钱' });
  const aRentCard = addAccount('房租专用卡', 'bank', 'goal', { goalId: gRent.id, opening: 2000 });
  const aTrip = addAccount('旅游基金', 'fund', 'goal', { goalId: gTrip.id, opening: 3000, note: '债券基金，稳稳的' });
  const aCar = addAccount('买车计划·货币基金', 'money_fund', 'goal', { goalId: gCar.id, opening: 5000 });
  const aIndex = addAccount('指数基金定投', 'fund', 'goose', { opening: 45000, marketValue: 55800, note: '沪深300 + 中证500' });
  const aStock = addAccount('股票账户', 'stock', 'goose', { opening: 20000, marketValue: 18600 });

  goals.rent = gRent;
  accounts.salary = aSalary;

  const t = todayIso();

  for (let back = 3; back >= 0; back--) {
    const base = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const y = base.getFullYear();
    const m = base.getMonth();
    const at = (d) => isoOf(new Date(y, m, d));

    const push = (type, amountYuan, day, account, extra) => {
      const e = extra || {};
      const date = at(day);
      if (date > t) return;
      s.transactions.push({
        id: uid('tx'), type: type, amount: yuan(amountYuan), date: date,
        accountId: account.id, toAccountId: e.to ? e.to.id : null,
        categoryId: e.cat || null, goalId: e.goal || null,
        note: e.note || '', createdAt: nowIso()
      });
    };

    push('income', 18000, 10, aSalary, { cat: cid('income', '工资'), note: '月薪' });
    push('income', 45 + back * 4, 20, aYuEbao, { cat: cid('income', '投资理财收益'), note: '货币基金收益' });

    push('expense', 3000, 12, aSalary, { cat: cid('expense', '居住'), note: '房租' });
    push('expense', 520 + back * 30, 6, aSalary, { cat: cid('expense', '餐饮'), note: '日常吃饭' });
    push('expense', 380 + back * 20, 16, aSalary, { cat: cid('expense', '餐饮') });
    push('expense', 240, 22, aSalary, { cat: cid('expense', '交通'), note: '地铁 / 打车' });
    push('expense', 760 + back * 60, 18, aSalary, { cat: cid('expense', '购物') });
    push('expense', 180, 9, aSalary, { cat: cid('expense', '日用') });
    push('expense', 99, 5, aSalary, { cat: cid('expense', '通讯'), note: '手机套餐' });
    if (back % 2 === 0) push('expense', 300, 25, aSalary, { cat: cid('expense', '娱乐'), note: '电影 / 演出' });

    push('transfer', 3000, 11, aSalary, { to: aRentCard, note: '房租备用金' });
    push('transfer', 1000, 11, aSalary, { to: aTrip, note: '旅游计划定投' });
    push('transfer', 3000, 11, aSalary, { to: aCar, note: '买车计划定投' });
    push('transfer', 2000, 11, aSalary, { to: aIndex, note: '指数基金定投' });
  }

  s.settings = { createdAt: nowIso(), seededAt: nowIso() };
  return s;
}

/* -------------------------------------------------------------- api helpers */

/* ---------------------------------------------------------- 识别引擎管理
   首选 RapidOCR（离线深度模型，中文准得多）；装不上才退回 Windows 自带 OCR。
   RapidOCR 的模型加载要 3 秒左右，所以跑一个常驻进程，之后每张图只要零点几秒。 */

const OCR_SCRIPT = path.join(__dirname, 'tools', 'ocr_rapid.py');

let ocrProc = null;
let ocrReady = false;
let ocrBuf = '';
let ocrErrBuf = '';
let ocrPending = null;   // { resolve, timer }
let ocrQueue = [];
let ocrStarting = false;
let ocrStatus = { engine: 'unknown', available: false, message: '还没开始识别' };
let ocrIdleTimer = null;
const OCR_IDLE_MS = 10 * 60 * 1000;

/** 十分钟没人用就让引擎退出，别一直占着几百兆内存；下次识别会自动再起来 */
function scheduleOcrIdleShutdown() {
  if (ocrIdleTimer) clearTimeout(ocrIdleTimer);
  ocrIdleTimer = setTimeout(() => {
    if (ocrPending || ocrQueue.length || !ocrProc) return;
    killOcrWorker();
    ocrStatus = { engine: 'rapidocr', available: false, message: '识别引擎已休眠，下次识别会自动启动' };
  }, OCR_IDLE_MS);
  if (ocrIdleTimer.unref) ocrIdleTimer.unref();
}

function venvPython() {
  const win = path.join(__dirname, 'tools', 'ocr-env', 'Scripts', 'python.exe');
  const nix = path.join(__dirname, 'tools', 'ocr-env', 'bin', 'python3');
  if (fs.existsSync(win)) return win;
  if (fs.existsSync(nix)) return nix;
  return null;
}

function pythonExe() {
  return venvPython() || (process.platform === 'win32' ? 'python' : 'python3');
}

function killOcrWorker() {
  ocrReady = false;
  ocrStarting = false;
  ocrBuf = '';
  if (ocrPending) {
    clearTimeout(ocrPending.timer);
    const p = ocrPending;
    ocrPending = null;
    p.resolve({ ok: false, error: '识别进程已退出' });
  }
  if (ocrProc) {
    try { ocrProc.kill(); } catch (e) { /* ignore */ }
    ocrProc = null;
  }
}

function handleOcrLine(line) {
  let msg = null;
  try { msg = JSON.parse(line); } catch (e) { return; }
  if (msg.ready) {
    ocrReady = true;
    ocrStarting = false;
    ocrStatus = { engine: 'rapidocr', available: true, message: '正在使用 RapidOCR（离线高精度）' };
    return;
  }
  if (msg.done === undefined) return;
  const pending = ocrPending;
  ocrPending = null;
  if (pending) {
    clearTimeout(pending.timer);
    pending.resolve(msg.done
      ? { ok: true }
      : { ok: false, error: msg.error || '识别失败' });
  }
  pumpOcrQueue();
  scheduleOcrIdleShutdown();
}

function ensureOcrWorker() {
  if (ocrProc && ocrReady) return true;
  if (ocrStarting) return false;
  if (!fs.existsSync(OCR_SCRIPT)) {
    ocrStatus = { engine: 'windows', available: false, message: '没找到 RapidOCR 脚本，暂时用系统自带识别' };
    return false;
  }
  const py = pythonExe();
  ocrStarting = true;
  ocrStatus = { engine: 'rapidocr', available: false, message: '正在启动识别引擎…' };
  ocrBuf = '';
  ocrErrBuf = '';
  let proc;
  try {
    proc = spawn(py, ['-u', OCR_SCRIPT, '--serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    ocrStarting = false;
    ocrStatus = { engine: 'windows', available: false, message: '启动识别引擎失败：' + e.message };
    return false;
  }
  ocrProc = proc;

  proc.stdout.on('data', chunk => {
    ocrBuf += chunk.toString('utf8');
    let idx;
    while ((idx = ocrBuf.indexOf('\n')) >= 0) {
      const line = ocrBuf.slice(0, idx).trim();
      ocrBuf = ocrBuf.slice(idx + 1);
      if (line) handleOcrLine(line);
    }
  });
  proc.stderr.on('data', chunk => {
    ocrErrBuf = (ocrErrBuf + chunk.toString('utf8')).slice(-4000);
  });
  proc.on('error', err => {
    ocrStarting = false;
    ocrStatus = { engine: 'windows', available: false, message: '识别引擎启动失败：' + err.message };
    killOcrWorker();
  });
  proc.on('exit', code => {
    const wasReady = ocrReady;
    killOcrWorker();
    if (!wasReady) {
      ocrStatus = {
        engine: 'windows',
        available: false,
        message: 'RapidOCR 没能启动（可能需要先运行 tools\\安装识别引擎.bat），暂时用系统自带识别'
      };
    } else if (code !== 0) {
      ocrStatus = { engine: 'rapidocr', available: true, message: '识别引擎重启中' };
    }
  });
  return false;
}

function runRapidOcr(imagePath, outPath) {
  return new Promise(resolve => {
    if (ocrProc && ocrReady) {
      ocrQueue.push({ imagePath: imagePath, outPath: outPath, resolve: resolve });
      pumpOcrQueue();
      return;
    }
    if (!ensureOcrWorker() && !ocrStarting) {
      return resolve({ ok: false, error: ocrStatus.message });
    }
    // 等引擎就绪（最多 60 秒）
    const started = Date.now();
    const wait = setInterval(() => {
      if (ocrProc && ocrReady) {
        clearInterval(wait);
        ocrQueue.push({ imagePath: imagePath, outPath: outPath, resolve: resolve });
        pumpOcrQueue();
      } else if (!ocrStarting && !ocrProc) {
        clearInterval(wait);
        resolve({ ok: false, error: ocrStatus.message });
      } else if (Date.now() - started > 60000) {
        clearInterval(wait);
        resolve({ ok: false, error: '识别引擎启动超时' });
      }
    }, 120);
  });
}

function pumpOcrQueue() {
  if (ocrPending || !ocrProc || !ocrReady) return;
  const job = ocrQueue.shift();
  if (!job) return;
  const timer = setTimeout(() => {
    const p = ocrPending;
    ocrPending = null;
    killOcrWorker();
    if (p) p.resolve({ ok: false, error: '识别超时' });
    ensureOcrWorker();
    pumpOcrQueue();
  }, 45000);
  ocrPending = { resolve: job.resolve, timer: timer, outPath: job.outPath };
  try {
    ocrProc.stdin.write(JSON.stringify({ image: job.imagePath, out: job.outPath }) + '\n');
  } catch (e) {
    clearTimeout(timer);
    ocrPending = null;
    job.resolve({ ok: false, error: '写入识别进程失败：' + e.message });
  }
}

/** 读识别结果文件 */
function readOcrOut(outPath, engineName) {
  try {
    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      if (!parsed.engine) parsed.engine = engineName;
      return parsed;
    }
  } catch (e) { /* ignore */ }
  return null;
}

/** 兜底：Windows 自带的 OCR 引擎 */
function runWindowsOcr(imagePath, outPath) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') {
      return resolve({ ok: false, error: '当前系统没有内置的图片文字识别能力' });
    }
    const script = path.join(__dirname, 'tools', 'ocr.ps1');
    if (!fs.existsSync(script)) {
      return resolve({ ok: false, error: '找不到识别脚本 tools/ocr.ps1' });
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ImagePath', imagePath, '-OutPath', outPath],
      { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
      err => {
        const parsed = readOcrOut(outPath, 'windows-ocr');
        if (parsed && typeof parsed === 'object') return resolve(parsed);
        resolve({ ok: false, error: err ? ('识别进程出错：' + err.message) : '识别没有返回结果' });
      }
    );
  });
}

/** 一张图走完整流程：先 RapidOCR，不行再退 Windows OCR */
async function recognizeImage(imagePath, outPath) {
  let result = null;
  try {
    const r = await runRapidOcr(imagePath, outPath);
    if (r && r.ok) {
      const parsed = readOcrOut(outPath, 'rapidocr');
      if (parsed && parsed.ok) result = parsed;
    } else if (r && r.error) {
      result = { ok: false, error: r.error };
    }
  } catch (e) {
    result = { ok: false, error: e.message };
  }
  if (result && result.ok) return result;

  const win = await runWindowsOcr(imagePath, outPath);
  if (win && win.ok) {
    win.fallback = true;
    win.note = 'RapidOCR 不可用，已改用系统自带识别';
    return win;
  }
  return result || win;
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', chunk => {
      if (tooBig) return;
      data += chunk;
      if (data.length > 30 * 1024 * 1024) {
        tooBig = true;
        reject(fail('请求内容过大', 413));
      }
    });
    req.on('end', () => {
      if (tooBig) return;
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(fail('请求格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

/* -------------------------------------------------------------- api routes */

async function handleApi(req, res, url) {
  const method = req.method.toUpperCase();
  const seg = url.pathname.replace(/^\/api/, '').split('/').filter(Boolean);
  const r0 = seg[0] || '';
  const r1 = seg[1] || '';
  const r2 = seg[2] || '';

  if (method === 'GET' && r0 === 'state') {
    return sendJson(res, 200, withMeta(loadState()));
  }

  if (method === 'GET' && r0 === 'backup') {
    if (!fs.existsSync(DATA_FILE)) return sendJson(res, 404, { error: '还没有任何数据' });
    const buf = fs.readFileSync(DATA_FILE);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="finance-backup-' + stamp() + '.json"',
      'Content-Length': buf.length
    });
    return res.end(buf);
  }

  if (method === 'GET' && r0 === 'backups' && !r1) {
    let files = [];
    try {
      files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const st = fs.statSync(path.join(BACKUP_DIR, f));
          return { name: f, size: st.size, mtime: st.mtime.toISOString() };
        })
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, 50);
    } catch (e) { /* 还没有备份 */ }
    return sendJson(res, 200, { backups: files });
  }

  if (method === 'POST' && r0 === 'backups' && r1 === 'restore') {
    const body = await readBody(req);
    const name = String(body.name || '');
    if (!/^finance-[\w-]+\.json$/.test(name)) fail('备份文件名不正确');
    const file = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(file)) fail('备份文件不存在', 404);
    const next = ensureState(JSON.parse(fs.readFileSync(file, 'utf8')));
    writeState(next);
    return sendJson(res, 200, { ok: true, state: withMeta(next) });
  }

  if (method === 'POST' && r0 === 'restore') {
    const body = await readBody(req);
    const incoming = body && (body.data || body.state);
    if (!incoming || typeof incoming !== 'object') fail('导入内容不正确');
    if (!Array.isArray(incoming.accounts) || !Array.isArray(incoming.transactions)) {
      fail('这个文件不是本助手的备份文件');
    }
    const next = ensureState(incoming);
    if (!Array.isArray(incoming.categories) || !incoming.categories.length) {
      next.categories = defaultState().categories;
    }
    writeState(next);
    return sendJson(res, 200, { ok: true, state: withMeta(next) });
  }

  if (method === 'POST' && r0 === 'seed') {
    const body = await readBody(req);
    const current = loadState();
    const hasData = (current.accounts || []).length > 0 || (current.transactions || []).length > 0;
    // 账本里已经有东西时，必须显式确认才允许覆盖，避免误操作把真实数据冲掉
    if (hasData && !body.force) {
      fail('账本里已经有数据了，载入示例会覆盖它。请先导出备份，或确认后再试。');
    }
    const next = buildSampleState();
    writeState(next);
    return sendJson(res, 200, { ok: true, state: withMeta(next) });
  }

  if (method === 'POST' && r0 === 'reset') {
    const body = await readBody(req);
    const current = loadState();
    const hasData = (current.accounts || []).length > 0 || (current.transactions || []).length > 0;
    if (hasData && !body.force) {
      fail('账本里还有数据，清空需要明确确认。');
    }
    const next = defaultState();
    writeState(next);
    return sendJson(res, 200, { ok: true, state: withMeta(next) });
  }

  /* ------------------------------------------------------------ 截图识别 */

  if (method === 'GET' && r0 === 'ocr' && r1 === 'status') {
    // 顺手把识别引擎预热起来，等用户选好图就差不多就绪了
    if (!ocrReady) ensureOcrWorker();
    return sendJson(res, 200, {
      engine: ocrReady ? 'rapidocr' : 'windows',
      ready: ocrReady,
      starting: ocrStarting,
      message: ocrReady ? '正在使用 RapidOCR（离线高精度）' : ocrStatus.message
    });
  }

  if (method === 'POST' && r0 === 'ocr') {
    const body = await readBody(req);
    const dataUrl = String(body.image || '');
    const m = /^data:(image\/(?:png|jpeg|jpg|webp|bmp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!m) fail('图片格式不正确，只支持 png / jpg / webp / bmp 图片');
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) fail('图片内容为空');
    if (buf.length > 15 * 1024 * 1024) fail('单张图片太大了（超过 15MB）');

    const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
    const stampId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const tmpImage = path.join(os.tmpdir(), 'arwoo-ocr-' + stampId + '.' + ext);
    const tmpOut = path.join(os.tmpdir(), 'arwoo-ocr-' + stampId + '.json');
    fs.writeFileSync(tmpImage, buf);

    let result;
    try {
      result = await recognizeImage(tmpImage, tmpOut);
    } finally {
      try { fs.unlinkSync(tmpImage); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(tmpOut); } catch (e) { /* ignore */ }
    }
    return sendJson(res, 200, result);
  }

  /* --------------------------------------------------------- 批量记流水 */

  if (method === 'POST' && r0 === 'transactions' && r1 === 'batch') {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || !items.length) fail('没有需要入账的记录');
    if (items.length > 200) fail('一次最多导入 200 笔');
    const state = mutate(s => {
      items.forEach((raw, i) => {
        let data;
        try {
          data = normTransactionInput(s, raw, null);
        } catch (e) {
          fail('第 ' + (i + 1) + ' 笔有问题：' + e.message);
        }
        s.transactions.push(Object.assign({ id: uid('tx'), createdAt: nowIso() }, data));
      });
    });
    return sendJson(res, 200, { ok: true, state: withMeta(state), count: items.length });
  }

  /* ---------------------------------------------------------- transactions */

  if (r0 === 'transactions') {
    if (method === 'POST' && !r1) {
      const body = await readBody(req);
      const state = mutate(s => {
        const data = normTransactionInput(s, body, null);
        s.transactions.push(Object.assign({ id: uid('tx'), createdAt: nowIso() }, data));
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }
    if (method === 'PUT' && r1) {
      const body = await readBody(req);
      const state = mutate(s => {
        const t = s.transactions.find(x => x.id === r1);
        if (!t) fail('流水不存在', 404);
        Object.assign(t, normTransactionInput(s, body, t));
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }
    if (method === 'DELETE' && r1) {
      const state = mutate(s => {
        const i = s.transactions.findIndex(x => x.id === r1);
        if (i < 0) fail('流水不存在', 404);
        s.transactions.splice(i, 1);
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }
  }

  /* -------------------------------------------------------------- accounts */

  if (r0 === 'accounts') {
    if (method === 'POST' && r1 && r2 === 'pools') {
      const body = await readBody(req);
      const state = mutate(s => {
        const a = pickAccount(s, r1);
        if (a.archived) fail('请先恢复这个账户');
        if (!POOLS.some(p => p.id === body.pool)) fail('请选择正确的账户池');
        const goalId = body.goalId || null;
        if (goalId && (body.pool !== 'goal' || !s.goals.some(g => g.id === goalId))) fail('请选择正确的目标');
        if (a.pool === body.pool) {
          if (body.pool === 'goal') a.goalId = goalId;
        } else {
          a.poolLinks = (a.poolLinks || []).filter(link => link.pool !== body.pool);
          a.poolLinks.push({ pool: body.pool, goalId });
        }
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }

    if (method === 'DELETE' && r1 && r2 === 'pools') {
      const body = await readBody(req);
      const state = mutate(s => {
        const a = pickAccount(s, r1);
        if (a.pool === body.pool) fail('这是账户的主要池，请通过编辑账户修改');
        a.poolLinks = (a.poolLinks || []).filter(link => link.pool !== body.pool);
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }

    if (method === 'POST' && !r1) {
      const body = await readBody(req);
      const state = mutate(s => {
        const data = normAccountInput(s, body, null);
        s.accounts.push(Object.assign({
          id: uid('acc'), marketValue: null, marketValueDate: null, valuations: [],
          archived: false, createdAt: nowIso()
        }, data));
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }

    if (method === 'POST' && r1 && r2 === 'valuation') {
      const body = await readBody(req);
      const state = mutate(s => {
        const a = pickAccount(s, r1);
        if (!isPlainInt(body.marketValue)) fail('市值格式不正确');
        const date = isDateStr(body.date) ? body.date : todayIso();
        a.marketValue = body.marketValue;
        a.marketValueDate = date;
        a.valuations = (a.valuations || []).filter(v => v.date !== date);
        a.valuations.push({ date: date, value: body.marketValue, flowOnDate: accountFlowOnDate(s, a.id, date) });
        a.valuations.sort((x, y) => x.date.localeCompare(y.date));
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }

    if (method === 'PUT' && r1) {
      const body = await readBody(req);
      const state = mutate(s => {
        const a = pickAccount(s, r1);
        Object.assign(a, normAccountInput(s, body, a));
        a.poolLinks = (a.poolLinks || []).filter(link => link.pool !== a.pool);
        if (body.archived !== undefined) a.archived = !!body.archived;
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }

    if (method === 'DELETE' && r1) {
      const state = mutate(s => {
        const a = pickAccount(s, r1);
        const used = s.transactions.some(t => t.accountId === a.id || t.toAccountId === a.id);
        if (used) fail('这个账户已经有流水记录了，不能直接删除。请改成「归档」，历史记录会保留。');
        s.accounts.splice(s.accounts.indexOf(a), 1);
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }
  }

  /* ----------------------------------------------------------------- goals */

  if (r0 === 'goals') {
    if (method === 'POST' && !r1) {
      const body = await readBody(req);
      const state = mutate(s => {
        const name = String(body.name || '').trim();
        if (!name) fail('目标名称不能为空');
        if (!isPlainInt(body.targetAmount) || body.targetAmount <= 0) fail('目标金额必须大于 0');
        const dueDate = body.dueDate ? body.dueDate : null;
        if (dueDate && !isDateStr(dueDate)) fail('截止日期格式不正确');
        s.goals.push({
          id: uid('goal'), name: name, targetAmount: body.targetAmount, dueDate: dueDate,
          note: String(body.note || '').slice(0, 200), status: 'active', createdAt: nowIso()
        });
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }

    if (method === 'PUT' && r1) {
      const body = await readBody(req);
      const state = mutate(s => {
        const g = s.goals.find(x => x.id === r1);
        if (!g) fail('目标不存在', 404);
        if (body.name !== undefined) {
          const name = String(body.name || '').trim();
          if (!name) fail('目标名称不能为空');
          g.name = name;
        }
        if (body.targetAmount !== undefined) {
          if (!isPlainInt(body.targetAmount) || body.targetAmount <= 0) fail('目标金额必须大于 0');
          g.targetAmount = body.targetAmount;
        }
        if (body.dueDate !== undefined) {
          if (body.dueDate && !isDateStr(body.dueDate)) fail('截止日期格式不正确');
          g.dueDate = body.dueDate || null;
        }
        if (body.note !== undefined) g.note = String(body.note || '').slice(0, 200);
        if (body.status !== undefined) g.status = body.status === 'done' ? 'done' : 'active';
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }

    if (method === 'DELETE' && r1) {
      const state = mutate(s => {
        const g = s.goals.find(x => x.id === r1);
        if (!g) fail('目标不存在', 404);
        const used = s.accounts.some(a => (a.goalId === g.id || (a.poolLinks || []).some(link => link.goalId === g.id)) && !a.archived);
        if (used) fail('这个目标下面还有账户，请先把账户移到别的目标或归档。');
        s.accounts.forEach(a => {
          if (a.goalId === g.id) a.goalId = null;
          (a.poolLinks || []).forEach(link => { if (link.goalId === g.id) link.goalId = null; });
        });
        s.transactions.forEach(t => { if (t.goalId === g.id) t.goalId = null; });
        s.goals.splice(s.goals.indexOf(g), 1);
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }
  }

  /* ------------------------------------------------------------ categories */

  if (r0 === 'categories') {
    if (method === 'POST' && !r1) {
      const body = await readBody(req);
      const state = mutate(s => {
        const name = String(body.name || '').trim();
        if (!name) fail('分类名称不能为空');
        const kind = body.kind === 'income' ? 'income' : 'expense';
        if (s.categories.some(c => c.kind === kind && c.name === name)) fail('已经有同名的分类了');
        const count = s.categories.filter(c => c.kind === kind).length;
        s.categories.push({
          id: uid('cat'), name: name, kind: kind, builtin: false,
          color: body.color || CATEGORY_COLORS[count % CATEGORY_COLORS.length]
        });
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }

    if (method === 'PUT' && r1) {
      const body = await readBody(req);
      const state = mutate(s => {
        const c = s.categories.find(x => x.id === r1);
        if (!c) fail('分类不存在', 404);
        if (body.name !== undefined) {
          const name = String(body.name || '').trim();
          if (!name) fail('分类名称不能为空');
          if (s.categories.some(x => x.id !== c.id && x.kind === c.kind && x.name === name)) fail('已经有同名的分类了');
          c.name = name;
        }
        if (body.color) c.color = body.color;
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }

    if (method === 'DELETE' && r1) {
      const state = mutate(s => {
        const c = s.categories.find(x => x.id === r1);
        if (!c) fail('分类不存在', 404);
        if (c.builtin) fail('内置分类不能删除，可以改名。');
        const used = s.transactions.some(t => t.categoryId === c.id);
        if (used) fail('这个分类已经被流水用到了，请先把相关流水改成别的分类。');
        s.categories.splice(s.categories.indexOf(c), 1);
      });
      return sendJson(res, 200, { ok: true, state: withMeta(state) });
    }
  }

  /* ------------------------------------------------------------ 飞书连接 */

  if (method === 'GET' && r0 === 'lan' && r1 === 'info') {
    if (!isLoopback(req)) return sendJson(res, 403, { error: '配对码只能在电脑本机查看' });
    const addr = server.address();
    const port = (addr && addr.port) || BASE_PORT;
    return sendJson(res, 200, {
      port: port,
      token: lanToken(),
      addresses: lanAddresses().map(a => ({
        name: a.name,
        address: a.address,
        url: 'http://' + a.address + ':' + port + '/'
      }))
    });
  }

  if (method === 'GET' && r0 === 'feishu' && r1 === 'status') {
    const cfg = readFeishuConfig();
    return sendJson(res, 200, {
      enabled: cfg.enabled,
      appId: cfg.appId,
      hasSecret: !!cfg.appSecret,
      secretMask: maskSecret(cfg.appSecret),
      status: feishuStatus,
      workerLog: feishuErr.slice(-800),
      inboxCount: listFeishuInbox().length,
      nodePid: process.pid,
      runtimeReady: fs.existsSync(pythonExe()) || true
    });
  }

  if (method === 'POST' && r0 === 'feishu' && r1 === 'config') {
    const body = await readBody(req);
    const old = readFeishuConfig();
    const next = {
      appId: body.appId !== undefined ? String(body.appId).trim() : old.appId,
      appSecret: body.clearSecret
        ? ''
        : (body.appSecret !== undefined && body.appSecret !== ''
          ? String(body.appSecret).trim()
          : old.appSecret),
      enabled: body.enabled !== undefined ? !!body.enabled : old.enabled
    };
    if (next.appId && !/^[A-Za-z0-9_-]{4,64}$/.test(next.appId)) {
      fail('App ID 看起来不对，应该是一串字母数字（例如 cli_a1b2c3d4e5f6g7h8）');
    }
    writeFeishuConfig(next);
    stopFeishu();
    feishuRetries = 0;
    setTimeout(startFeishu, 300);
    return sendJson(res, 200, { ok: true, status: { ...feishuStatus, state: 'connecting', message: '正在按新配置连接…' } });
  }

  if (method === 'GET' && r0 === 'feishu' && r1 === 'inbox') {
    return sendJson(res, 200, { files: listFeishuInbox() });
  }

  if (method === 'GET' && r0 === 'feishu' && r1 === 'image' && r2) {
    const name = decodeURIComponent(r2);
    if (!/^fs_[\w-]+\.(png|jpg|jpeg|gif|webp)$/i.test(name)) fail('文件名不对');
    const file = path.join(FEISHU_INBOX, name);
    if (!fs.existsSync(file)) fail('图片不存在', 404);
    const buf = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'image/png',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store'
    });
    return res.end(buf);
  }

  if (method === 'POST' && r0 === 'feishu' && r1 === 'consume') {
    const body = await readBody(req);
    const names = Array.isArray(body.names) ? body.names : [];
    let removed = 0;
    names.forEach(n => {
      const name = String(n);
      if (!/^fs_[\w-]+\.(png|jpg|jpeg|gif|webp)$/i.test(name)) return;
      try {
        fs.unlinkSync(path.join(FEISHU_INBOX, name));
        removed++;
      } catch (e) { /* ignore */ }
    });
    return sendJson(res, 200, { ok: true, removed: removed, remaining: listFeishuInbox().length });
  }

  if (method === 'POST' && r0 === 'feishu' && r1 === 'clear') {
    let removed = 0;
    listFeishuInbox().forEach(f => {
      try { fs.unlinkSync(path.join(FEISHU_INBOX, f.name)); removed++; } catch (e) { /* ignore */ }
    });
    return sendJson(res, 200, { ok: true, removed: removed });
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

/* ------------------------------------------------------------ 手机访问
   程序同时监听本机和局域网。本机（127.0.0.1）不用验证；
   局域网/其它设备第一次要输一次配对码，之后靠 cookie 记住。
   配对码存在 data/lan.json，不进账本、不进备份。 */

const LAN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function newLanToken() {
  let s = '';
  for (let i = 0; i < 6; i++) s += LAN_ALPHABET[Math.floor(Math.random() * LAN_ALPHABET.length)];
  return s;
}

function lanToken() {
  try {
    const j = JSON.parse(fs.readFileSync(LAN_FILE, 'utf8'));
    if (j && typeof j.token === 'string' && j.token.length >= 4) return j.token;
  } catch (e) { /* 还没建过 */ }
  const token = newLanToken();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LAN_FILE, JSON.stringify({ token: token }, null, 2), 'utf8');
  } catch (e) { /* ignore */ }
  return token;
}

function isLoopback(req) {
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const kv = parts[i].split('=');
    if (kv[0] && kv[0].trim() === name) return decodeURIComponent((kv[1] || '').trim());
  }
  return '';
}

function lanAddresses() {
  const out = [];
  try {
    const nets = os.networkInterfaces();
    Object.keys(nets).forEach(name => {
      (nets[name] || []).forEach(net => {
        if (net.family === 'IPv4' && !net.internal) out.push({ name: name, address: net.address });
      });
    });
  } catch (e) { /* ignore */ }
  return out;
}

function pairingPage(port) {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>配对 · Arwoo 财务助手</title><style>' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#f4f6fb;font-family:-apple-system,"Microsoft YaHei",sans-serif;color:#1f2733}' +
    '.box{background:#fff;border-radius:16px;padding:26px 22px;width:100%;max-width:340px;' +
    'box-shadow:0 10px 40px rgba(20,32,56,.12);text-align:center}' +
    'h1{font-size:18px;margin:0 0 6px}p{font-size:13px;color:#8391a6;margin:0 0 18px;line-height:1.6}' +
    'input{width:100%;box-sizing:border-box;font-size:26px;letter-spacing:8px;text-align:center;' +
    'text-transform:uppercase;padding:12px;border:1px solid #e9edf5;border-radius:10px;outline:none}' +
    'input:focus{border-color:#4f7ef7}' +
    'button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:10px;background:#4f7ef7;' +
    'color:#fff;font-size:15px;font-weight:600}' +
    '</style></head><body><div class="box">' +
    '<h1>🐣 配对这台设备</h1>' +
    '<p>请在电脑上的「设置 → 手机访问」里，把 6 位配对码填到下面。<br>配对一次之后就记住了。</p>' +
    '<form method="get" action="/">' +
    '<input name="k" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="配对码">' +
    '<button type="submit">进入财务助手</button>' +
    '</form></div></body></html>';
}

/** 返回 true 表示放行，false 表示已经自己回过响应了 */
function guardLan(req, res, url) {
  if (isLoopback(req)) return true;
  const token = lanToken();
  const entered = String(url.searchParams.get('k') || '').trim().toUpperCase();

  if (entered && entered === token) {
    res.writeHead(302, {
      'Set-Cookie': 'arwoo_key=' + encodeURIComponent(token) + '; Max-Age=31536000; Path=/; SameSite=Lax',
      Location: '/'
    });
    res.end();
    return false;
  }
  if (getCookie(req, 'arwoo_key') === token) return true;

  const isApi = url.pathname.indexOf('/api/') === 0;
  if (isApi) {
    sendJson(res, 401, { error: '这台设备还没有和电脑配对，请先在浏览器里打开 http://<电脑IP>:8787 输入配对码' });
    return false;
  }
  const html = Buffer.from(pairingPage(), 'utf8');
  res.writeHead(entered ? 401 : 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': html.length,
    'Cache-Control': 'no-store'
  });
  res.end(html);
  return false;
}

/* ---------------------------------------------------------- 飞书机器人连接
   你把截图发给飞书机器人 → 本机程序通过长连接收到 → 图片落到 data/feishu-inbox
   → 网页端读进来做识别。凭据单独存 data/feishu.json，不进账本、不进备份。 */

const FEISHU_CONFIG = path.join(DATA_DIR, 'feishu.json');
const FEISHU_RUNTIME = path.join(DATA_DIR, 'feishu-runtime.json');
const FEISHU_INBOX = path.join(DATA_DIR, 'feishu-inbox');
const FEISHU_SCRIPT = path.join(__dirname, 'tools', 'feishu_bot.py');

let feishuProc = null;
let feishuBuf = '';
let feishuErr = '';
let feishuTimer = null;
let feishuRetries = 0;
let feishuStopping = false;
let feishuStatus = { running: false, state: 'off', message: '未启用', saved: 0, lastFile: '' };

function readFeishuConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(FEISHU_CONFIG, 'utf8'));
    return {
      appId: String(c.appId || ''),
      appSecret: String(c.appSecret || ''),
      enabled: !!c.enabled
    };
  } catch (e) {
    return { appId: '', appSecret: '', enabled: false };
  }
}

function writeFeishuConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FEISHU_CONFIG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, FEISHU_CONFIG);
}

function maskSecret(s) {
  const v = String(s || '');
  if (v.length <= 6) return v ? '******' : '';
  return v.slice(0, 3) + '******' + v.slice(-3);
}

function listFeishuInbox() {
  let names = [];
  try {
    names = fs.readdirSync(FEISHU_INBOX).filter(n => /^fs_[\w-]+\.(png|jpg|jpeg|gif|webp)$/i.test(n));
  } catch (e) {
    return [];
  }
  return names.map(n => {
    let st = null;
    try { st = fs.statSync(path.join(FEISHU_INBOX, n)); } catch (e) { /* ignore */ }
    return { name: n, size: st ? st.size : 0, mtime: st ? st.mtime.toISOString() : '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function stopFeishu() {
  feishuStopping = true;
  if (feishuTimer) { clearTimeout(feishuTimer); feishuTimer = null; }
  if (feishuProc) {
    try { feishuProc.kill(); } catch (e) { /* ignore */ }
    feishuProc = null;
  }
}

function handleFeishuLine(line) {
  let msg = null;
  try { msg = JSON.parse(line); } catch (e) { return; }
  if (msg.status === 'connecting') {
    feishuStatus.state = 'connecting';
    feishuStatus.message = '正在连接飞书…';
  } else if (msg.status === 'ready') {
    feishuRetries = 0;
    feishuStatus.state = 'ok';
    feishuStatus.message = '已连上飞书，等着收截图';
  } else if (msg.status === 'reconnecting') {
    feishuStatus.state = 'connecting';
    feishuStatus.message = '和飞书的连接断了，正在重连…';
  } else if (msg.status === 'saved') {
    feishuRetries = 0;
    feishuStatus.state = 'ok';
    feishuStatus.saved = (feishuStatus.saved || 0) + 1;
    feishuStatus.lastFile = msg.file || '';
    feishuStatus.message = '刚收到一张截图：' + (msg.file || '');
  } else if (msg.status === 'backfill') {
    feishuRetries = 0;
    feishuStatus.state = 'ok';
    if (msg.count) {
      feishuStatus.saved = (feishuStatus.saved || 0) + msg.count;
      feishuStatus.message = '补收回来 ' + msg.count + ' 张离线期间发的截图';
    } else if (!feishuStatus.message || feishuStatus.state !== 'ok') {
      feishuStatus.message = '已连上飞书，等着收截图';
    }
  } else if (msg.status === 'nochat') {
    feishuStatus.state = 'ok';
    feishuStatus.message = '已连上飞书。给机器人发一条消息后，就能补收关机期间发的截图了';
  } else if (msg.status === 'error') {
    feishuStatus.state = 'error';
    feishuStatus.message = msg.error || '出错了';
  } else if (msg.status === 'stopped') {
    feishuStatus.state = 'off';
    feishuStatus.message = '连接已停止';
  }
}

function startFeishu() {
  const cfg = readFeishuConfig();
  if (!cfg.enabled) {
    feishuStatus = { running: false, state: 'off', message: '未启用', saved: feishuStatus.saved || 0, lastFile: '' };
    return;
  }
  if (!cfg.appId || !cfg.appSecret) {
    feishuStatus = { running: false, state: 'error', message: '还没填 App ID / App Secret', saved: 0, lastFile: '' };
    return;
  }
  if (feishuProc) return;
  if (!fs.existsSync(FEISHU_SCRIPT)) {
    feishuStatus = { running: false, state: 'error', message: '找不到 tools/feishu_bot.py', saved: 0, lastFile: '' };
    return;
  }

  fs.mkdirSync(FEISHU_INBOX, { recursive: true });
  try {
    fs.writeFileSync(FEISHU_RUNTIME, JSON.stringify({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      outDir: FEISHU_INBOX,
      stateFile: path.join(DATA_DIR, 'feishu-state.json')
    }, null, 2), 'utf8');
  } catch (e) {
    feishuStatus = { running: false, state: 'error', message: '写配置失败：' + e.message, saved: 0, lastFile: '' };
    return;
  }

  feishuStopping = false;
  feishuBuf = '';
  feishuErr = '';
  feishuStatus = { running: true, state: 'connecting', message: '正在启动连接…', saved: feishuStatus.saved || 0, lastFile: '' };

  let proc;
  try {
    proc = spawn(pythonExe(), ['-u', FEISHU_SCRIPT, '--config', FEISHU_RUNTIME, '--parent-pid', String(process.pid)], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    feishuStatus = { running: false, state: 'error', message: '启动失败：' + e.message, saved: 0, lastFile: '' };
    return;
  }
  feishuProc = proc;
  feishuStatus.pid = proc.pid;

  proc.stdout.on('data', chunk => {
    feishuBuf += chunk.toString('utf8');
    let idx;
    while ((idx = feishuBuf.indexOf('\n')) >= 0) {
      const line = feishuBuf.slice(0, idx).trim();
      feishuBuf = feishuBuf.slice(idx + 1);
      if (line) handleFeishuLine(line);
    }
  });
  proc.stderr.on('data', chunk => {
    feishuErr = (feishuErr + chunk.toString('utf8')).slice(-2000);
  });
  proc.on('error', err => {
    feishuStatus.state = 'error';
    feishuStatus.message = '启动失败：' + err.message;
    feishuProc = null;
  });
  proc.on('exit', code => {
    feishuProc = null;
    feishuStatus.running = false;
    if (feishuStopping) {
      feishuStatus.state = 'off';
      feishuStatus.message = '已关闭';
      return;
    }
    const why = feishuStatus.state === 'error' ? feishuStatus.message : ('连接断开了（退出码 ' + code + '）');
    if (feishuRetries < 5) {
      feishuRetries++;
      const wait = Math.min(60000, 5000 * feishuRetries);
      feishuStatus = {
        running: false, state: 'error',
        message: why + '，' + Math.round(wait / 1000) + ' 秒后自动重试（第 ' + feishuRetries + ' 次）',
        saved: feishuStatus.saved || 0, lastFile: ''
      };
      feishuTimer = setTimeout(startFeishu, wait);
    } else {
      feishuStatus = {
        running: false, state: 'error',
        message: why + '。已经重试 5 次都失败，请检查 App ID / App Secret 和权限配置',
        saved: feishuStatus.saved || 0, lastFile: ''
      };
    }
  });
}

/* -------------------------------------------------------------- static files */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = path.normalize(rel).replace(/^([\\/])+/, '');
  const filePath = path.join(WEB_DIR, safe);
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('页面不存在');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}

/* ------------------------------------------------------------------- server */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!guardLan(req, res, url)) return;
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(err => {
      if (res.headersSent) return;
      sendJson(res, err.status || 500, { error: err.message || '服务器出错了' });
    });
    return;
  }
  serveStatic(req, res, url);
});

/** 找一找这台电脑上装了哪些浏览器（不依赖系统的网址关联，那个有时是坏的） */
function browserCandidates() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  const list = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Edge', 'App', 'msedge.exe'),
    path.join(pf, 'Mozilla Firefox', 'firefox.exe'),
    path.join(pf86, 'Mozilla Firefox', 'firefox.exe'),
    path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    local && path.join(local, '360Chrome', 'Chrome', 'Application', '360chrome.exe'),
    path.join(pf86, '360Chrome', 'Chrome', 'Application', '360chrome.exe'),
    local && path.join(local, 'Tencent', 'QQBrowser', 'QQBrowser.exe'),
    path.join(pf86, 'Tencent', 'QQBrowser', 'QQBrowser.exe')
  ];
  return list.filter(Boolean);
}

function openBrowser(link) {
  try {
    if (process.platform === 'win32') {
      const found = browserCandidates().filter(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
      if (found.length) {
        // 直接调用浏览器本体，绕开可能坏掉的系统网址关联
        const child = spawn(found[0], [link], { detached: true, stdio: 'ignore' });
        child.on('error', () => {
          exec('cmd /c start "" "' + link + '"', () => {
            exec('rundll32 url.dll,FileProtocolHandler "' + link + '"', () => { /* 打不开就算了 */ });
          });
        });
        child.unref();
        return;
      }
      exec('cmd /c start "" "' + link + '"', err => {
        if (err) exec('rundll32 url.dll,FileProtocolHandler "' + link + '"', () => { /* ignore */ });
      });
    } else if (process.platform === 'darwin') {
      exec('open "' + link + '"', () => { /* ignore */ });
    } else {
      exec('xdg-open "' + link + '"', () => { /* ignore */ });
    }
  } catch (e) {
    /* 打不开就算了，窗口里已经打印了网址 */
  }
}

function listen(port, triesLeft) {
  // 换端口重试时，先把上一次注册的 listening 回调清掉，
  // 否则成功时会触发多个回调（横幅打印两遍、浏览器开两个标签页）。
  server.removeAllListeners('listening');
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) {
      listen(port + 1, triesLeft - 1);
      return;
    }
    console.error('启动失败：' + err.message);
    process.exit(1);
  });
  server.listen(port, '0.0.0.0', () => {
    const link = 'http://127.0.0.1:' + port + '/';
    const phoneLinks = lanAddresses().map(a => 'http://' + a.address + ':' + port + '/');
    console.log('');
    console.log('  ============================================================');
    console.log('   Arwoo 财务助手已经启动');
    console.log('');
    console.log('   电脑上用这个网址：');
    console.log('');
    console.log('        ' + link);
    console.log('');
    if (phoneLinks.length) {
      console.log('   手机上用这个网址（手机要和电脑连同一个 WiFi）：');
      phoneLinks.forEach(l => console.log('        ' + l));
      console.log('   手机第一次打开要输一次配对码： ' + lanToken());
      console.log('');
    }
    console.log('   数据保存在： ' + DATA_FILE);
    console.log('   用完之后，关掉这个黑色窗口就可以了。');
    console.log('  ============================================================');
    console.log('');
    if (!process.argv.includes('--no-open')) openBrowser(link);
  });
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// 关窗口 / Ctrl+C 时，把识别引擎的子进程一起收掉
process.on('exit', () => { killOcrWorker(); stopFeishu(); });
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => {
  process.on(sig, () => { killOcrWorker(); stopFeishu(); process.exit(0); });
});

// 上次开过飞书连接的话，这次启动自动接上
startFeishu();

listen(BASE_PORT, MAX_PORT_TRIES);
