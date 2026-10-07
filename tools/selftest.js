'use strict';

/**
 * 自检脚本：验证「余额 / 调拨 / 目标进度 / 报表」的算法是否自洽。
 *
 * 用法：
 *   node tools/selftest.js                     跑内置用例
 *   node tools/selftest.js --state data/finance.json   顺便体检你的真实数据
 *
 * 它直接加载网页用的 web/js/core.js，保证测的就是真正在跑的那套算法。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CORE = path.join(ROOT, 'web', 'js', 'core.js');
const OCR = path.join(ROOT, 'web', 'js', 'ocr.js');

const glue = `
globalThis.__core = {
  setState: function (v) {
    S = v;
    if (v && v.meta) META = { pools: v.meta.pools || [], accountTypes: v.meta.accountTypes || [] };
  },
  accountCostBalance: accountCostBalance,
  accountValue: accountValue,
  accountStat: accountStat,
  poolTotal: poolTotal,
  totalAssets: totalAssets,
  gooseStat: gooseStat,
  goalProgress: goalProgress,
  monthSummary: monthSummary,
  categoryBreakdown: categoryBreakdown,
  monthlyFlowSeries: monthlyFlowSeries,
  assetSeries: assetSeries,
  fmtMoney: fmtMoney,
  parseMoney: parseMoney,
  monthKeyOf: monthKeyOf,
  shiftMonth: shiftMonth,
  todayIso: todayIso,
  accountById: accountById,
  goalById: goalById,
  normalizeOcr: normalizeOcr,
  groupOcrRows: groupOcrRows,
  pickAmount: pickAmount,
  pickDate: pickDate,
  guessDirection: guessDirection,
  pickMerchant: pickMerchant,
  guessCategoryId: guessCategoryId,
  guessAccountId: guessAccountId,
  parseOcrResult: parseOcrResult
};
`;

const ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(CORE, 'utf8') + '\n' + fs.readFileSync(OCR, 'utf8') + '\n' + glue,
  ctx,
  { filename: 'bundle.js' }
);
const C = ctx.__core;

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + '  期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}

function section(t) {
  console.log('\n' + t);
}

/* --------------------------------------------------------------- 构造用例 */

const D = '2026-03';

function fixture() {
  return {
    version: 1,
    meta: { pools: [
      { id: 'cash', name: '日常现金池', desc: '' },
      { id: 'goal', name: '中短期目标池', desc: '' },
      { id: 'goose', name: '长期金鹅池', desc: '' }
    ] },
    goals: [{ id: 'g1', name: '旅游计划', targetAmount: 2000000, dueDate: '2026-12-31', note: '', status: 'active' }],
    accounts: [
      { id: 'a_bank', name: '储蓄卡', type: 'bank', pool: 'cash', goalId: null, openingBalance: 200000, marketValue: null, valuations: [], archived: false },
      { id: 'a_fund', name: '货基', type: 'money_fund', pool: 'cash', goalId: null, openingBalance: 0, marketValue: null, valuations: [], archived: false },
      { id: 'a_trip', name: '旅游金', type: 'bank', pool: 'goal', goalId: 'g1', openingBalance: 0, marketValue: null, valuations: [], archived: false },
      { id: 'a_index', name: '指数基金', type: 'fund', pool: 'goose', goalId: null, openingBalance: 1000000,
        marketValue: 1350000, valuations: [{ date: '2026-03-20', value: 1350000 }], archived: false }
    ],
    categories: [
      { id: 'c_food', name: '餐饮', kind: 'expense', builtin: true, color: '#f2994a' },
      { id: 'c_salary', name: '工资', kind: 'income', builtin: true, color: '#4f7ef7' }
    ],
    transactions: [
      { id: 't1', type: 'income', amount: 500000, date: D + '-05', accountId: 'a_bank', toAccountId: null, categoryId: 'c_salary', goalId: null, note: '月薪' },
      { id: 't2', type: 'expense', amount: 120000, date: D + '-08', accountId: 'a_bank', toAccountId: null, categoryId: 'c_food', goalId: null, note: '吃饭' },
      { id: 't3', type: 'transfer', amount: 300000, date: D + '-10', accountId: 'a_bank', toAccountId: 'a_trip', categoryId: null, goalId: null, note: '存旅游金' },
      { id: 't4', type: 'transfer', amount: 200000, date: D + '-10', accountId: 'a_bank', toAccountId: 'a_index', categoryId: null, goalId: null, note: '定投' },
      { id: 't5', type: 'adjust', amount: 50000, date: D + '-28', accountId: 'a_bank', toAccountId: null, categoryId: null, goalId: null, note: '余额校准' }
    ],
    settings: {}
  };
}

