'use strict';

/* ============================================================
   支付截图解析
   ------------------------------------------------------------
   输入：Windows OCR 返回的词 + 位置（每个字一个词，带方框）
   输出：能直接填进「记一笔」表单的字段
   全部是纯函数，方便自检脚本直接测。
   ============================================================ */

/** 全角转半角、统一标点，方便后面用正则匹配 */
function normalizeOcr(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/￥/g, '¥')
    .replace(/。/g, '.')
    .replace(/、/g, ' ')
    .replace(/\u00B7/g, '.');
}

function isAsciiWordChar(ch) {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

/** 把一行的词拼起来：中文之间不加空格，英文单词之间补空格 */
function joinOcrWords(words) {
  let out = '';
  words.forEach((w, i) => {
    if (i > 0) {
      const prev = out.charAt(out.length - 1);
      const cur = String(w.text || '').charAt(0);
      if (isAsciiWordChar(prev) && isAsciiWordChar(cur)) out += ' ';
    }
    out += w.text;
  });
  return out;
}

/**
 * 把散落的词按「视觉上的同一行」聚起来。
 * OCR 有时会把同一行的标签和内容拆成两行，用方框位置重新归并更可靠。
 */
function groupOcrRows(words) {
  const list = (words || [])
    .filter(w => w && w.t !== undefined && String(w.t).length)
    .map(w => ({
      text: String(w.t),
      x: Number(w.x) || 0,
      y: Number(w.y) || 0,
      w: Math.max(1, Number(w.w) || 1),
      h: Math.max(1, Number(w.h) || 1)
    }));
  if (!list.length) return [];

  list.sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);

  const rows = [];
  list.forEach(w => {
    const cy = w.y + w.h / 2;
    let best = null;
    let bestDist = Infinity;
    rows.forEach(r => {
      const dist = Math.abs(r.cy - cy);
      const tol = Math.max(r.h, w.h) * 0.6;
      if (dist <= tol && dist < bestDist) { best = r; bestDist = dist; }
    });
    if (best) {
      best.cy = (best.cy * best.words.length + cy) / (best.words.length + 1);
      best.words.push(w);
      best.h = Math.max(best.h, w.h);
      best.top = Math.min(best.top, w.y);
      best.bottom = Math.max(best.bottom, w.y + w.h);
    } else {
      rows.push({ words: [w], cy: cy, h: w.h, top: w.y, bottom: w.y + w.h });
    }
  });

  rows.forEach(r => {
    r.words.sort((a, b) => a.x - b.x);
    r.text = joinOcrWords(r.words);
    r.compact = normalizeOcr(r.text).replace(/\s+/g, '');
    r.height = r.h;
  });
  rows.sort((a, b) => a.top - b.top);
  return rows;
}

/* ------------------------------------------------------------ 金额 */

const AMOUNT_BLOCK_WORDS = /年|月|日|时间|日期|单号|订单|编号|卡号|尾号|手机|电话|券|积分|余额|额度|汇率|流水|账单/;

/** OCR 常见的字母/数字看错，只在直接解析失败时才启用 */
const OCR_DIGIT_FIX = {
  O: '0', o: '0', Q: '0',
  I: '1', l: '1', L: '1', '|': '1', i: '1',
  Z: '2', z: '2',
  A: '4',
  S: '5', s: '5',
  G: '6', b: '6',
  T: '7',
  B: '8',
  g: '9', q: '9'
};

function fixOcrDigits(s) {
  return String(s).replace(/[OoQIlL|iZzASsGbTBgq]/g, ch => OCR_DIGIT_FIX[ch] || ch);
}

function stripSign(s) {
  return String(s).replace(/^[+\-−]\s*/, '');
}

function numericText(s) {
  return /^\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?$/.test(s) || /^\d+(?:\.\d{1,2})?$/.test(s);
}

/** 把一个「看起来像金额」的片段转成分；直接解析不成功时，再试着纠正容易看错的字母 */
function amountFromToken(tok) {
  const base = String(tok).replace(/\s/g, '');
  const cands = [
    base,
    base.replace(/[^0-9.]+$/, ''),
    fixOcrDigits(base),
    fixOcrDigits(base).replace(/[^0-9.]+$/, '')
  ];
  for (const c of cands) {
    if (!c || !numericText(c)) continue;
    const n = Number(c.replace(/,/g, ''));
    if (!isFinite(n) || n <= 0 || n >= 1e9) continue;
    return Math.round(n * 100);
  }
  return null;
}

/**
 * 挑金额：
 * 1) 优先带 ¥ 的，同样带 ¥ 的取字号最大的（付款截图里金额那一行字最大）
 * 2) 没有 ¥ 时，找整行就是一个数字、且字号明显比其他行大的
 */
function pickAmount(rows) {
  const yuan = [];
  rows.forEach(row => {
    const t = row.compact;
    if (!t || AMOUNT_BLOCK_WORDS.test(t)) return;
    const re = /¥\s*([0-9OoQIlL|iZzASsGbTBgq][0-9OoQIlL|iZzASsGbTBgq,.]{0,15})/g;
    let m;
    while ((m = re.exec(t))) {
      const v = amountFromToken(m[1]);
      if (v) yuan.push({ value: v, height: row.height, y: row.top, text: row.text, source: 'yuan' });
    }
  });
  if (yuan.length) {
    yuan.sort((a, b) => b.height - a.height || a.y - b.y);
    return yuan[0];
  }

  const plain = [];
  rows.forEach(row => {
    const t = row.compact;
    if (!t || AMOUNT_BLOCK_WORDS.test(t)) return;
    const body = stripSign(t);
    const cleaned = fixOcrDigits(body).replace(/[,\s]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return;                // 整行必须基本就是数字
    if (cleaned.replace(/\..*$/, '').length > 9) return;           // 太长，像订单号
    const v = amountFromToken(body);
    if (!v) return;
    if (!/\./.test(cleaned) && /^\d{4}$/.test(cleaned) && v >= 190000 && v <= 210000) return; // 像年份
    plain.push({ value: v, height: row.height, y: row.top, text: row.text, source: 'big' });
  });
  if (plain.length) {
    plain.sort((a, b) => b.height - a.height || a.y - b.y);
    return plain[0];
  }
  return null;
}

/* ------------------------------------------------------------ 日期 */

function isoFromParts(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 2000 || y > 2100) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function pickDate(rows, today) {
  const todayStr = today || todayIso();
  const todayY = Number(todayStr.slice(0, 4));
  const full = /(\d{4})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})\s*日?/;
  const part = /(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})\s*日/;

  for (const row of rows) {
    const m = full.exec(row.compact);
    if (!m) continue;
    const iso = isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso && iso <= addDaysIso(todayStr, 1)) return { date: iso, reason: '年月日' };
  }
  for (const row of rows) {
    const m = part.exec(row.compact);
    if (!m) continue;
    let iso = isoFromParts(todayY, Number(m[1]), Number(m[2]));
    if (!iso) continue;
    // 只写了月日、但比今天还晚很多，多半是去年的
    if (iso > addDaysIso(todayStr, 1)) iso = isoFromParts(todayY - 1, Number(m[1]), Number(m[2]));
    if (iso && iso <= addDaysIso(todayStr, 1)) return { date: iso, reason: '月日' };
  }
  return { date: todayStr, reason: '未识别到，用今天' };
}