/* --------------------------------------------------------------- 用例 */

section('1. 账户余额 = 期初 + 收入 − 支出 + 调入 − 调出 ± 校准');
{
  const s = fixture();
  C.setState(s);
  const bank = C.accountById('a_bank');
  // 200000 + 500000 − 120000 − 300000 − 200000 + 50000
  check('储蓄卡余额 1300.00', C.accountCostBalance(bank), 130000);
  check('旅游金（只进）3000.00', C.accountCostBalance(C.accountById('a_trip')), 300000);
  check('指数基金成本 12000.00', C.accountCostBalance(C.accountById('a_index')), 1200000);
  check('货基余额 0.00', C.accountCostBalance(C.accountById('a_fund')), 0);
}

section('2. 金鹅池按市值计，并算出盈亏');
{
  const s = fixture();
  C.setState(s);
  const st = C.accountStat(C.accountById('a_index'));
  check('市值 13500.00', st.market, 1350000);
  check('成本 12000.00', st.cost, 1200000);
  check('盈亏 +1500.00', st.profit, 150000);
  check('收益率 12.5%', Number((st.profitRate * 100).toFixed(4)), 12.5);
  check('账户价值取市值', st.value, 1350000);
}

section('3. 账户池合计与总资产');
{
  const s = fixture();
  C.setState(s);
  check('日常现金池 1300.00', C.poolTotal('cash'), 130000);
  check('中短期目标池 3000.00', C.poolTotal('goal'), 300000);
  check('长期金鹅池 13500.00', C.poolTotal('goose'), 1350000);
  check('总资产 17800.00', C.totalAssets(), 1780000);
  check('三池相加 = 总资产', C.poolTotal('cash') + C.poolTotal('goal') + C.poolTotal('goose'), C.totalAssets());
}

section('4. 调拨不重复计：既不进收支，也不改变总资产');
{
  const withTransfer = fixture();
  withTransfer.accounts.forEach(a => { a.valuations = []; a.marketValue = null; });
  const without = fixture();
  without.accounts.forEach(a => { a.valuations = []; a.marketValue = null; });
  without.transactions = without.transactions.filter(t => t.type !== 'transfer');

  C.setState(withTransfer);
  const totalWith = C.totalAssets();
  const summary = C.monthSummary(D);

  C.setState(without);
  const totalWithout = C.totalAssets();

  check('调拨前后总资产一致', totalWith, totalWithout);
  check('调拨不计入收入', summary.income, 500000);
  check('调拨不计入支出', summary.expense, 120000);
  check('校准也不算收支', summary.net, 380000);
}

section('4b. 更新市值后继续定投，总资产不会莫名缩水');
{
  const s = fixture();
  s.accounts.forEach(a => { a.valuations = []; a.marketValue = null; });
  // 3 月 1 日填的市值 13500，那时成本只有 10000
  C.setState(s);
  s.accounts.find(a => a.id === 'a_index').valuations = [{ date: D + '-01', value: 1350000 }];
  C.setState(s);

  const st = C.accountStat(C.accountById('a_index'));
  check('市值锚点 13500.00', st.anchor, 1350000);
  check('锚点之后追加 2000.00', st.added, 200000);
  check('当前价值 = 锚点 + 追加 = 15500.00', st.value, 1550000);
  check('成本 12000.00', st.cost, 1200000);
  check('盈亏仍是 +3500.00（不受追加影响）', st.profit, 350000);
  check('总资产 19800.00', C.totalAssets(), 1980000);
}

section('5. 余额校准：总资产只按差额变化');
{
  const s = fixture();
  C.setState(s);
  const before = C.totalAssets();
  s.transactions.push({ id: 'tX', type: 'adjust', amount: -30000, date: D + '-28', accountId: 'a_bank', toAccountId: null, categoryId: null, goalId: null, note: '校准' });
  C.setState(s);
  check('校准 −300.00 后总资产少 300.00', C.totalAssets(), before - 30000);
}

section('6. 目标进度按目标下账户的总额计算');
{
  const s = fixture();
  C.setState(s);
  const pr = C.goalProgress(C.goalById('g1'));
  check('已存 3000.00', pr.saved, 300000);
  check('目标 20000.00', pr.target, 2000000);
  check('还差 17000.00', pr.remaining, 1700000);
  check('进度 15.0%', Number((pr.ratio * 100).toFixed(4)), 15);
  check('未达成', pr.done, false);
}

section('7. 报表与手工求和一致');
{
  const s = fixture();
  C.setState(s);
  const cats = C.categoryBreakdown(D, 'expense');
  check('支出只有一个分类', cats.length, 1);
  check('支出分类金额 1200.00', cats[0].value, 120000);
  check('支出分类名称正确', cats[0].label, '餐饮');
  check('收入分类金额 5000.00', C.categoryBreakdown(D, 'income')[0].value, 500000);
  check('空月份没有数据', C.categoryBreakdown('2020-01', 'expense').length, 0);
}

section('8. 月份工具函数');
{
  check('跨年往前推 1 个月', C.shiftMonth('2026-01', -1), '2025-12');
  check('跨年往后推 2 个月', C.shiftMonth('2026-11', 2), '2027-01');
  check('取月份', C.monthKeyOf('2026-03-08'), '2026-03');
}

section('9. 金额格式与解析');
{
  check('格式化 1234567.89', C.fmtMoney(123456789), '¥1,234,567.89');
  check('格式化负数', C.fmtMoney(-50000), '-¥500.00');
  check('格式化带正号', C.fmtMoney(50000, { sign: true }), '+¥500.00');
  check('解析带逗号', C.parseMoney('1,234.56'), 123456);
  check('解析带货币符号', C.parseMoney('¥ 88.8'), 8880);
  check('解析空字符串为 NaN', Number.isNaN(C.parseMoney('')), true);
}

/* --------------------------------------------------------------- 截图解析 */

// 按「一行文字 + 位置」造 OCR 结果：每个字一个词，带方框
function makeOcr(lines) {
  const words = [];
  lines.forEach(L => {
    let x = L.x === undefined ? 40 : L.x;
    String(L.text).split('').forEach(ch => {
      words.push({ t: ch, x: x, y: L.y, w: L.h * 0.9, h: L.h });
      x += L.h * 0.95;
    });
  });
  return { ok: true, width: 750, height: 1200, words: words };
}