function addDaysIso(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/* ------------------------------------------------------------ 方向 / 商户 */

const INCOME_HINTS = ['收款成功', '已到账', '到账', '退款', '已退款', '收入', '红包', '收款到账', '转账给你', '已收款', '入账', '收到'];
const EXPENSE_HINTS = ['支付成功', '付款成功', '已支付', '支付', '付款', '消费', '扣款', '扣费', '支出', '转出', '已扣款'];
const DIRECTION_LABELS = /收款方|收款人|收款账户|付款方|付款人|支付方式|付款方式|收款方式|支付账户/g;

function guessDirection(rows) {
  const text = rows.map(r => r.compact).join(' ').replace(DIRECTION_LABELS, '');
  let income = 0;
  let expense = 0;
  INCOME_HINTS.forEach(p => { if (text.indexOf(p) >= 0) income += p.length >= 3 ? 2 : 1; });
  EXPENSE_HINTS.forEach(p => { if (text.indexOf(p) >= 0) expense += p.length >= 3 ? 2 : 1; });
  return income > expense ? 'income' : 'expense';
}

const MERCHANT_LABELS = ['收款方', '商户名称', '商户全称', '商家名称', '收款商户', '收款单位', '店铺名称', '对方户名', '对方账户', '转账人', '转账方', '汇款人', '付款人', '收款人', '对方', '商户'];
const FIELD_LABELS = /^(收款方|收款人|收款账户|收款方式|付款方|付款人|转账人|转账方|汇款人|对方户名|支付方式|付款方式|支付账户|交易时间|支付时间|转账时间|创建时间|到账时间|交易单号|商户单号|订单号|订单编号|交易号|商品|商品说明|金额|状态|支付状态|交易状态|收单机构|清算机构|银行|卡号|备注|类型|交易类型|当前状态|服务|商户)/;

function pickMerchant(rows) {
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].compact;
    if (!t) continue;
    for (const label of MERCHANT_LABELS) {
      const idx = t.indexOf(label);
      if (idx < 0) continue;
      let rest = t.slice(idx + label.length).replace(/^[.:\s]+/, '').trim();
      rest = rest.replace(/[.:\s]+$/, '');
      if (rest.length >= 2 && !/^\d+$/.test(rest)) return cleanText(rest, 40);

      // 标签后面没内容 → 看紧随其后的行
      for (let j = i + 1; j < Math.min(i + 3, rows.length); j++) {
        const next = rows[j].compact;
        if (!next) continue;
        if (FIELD_LABELS.test(next)) break;
        if (next.length >= 2 && !/^\d+$/.test(next)) return cleanText(next, 40);
      }
    }
  }
  return '';
}

function cleanText(s, max) {
  return String(s || '').replace(/[.:\s]+$/, '').trim().slice(0, max || 40);
}

/* ------------------------------------------------------------ 分类 / 账户 */

const CATEGORY_KEYWORDS = {
  '餐饮': ['餐', '饭', '外卖', '美团', '饿了么', '咖啡', '奶茶', '星巴克', '肯德基', '麦当劳', '火锅', '烧烤', '面馆', '食品', '零食', '水果', '小吃', '快餐', '料理', '蛋糕', '甜品', '食堂', '餐厅', '饭店', '米线', '拉面', '汉堡', '披萨', '寿司', '烤肉', '茶', '酒', '饮'],
  '交通': ['地铁', '公交', '打车', '滴滴', '出租', '高铁', '火车', '机票', '航空', '加油', '停车', 'ETC', '单车', '车费', '运输'],
  '居住': ['房租', '物业', '水费', '电费', '燃气', '暖气', '家政', '中介', '租赁'],
  '通讯': ['话费', '流量', '宽带', '移动', '联通', '电信', '手机充值'],
  '医疗': ['医院', '药房', '药店', '诊所', '体检', '挂号', '门诊', '医疗'],
  '教育': ['学费', '培训', '课程', '书店', '图书', '教育', '网校', '考试'],
  '旅行': ['酒店', '民宿', '景区', '旅行', '旅游', '携程', '飞猪', '去哪儿', '门票'],
  '娱乐': ['电影', '影院', 'KTV', '游戏', '视频会员', '音乐', '演出', '剧院', '网吧'],
  '购物': ['淘宝', '天猫', '京东', '拼多多', '商城', '超市', '便利店', '百货', '服饰', '优衣库', '数码', '电器', '商场', '盒马', '永辉', '沃尔玛', '家乐福', '山姆', '大润发', '华润万家', '生鲜', '菜市场', '粮油', '屈臣氏'],
  '日用': ['日用', '纸巾', '洗护', '家居', '清洁', '日用百货'],
  '人情往来': ['红包', '礼金', '份子', '礼品'],
  '其他': []
};

function guessCategoryId(rows, kind, state) {
  const text = rows.map(r => r.compact).join('').replace(/收款方|商户名称|商户全称|商家名称/g, '');
  if (!text) return null;
  const cats = (state && state.categories ? state.categories : []).filter(c => c.kind === kind);
  for (const c of cats) {
    const words = CATEGORY_KEYWORDS[c.name];
    if (!words || !words.length) continue;
    for (const w of words) {
      if (text.indexOf(w) >= 0) return c.id;
    }
  }
  const other = cats.find(c => c.name === '其他');
  return other ? other.id : (cats[0] ? cats[0].id : null);
}