// 真实微信支付截图的 OCR 原始输出（由一个仿真的支付截图跑 Windows OCR 得到）
const REAL_OCR = {
  ok: true, width: 750, height: 1200,
  words: [
    { t: '微', x: 47, y: 69, w: 39, h: 38 }, { t: '信', x: 88, y: 69, w: 38, h: 38 }, { t: '支', x: 128, y: 69, w: 38, h: 38 }, { t: '付', x: 168, y: 69, w: 39, h: 38 },
    { t: '支', x: 44, y: 146, w: 25, h: 24 }, { t: '付', x: 71, y: 147, w: 24, h: 24 }, { t: '成', x: 96, y: 147, w: 26, h: 23 }, { t: '功', x: 123, y: 147, w: 23, h: 24 },
    { t: '¥', x: 58, y: 249, w: 56, h: 73 }, { t: '23', x: 120, y: 248, w: 107, h: 75 }, { t: '．', x: 238, y: 307, w: 18, h: 16 }, { t: '50', x: 268, y: 248, w: 106, h: 75 },
    { t: '收', x: 46, y: 407, w: 26, h: 25 }, { t: '款', x: 73, y: 406, w: 27, h: 27 }, { t: '方', x: 102, y: 405, w: 26, h: 29 },
    { t: '星', x: 266, y: 409, w: 27, h: 23 }, { t: '巴', x: 296, y: 409, w: 24, h: 23 }, { t: '克', x: 322, y: 407, w: 27, h: 27 }, { t: '咖', x: 351, y: 408, w: 25, h: 25 },
    { t: '啡', x: 379, y: 407, w: 25, h: 26 }, { t: '（', x: 407, y: 409, w: 7, h: 26 }, { t: '国', x: 416, y: 408, w: 24, h: 25 }, { t: '贸', x: 443, y: 408, w: 25, h: 25 },
    { t: '店', x: 470, y: 407, w: 28, h: 27 }, { t: '）', x: 499, y: 409, w: 6, h: 26 },
    { t: '支', x: 45, y: 477, w: 27, h: 25 }, { t: '付', x: 74, y: 478, w: 26, h: 25 }, { t: '时', x: 102, y: 477, w: 27, h: 25 }, { t: '间', x: 131, y: 476, w: 24, h: 27 },
    { t: '2026', x: 266, y: 479, w: 65, h: 21 }, { t: '年', x: 332, y: 478, w: 28, h: 26 }, { t: '10', x: 363, y: 479, w: 28, h: 21 }, { t: '月', x: 393, y: 479, w: 23, h: 25 },
    { t: '5', x: 422, y: 479, w: 13, h: 21 }, { t: '日', x: 440, y: 479, w: 20, h: 24 },
    { t: '12', x: 475, y: 479, w: 28, h: 21 }, { t: '：', x: 506, y: 485, w: 3, h: 15 }, { t: '30', x: 513, y: 479, w: 29, h: 21 },
    { t: '支', x: 45, y: 547, w: 27, h: 25 }, { t: '付', x: 74, y: 548, w: 26, h: 25 }, { t: '方', x: 102, y: 545, w: 26, h: 29 }, { t: '式', x: 129, y: 548, w: 28, h: 25 },
    { t: '招', x: 265, y: 548, w: 26, h: 25 }, { t: '商', x: 293, y: 547, w: 28, h: 26 }, { t: '银', x: 321, y: 547, w: 28, h: 27 }, { t: '行', x: 350, y: 547, w: 27, h: 26 },
    { t: '储', x: 377, y: 548, w: 27, h: 26 }, { t: '蓄', x: 406, y: 547, w: 27, h: 26 }, { t: '卡', x: 434, y: 548, w: 26, h: 25 },
    { t: '0', x: 463, y: 549, w: 18, h: 26 }, { t: '234', x: 487, y: 549, w: 47, h: 21 }, { t: '）', x: 535, y: 549, w: 7, h: 26 },
    { t: '4200001234202610051234567890', x: 264, y: 617, w: 391, h: 18 },
    { t: '交', x: 46, y: 618, w: 26, h: 25 }, { t: '易', x: 74, y: 619, w: 25, h: 25 }, { t: '单', x: 101, y: 618, w: 28, h: 26 }, { t: '号', x: 129, y: 619, w: 28, h: 23 }
  ]
};

const OCR_STATE = {
  goals: [],
  accounts: [
    { id: 'acc_bank', name: '招商银行储蓄卡', type: 'bank', pool: 'cash', archived: false },
    { id: 'acc_yue', name: '余额宝', type: 'money_fund', pool: 'cash', archived: false }
  ],
  categories: [
    { id: 'cat_food', name: '餐饮', kind: 'expense', builtin: true },
    { id: 'cat_traffic', name: '交通', kind: 'expense', builtin: true },
    { id: 'cat_other', name: '其他', kind: 'expense', builtin: true },
    { id: 'cat_income_other', name: '其他', kind: 'income', builtin: true }
  ],
  transactions: []
};

section('10. 截图解析 —— 真实微信支付截图');
{
  const g = C.parseOcrResult(REAL_OCR, OCR_STATE, '2026-10-06');

  check('把散字聚成了行', g.rows.length > 0, true);
  check('金额识别为 23.50', g.amount, 2350);
  check('金额来源是 ¥ 标记', g.amountSource, 'yuan');
  check('日期识别为 2026-10-05', g.date, '2026-10-05');
  check('方向识别为支出', g.type, 'expense');
  check('商户识别正确', g.merchant, '星巴克咖啡(国贸店)');
  check('分类猜成餐饮', g.categoryId, 'cat_food');
  check('账户猜成招商银行储蓄卡', g.accountId, 'acc_bank');
  check('没有金额告警', g.warnings.length, 0);
}

section('10b. 同一行的标签和内容被 OCR 拆开了，也能拼回去');
{
  const rows = C.groupOcrRows(REAL_OCR.words);
  const row = rows.find(r => r.compact.indexOf('收款方') >= 0);
  check('收款方和商户名在同一行', row.compact, '收款方星巴克咖啡(国贸店)');
  const amountRow = rows.find(r => r.compact.indexOf('23.50') >= 0);
  check('整行金额被还原成 ¥23.50', amountRow.compact, '¥23.50');
  check('金额行字号最大（75）', amountRow.height, 75);
}

section('11. 截图解析 —— 收款到账截图');
{
  const ocr = makeOcr([
    { text: '余额宝', y: 60, h: 30 },
    { text: '收款成功', y: 130, h: 26 },
    { text: '¥1,280.00', y: 220, h: 82, x: 40 },
    { text: '转账人', y: 380, h: 26, x: 40 },
    { text: '张三', y: 380, h: 26, x: 200 },
    { text: '到账时间', y: 450, h: 26, x: 40 },
    { text: '2026年9月28日 09:15', y: 450, h: 26, x: 200 }
  ]);
  const g = C.parseOcrResult(ocr, OCR_STATE, '2026-10-06');
  check('方向识别为收入', g.type, 'income');
  check('金额 1280.00', g.amount, 128000);
  check('日期 2026-09-28', g.date, '2026-09-28');
  check('账户猜成余额宝', g.accountId, 'acc_yue');
}

section('12. 截图解析 —— 没有 ¥ 符号，金额是大号数字');
{
  const ocr = makeOcr([
    { text: '支付成功', y: 120, h: 24 },
    { text: '68.00', y: 200, h: 90 },
    { text: '10月3日 18:22', y: 420, h: 26 },
    { text: '交易单号 8888666622223333', y: 480, h: 24 }
  ]);
  const g = C.parseOcrResult(ocr, OCR_STATE, '2026-10-06');
  check('金额 68.00', g.amount, 6800);
  check('金额来源是大号数字', g.amountSource, 'big');
  check('日期补上今年 2026-10-03', g.date, '2026-10-03');
}

section('13. 截图解析 —— 什么都没认出来时不崩、给提示');
{
  const ocr = makeOcr([{ text: '随便一张图', y: 100, h: 30 }, { text: '没有金额也没有日期', y: 200, h: 30 }]);
  const g = C.parseOcrResult(ocr, OCR_STATE, '2026-10-06');
  check('金额为空', g.amount, null);
  check('日期退回今天', g.date, '2026-10-06');
  check('提示要手填金额', g.warnings.some(w => w.indexOf('金额') >= 0), true);
  check('提示日期用了今天', g.warnings.some(w => w.indexOf('日期') >= 0), true);
  check('不会崩', typeof g.rawText, 'string');
}

section('14. 截图解析 —— 全角符号与空格');
{
  check('全角数字转半角', C.normalizeOcr('２０２６'), '2026');
  check('全角冒号转半角', C.normalizeOcr('12：30'), '12:30');
  check('全角句点转半角', C.normalizeOcr('23．50'), '23.50');
  check('全角括号转半角', C.normalizeOcr('（1234）'), '(1234)');
  check('￥ 统一成 ¥', C.normalizeOcr('￥88'), '¥88');
  check('中文之间的空格被去掉', C.normalizeOcr('微 信 支 付').replace(/\s+/g, ''), '微信支付');
}