const BANK_KEYWORDS = ['工商银行', '建设银行', '农业银行', '中国银行', '交通银行', '招商银行', '邮储银行', '邮政储蓄', '民生银行', '浦发银行', '中信银行', '光大银行', '兴业银行', '广发银行', '平安银行', '华夏银行', '余额宝', '零钱通', '微信零钱', '支付宝', '花呗', '信用卡', '储蓄卡', '借记卡'];

function guessAccountId(rows, state) {
  const accounts = (state && state.accounts ? state.accounts : []).filter(a => !a.archived);
  if (!accounts.length) return null;
  const text = rows.map(r => r.compact).join(' ');

  // 1) 账户名出现在截图里；OCR 偶尔吃掉一两个字，所以允许用名字前缀匹配，取匹配最长的那个
  let hit = null;
  let hitLen = 0;
  accounts.forEach(a => {
    const name = normalizeOcr(a.name).replace(/\s+/g, '');
    for (let len = name.length; len >= 2; len--) {
      if (text.indexOf(name.slice(0, len)) >= 0) {
        if (len > hitLen) { hitLen = len; hit = a; }
        break;
      }
    }
  });
  if (hit) {
    const full = normalizeOcr(hit.name).replace(/\s+/g, '').length;
    return { id: hit.id, reason: hitLen >= full ? '截图里出现了这个账户名' : '账户名基本对上了' };
  }

  // 2) 账户名里的后四位数字出现在截图里
  let byDigits = null;
  accounts.forEach(a => {
    if (byDigits) return;
    const m = /(\d{4})/.exec(a.name);
    if (m && text.indexOf(m[1]) >= 0) byDigits = a;
  });
  if (byDigits) return { id: byDigits.id, reason: '尾号和账户名对上了' };

  // 3) 银行 / 渠道关键词
  let byBank = null;
  BANK_KEYWORDS.forEach(k => {
    if (byBank || text.indexOf(k) < 0) return;
    const found = accounts.find(a => normalizeOcr(a.name).replace(/\s+/g, '').indexOf(k) >= 0);
    if (found) byBank = found;
  });
  if (byBank) return { id: byBank.id, reason: '银行名对上了' };

  // 4) 最近一笔用过的账户
  const recent = (state.transactions || [])
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .find(t => accounts.some(a => a.id === t.accountId));
  if (recent) return { id: recent.accountId, reason: '沿用上次用的账户' };

  const cash = accounts.find(a => a.pool === 'cash');
  return { id: (cash || accounts[0]).id, reason: '默认第一个账户' };
}

/* ------------------------------------------------------------ 总入口 */

/**
 * 把一次 OCR 结果变成表单字段
 * @param {object} ocr   { ok, words, width, height }
 * @param {object} state 当前账本数据（用来猜账户和分类）
 * @param {string} today 'YYYY-MM-DD'
 */
function parseOcrResult(ocr, state, today) {
  const rows = groupOcrRows((ocr && ocr.words) || []);
  const rawText = rows.map(r => r.text).join('\n');
  const warnings = [];

  const amountHit = pickAmount(rows);
  const dateHit = pickDate(rows, today);
  const type = guessDirection(rows);
  const merchant = pickMerchant(rows);
  const categoryId = guessCategoryId(rows, type, state);
  const accountHit = guessAccountId(rows, state);

  if (!amountHit) warnings.push('没识别到金额，请手动填一下');
  if (dateHit.reason === '未识别到，用今天') warnings.push('没识别到日期，先按今天算');

  return {
    rows: rows,
    rawText: rawText,
    type: type,
    date: dateHit.date,
    dateReason: dateHit.reason,
    amount: amountHit ? amountHit.value : null,
    amountSource: amountHit ? amountHit.source : null,
    merchant: merchant,
    categoryId: categoryId,
    accountId: accountHit ? accountHit.id : null,
    accountReason: accountHit ? accountHit.reason : '',
    warnings: warnings
  };
}

/** 按截图内容猜一遍，出问题不影响使用 */
function safeParseOcr(ocr, state, today) {
  try {
    return parseOcrResult(ocr, state, today);
  } catch (e) {
    return {
      rows: [], rawText: '', type: 'expense', date: today || todayIso(), dateReason: '解析出错',
      amount: null, amountSource: null, merchant: '', categoryId: null, accountId: null,
      accountReason: '', warnings: ['自动识别出了点问题，请手动核对']
    };
  }
}