section('15. 截图解析 —— 带 + 号、且 OCR 把 1 认成 L');
{
  const plus = makeOcr([
    { text: '收款成功', y: 130, h: 26 },
    { text: '+1,280.00', y: 210, h: 84 }
  ]);
  check('带 + 号的金额能认出来', C.parseOcrResult(plus, OCR_STATE, '2026-10-06').amount, 128000);

  const messy = makeOcr([
    { text: '余额宝', y: 60, h: 30 },
    { text: '收款成功', y: 130, h: 26 },
    { text: '+L280.00', y: 210, h: 84 },
    { text: '到账时间', y: 450, h: 26, x: 40 },
    { text: '2026年9月28日 09:15', y: 450, h: 26, x: 200 }
  ]);
  const g = C.parseOcrResult(messy, OCR_STATE, '2026-10-06');
  check('字母 L 当作 1，金额救回 1280.00', g.amount, 128000);
  check('方向识别为收入', g.type, 'income');
  check('日期 2026-09-28', g.date, '2026-09-28');
}

section('16. 截图解析 —— 账户名被吃掉一个字也能对上');
{
  const ocr = makeOcr([
    { text: '支付宝', y: 60, h: 30 },
    { text: '付款成功', y: 130, h: 26 },
    { text: '68.00', y: 210, h: 84 },
    { text: '商户名称', y: 400, h: 28, x: 40 },
    { text: '沙县小吃', y: 400, h: 28, x: 260 },
    { text: '付款时间', y: 470, h: 28, x: 40 },
    { text: '1 0月3日 18:22', y: 470, h: 28, x: 260 },
    { text: '付款方式', y: 540, h: 28, x: 40 },
    { text: '余额', y: 540, h: 28, x: 260 }
  ]);
  const g = C.parseOcrResult(ocr, OCR_STATE, '2026-10-06');
  check('「余额」按前缀匹配到余额宝', g.accountId, 'acc_yue');
  check('商户名认出来了', g.merchant, '沙县小吃');
  check('分类猜成餐饮', g.categoryId, 'cat_food');
  check('金额 68.00', g.amount, 6800);
  check('日期把空格去掉后认对 2026-10-03', g.date, '2026-10-03');
  check('没有告警', g.warnings.length, 0);
}

section('17. 截图解析 —— 长订单号不会被当成金额');
{
  const ocr = makeOcr([
    { text: '支付成功', y: 120, h: 24 },
    { text: '交易单号', y: 300, h: 24, x: 40 },
    { text: '4200001234202610051234567890', y: 300, h: 24, x: 200 },
    { text: '¥12.00', y: 210, h: 70 }
  ]);
  const g = C.parseOcrResult(ocr, OCR_STATE, '2026-10-06');
  check('金额取 12.00 而不是订单号', g.amount, 1200);
}

section('18. 截图解析 —— 超市类商户归到购物');
{
  const ocr = makeOcr([
    { text: '支付宝', y: 120, h: 24, x: 80 },
    { text: '¥128.60', y: 420, h: 134 },
    { text: '商户名称', y: 780, h: 52, x: 80 },
    { text: '盒马鲜生(望京店)', y: 780, h: 52, x: 520 }
  ]);
  const state = {
    accounts: [],
    categories: [
      { id: 'cat_food', name: '餐饮', kind: 'expense' },
      { id: 'cat_shop', name: '购物', kind: 'expense' },
      { id: 'cat_other', name: '其他', kind: 'expense' }
    ],
    transactions: []
  };
  const g = C.parseOcrResult(ocr, state, '2026-10-06');
  check('盒马鲜生归到购物', g.categoryId, 'cat_shop');
}

// RapidOCR（当前在用的引擎）在「仿真微信支付截图」上的真实输出
const RAPID_OCR = {
  ok: true, engine: 'rapidocr',
  words: [
    { t: '微信支付', x: 67, y: 88, w: 179, h: 48, score: 0.9986 },
    { t: '支付成功', x: 62, y: 162, w: 126, h: 37, score: 0.9993 },
    { t: '￥23.50', x: 99, y: 258, w: 429, h: 90, score: 0.9116 },
    { t: '支付成功', x: 399, y: 420, w: 113, h: 37, score: 0.9999 },
    { t: '当前状态', x: 71, y: 423, w: 112, h: 34, score: 1 },
    { t: '收款方', x: 70, y: 501, w: 86, h: 36, score: 0.9999 },
    { t: '星巴克咖啡(国贸店)', x: 403, y: 505, w: 226, h: 30, score: 0.9941 },
    { t: '支付时间', x: 70, y: 582, w: 113, h: 34, score: 0.9999 },
    { t: '2026年10月5日12:30:47', x: 403, y: 584, w: 299, h: 30, score: 0.9772 },
    { t: '支付方式', x: 70, y: 662, w: 113, h: 35, score: 0.9999 },
    { t: '招商银行储蓄卡(1234)', x: 403, y: 665, w: 261, h: 30, score: 0.9676 },
    { t: '4200001234202610051234567890', x: 401, y: 742, w: 341, h: 23, score: 0.9994 },
    { t: '交易单号', x: 71, y: 744, w: 110, h: 31, score: 1 },
    { t: '账单分类', x: 68, y: 820, w: 117, h: 39, score: 0.9998 },
    { t: '餐饮美食', x: 400, y: 820, w: 113, h: 37, score: 0.9993 }
  ]
};

section('19. 截图解析 —— RapidOCR 的真实输出（整行整块的结果）');
{
  const g = C.parseOcrResult(RAPID_OCR, OCR_STATE, '2026-10-06');
  check('标签和内容并成一行', g.rows.some(r => r.compact === '收款方星巴克咖啡(国贸店)'), true);
  check('金额行字号最大', g.amount, 2350);
  check('金额来自 ￥ 标记（全角也认）', g.amountSource, 'yuan');
  check('日期识别（忽略后面的时分秒）', g.date, '2026-10-05');
  check('方向是支出', g.type, 'expense');
  check('商户识别正确', g.merchant, '星巴克咖啡(国贸店)');
  check('账户识别正确', g.accountId, 'acc_bank');
  check('分类猜成餐饮', g.categoryId, 'cat_food');
  check('没有告警', g.warnings.length, 0);
}

/* --------------------------------------------------------------- 真实数据体检 */

const stateArg = process.argv.indexOf('--state');
if (stateArg > -1 && process.argv[stateArg + 1]) {
  const file = path.resolve(process.argv[stateArg + 1]);
  section('体检你的真实数据：' + file);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  C.setState(raw);

  const assets = C.totalAssets();
  const sum = C.poolTotal('cash') + C.poolTotal('goal') + C.poolTotal('goose');
  console.log('  账户数 ' + raw.accounts.length + '，目标数 ' + raw.goals.length + '，流水数 ' + raw.transactions.length);
  console.log('  总资产 ' + C.fmtMoney(assets));
  raw.meta = raw.meta || {};
  C.setState({
    meta: { pools: [
      { id: 'cash', name: '日常现金池' }, { id: 'goal', name: '中短期目标池' }, { id: 'goose', name: '长期金鹅池' }
    ] },
    accounts: raw.accounts, goals: raw.goals, categories: raw.categories, transactions: raw.transactions
  });
  console.log('  日常现金池 ' + C.fmtMoney(C.poolTotal('cash')));
  console.log('  中短期目标池 ' + C.fmtMoney(C.poolTotal('goal')));
  console.log('  长期金鹅池 ' + C.fmtMoney(C.poolTotal('goose')));
  const g = C.gooseStat();
  console.log('  金鹅池：成本 ' + C.fmtMoney(g.cost) + '，市值 ' + C.fmtMoney(g.market) + '，盈亏 ' + C.fmtMoney(g.profit, { sign: true }));
  raw.goals.forEach(goal => {
    const pr = C.goalProgress(goal);
    console.log('  目标「' + goal.name + '」：' + C.fmtMoney(pr.saved) + ' / ' + C.fmtMoney(pr.target) + '（' + (pr.ratio * 100).toFixed(1) + '%）');
  });

  check('三池相加 = 总资产', sum, assets);
  C.setState(raw);
  check('流水日期都在合理范围', raw.transactions.every(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date)), true);
}

/* --------------------------------------------------------------- 结果 */

console.log('\n' + '─'.repeat(46));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项。');
console.log('─'.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
