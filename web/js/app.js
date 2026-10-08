'use strict';

/* ============================================================ 界面状态 */

const ui = {
  tab: 'overview',
  ledger: { from: thisMonthKey() + '-01', to: todayIso(), type: '', categoryId: '', accountId: '', keyword: '' },
  report: { month: thisMonthKey(), poolId: 'all', accountId: 'all' },
  hideArchived: true,
  importItems: [],
  ocrBusy: false,
  lastImport: null,
  importSeq: 0
};

/* ============================================================ 公共片段 */

function statCard(label, value, sub, cls) {
  return '<div class="stat ' + (cls || '') + '">' +
    '<div class="stat-label">' + esc(label) + '</div>' +
    '<div class="stat-value">' + value + '</div>' +
    (sub ? '<div class="stat-sub">' + sub + '</div>' : '') +
    '</div>';
}

function emptyBox(text, action) {
  return '<div class="empty"><div class="empty-emoji">🪴</div><p>' + esc(text) + '</p>' + (action || '') + '</div>';
}

function progressBar(ratio, color) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return '<div class="progress"><div class="progress-fill" style="width:' + pct.toFixed(1) + '%;background:' + (color || '#4f7ef7') + '"></div></div>';
}

function accountSelectOptions(filterPool, includeId) {
  const out = [{ value: '', label: '请选择账户' }];
  pools().forEach(p => {
    if (filterPool && p.id !== filterPool) return;
    (S.accounts || []).forEach(a => {
      if (a.pool !== p.id) return;
      if (a.archived && a.id !== includeId) return;
      out.push({ value: a.id, label: p.name + ' · ' + a.name + '（' + fmtMoney(accountValue(a)) + '）' });
    });
  });
  return out;
}

/* ============================================================ 顶栏 */

function renderTop() {
  const total = totalAssets();
  const parts = pools().map(p => {
    const v = poolTotal(p.id);
    return '<div class="top-pool"><span class="tp-name">' + esc(p.name) + '</span><span class="tp-val">' + fmtMoney(v) + '</span></div>';
  }).join('');
  $('#topAssets').innerHTML =
    '<div class="top-total"><span class="tt-label">总资产</span><span class="tt-value">' + fmtMoney(total) + '</span></div>' +
    '<div class="top-pools">' + parts + '</div>';
}

/* ============================================================ 总览 */

function viewOverview() {
  const t = todayIso();
  const month = thisMonthKey();
  const ms = monthSummary(month);
  const total = totalAssets();
  const goose = gooseStat();
  const poolList = pools().map(p => ({ p: p, total: poolTotal(p.id, t) }));
  const maxPool = Math.max(1, ...poolList.map(x => Math.abs(x.total)));
  const expenseCats = categoryBreakdown(month, 'expense');
  const expenseTotal = expenseCats.reduce((s, x) => s + x.value, 0);
  const assets = assetSeries(12, month);

  return '' +
  '<section class="stat-row">' +
    statCard('总资产', fmtMoney(total), '三个池子加起来') +
    statCard('本月收入', fmtMoney(ms.income), monthLabel(month), 'good') +
    statCard('本月支出', fmtMoney(ms.expense), monthLabel(month), 'bad') +
    statCard('本月结余', fmtMoney(ms.net, { sign: ms.net > 0 }), ms.net >= 0 ? '这个月存下来这么多' : '这个月花超了', ms.net >= 0 ? 'good' : 'bad') +
  '</section>' +

  '<section class="grid-2">' +
    '<div class="card">' +
      '<div class="card-head"><h2>三个池子</h2><button class="btn ghost small" data-act="go" data-tab="accounts">管理账户</button></div>' +
      '<ul class="pool-list">' +
        poolList.map(x =>
          '<li>' +
            '<div class="pl-top"><span class="pl-name">' + esc(x.p.name) + '</span><span class="pl-val">' + fmtMoney(x.total) + '</span></div>' +
            progressBar(Math.abs(x.total) / maxPool, x.p.id === 'cash' ? '#4f7ef7' : x.p.id === 'goal' ? '#f2994a' : '#27ae60') +
            '<div class="pl-sub">' + esc(x.p.desc) + ' · 占总资产 ' + (total > 0 ? (x.total / total * 100).toFixed(1) : '0.0') + '%</div>' +
          '</li>'
        ).join('') +
      '</ul>' +
    '</div>' +

    '<div class="card">' +
      '<div class="card-head"><h2>长期金鹅池</h2><button class="btn ghost small" data-act="go" data-tab="accounts">看明细</button></div>' +
      '<div class="goose-box">' +
        '<div class="goose-main"><div class="gm-label">当前市值</div><div class="gm-value">' + fmtMoney(goose.market) + '</div></div>' +
        '<div class="goose-grid">' +
          '<div><span>投入成本</span><b>' + fmtMoney(goose.cost) + '</b></div>' +
          '<div><span>浮动盈亏</span><b class="' + (goose.profit >= 0 ? 'up' : 'down') + '">' + fmtMoney(goose.profit, { sign: goose.profit > 0 }) + '</b></div>' +
          '<div><span>收益率</span><b class="' + (goose.profit >= 0 ? 'up' : 'down') + '">' + (goose.profitRate * 100).toFixed(2) + '%</b></div>' +
          '<div><span>账户数</span><b>' + goose.count + ' 个</b></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</section>' +

  '<section class="card">' +
    '<div class="card-head"><h2>资产趋势</h2><span class="muted">近 12 个月 · 金鹅池按市值计</span></div>' +
    lineChart(assets) +
  '</section>' +

  '<section class="grid-2">' +
    '<div class="card">' +
      '<div class="card-head"><h2>' + monthLabel(month) + ' 支出构成</h2><button class="btn ghost small" data-act="go" data-tab="reports">完整报表</button></div>' +
      (expenseCats.length
        ? '<div class="donut-wrap">' + donutChart(expenseCats.slice(0, 8), { centerTitle: '本月支出', centerValue: fmtMoney(expenseTotal), size: 190 }) +
          '<div class="legend-wrap">' + legendList(expenseCats.slice(0, 8), expenseTotal) + '</div></div>'
        : '<div class="chart-empty">这个月还没有支出记录</div>') +
    '</div>' +
    '<div class="card">' +
      '<div class="card-head"><h2>本月流水</h2><button class="btn ghost small" data-act="go" data-tab="ledger">去记账</button></div>' +
      recentList(6) +
    '</div>' +
  '</section>';
}

function recentList(n) {
  const month = thisMonthKey();
  const list = (S.transactions || [])
    .filter(t => monthKeyOf(t.date) === month)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
  if (!list.length) return '<div class="chart-empty">这个月还没有记过账</div>';
  return '<ul class="recent">' + list.map(t => {
    const cat = categoryById(t.categoryId);
    const a1 = accountById(t.accountId);
    const a2 = t.toAccountId ? accountById(t.toAccountId) : null;
    let right = '', sub = '';
    if (t.type === 'expense') { right = '<span class="amt out">-' + fmtMoney(t.amount) + '</span>'; sub = (cat ? cat.name : '支出') + ' · ' + (a1 ? a1.name : ''); }
    else if (t.type === 'income') { right = '<span class="amt in">+' + fmtMoney(t.amount) + '</span>'; sub = (cat ? cat.name : '收入') + ' · ' + (a1 ? a1.name : ''); }
    else if (t.type === 'transfer') { right = '<span class="amt mid">' + fmtMoney(t.amount) + '</span>'; sub = '调拨 · ' + (a1 ? a1.name : '') + ' → ' + (a2 ? a2.name : ''); }
    else { right = '<span class="amt">' + fmtMoney(t.amount, { sign: true }) + '</span>'; sub = '余额校准 · ' + (a1 ? a1.name : ''); }
    return '<li><div class="rc-left"><div class="rc-date">' + esc(dateLabel(t.date)) + '</div>' +
      '<div class="rc-sub">' + esc(sub) + (t.note ? ' · ' + esc(t.note) : '') + '</div></div>' + right + '</li>';
  }).join('') + '</ul>';
}

/* ============================================================ 记账 */

function viewLedger() {
  const f = ui.ledger;
  const catOptions = '<option value="">全部分类</option>' +
    categoriesOf('expense').map(c => '<option value="' + esc(c.id) + '">支出 · ' + esc(c.name) + '</option>').join('') +
    categoriesOf('income').map(c => '<option value="' + esc(c.id) + '">收入 · ' + esc(c.name) + '</option>').join('');
  const accOptions = '<option value="">全部账户</option>' +
    (S.accounts || []).map(a => '<option value="' + esc(a.id) + '">' + esc(poolById(a.pool).name + ' · ' + a.name) + '</option>').join('');

  return '' +
  '<div class="toolbar">' +
    '<div class="tb-left">' +
      '<h2 class="page-title">记账</h2>' +
      '<span class="muted">收入、支出、账户间调拨、余额校准都在这里</span>' +
    '</div>' +
    '<div class="tb-right">' +
      '<button class="btn ghost" data-act="go" data-tab="import">📷 截图导入</button>' +
      '<button class="btn primary" data-act="add-tx">＋ 记一笔</button>' +
    '</div>' +
  '</div>' +

  '<section class="card filters">' +
    '<div class="filter-row">' +
      '<label class="mini"><span>从</span><input type="date" id="fFrom" value="' + esc(f.from) + '"></label>' +
      '<label class="mini"><span>到</span><input type="date" id="fTo" value="' + esc(f.to) + '"></label>' +
      '<label class="mini"><span>类型</span><select id="fType">' +
        '<option value="">全部</option>' +
        Object.keys(TX_TYPES).map(k => '<option value="' + k + '"' + (f.type === k ? ' selected' : '') + '>' + TX_TYPES[k].name + '</option>').join('') +
      '</select></label>' +
      '<label class="mini"><span>分类</span><select id="fCat">' + catOptions + '</select></label>' +
      '<label class="mini"><span>账户</span><select id="fAcc">' + accOptions + '</select></label>' +
      '<label class="mini grow"><span>搜索</span><input type="text" id="fKw" placeholder="备注 / 账户 / 分类" value="' + esc(f.keyword) + '"></label>' +
      '<button class="btn ghost small" data-act="reset-filter">重置</button>' +
    '</div>' +
  '</section>' +

  '<div id="ledgerSummary"></div>' +
  '<section class="card" id="ledgerTable"></section>';
}

function bindLedgerFilters() {
  const map = { fFrom: 'from', fTo: 'to', fType: 'type', fCat: 'categoryId', fAcc: 'accountId', fKw: 'keyword' };
  Object.keys(map).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const ev = (el.tagName === 'SELECT' || el.type === 'date') ? 'change' : 'input';
    el.addEventListener(ev, () => {
      ui.ledger[map[id]] = el.value;
      updateLedger();
    });
  });
  $('#fCat').value = ui.ledger.categoryId;
  $('#fAcc').value = ui.ledger.accountId;
}

function updateLedger() {
  const list = filterTransactions(ui.ledger);
  let income = 0, expense = 0;
  list.forEach(t => { if (t.type === 'income') income += t.amount; else if (t.type === 'expense') expense += t.amount; });

  $('#ledgerSummary').innerHTML =
    '<section class="mini-stats">' +
      '<div class="ms"><span>筛选结果</span><b>' + list.length + ' 笔</b></div>' +
      '<div class="ms"><span>收入合计</span><b class="up">' + fmtMoney(income) + '</b></div>' +
      '<div class="ms"><span>支出合计</span><b class="down">' + fmtMoney(expense) + '</b></div>' +
      '<div class="ms"><span>净额</span><b class="' + (income - expense >= 0 ? 'up' : 'down') + '">' + fmtMoney(income - expense, { sign: income - expense > 0 }) + '</b></div>' +
    '</section>';

  if (!list.length) {
    $('#ledgerTable').innerHTML = emptyBox('这个范围里还没有流水', '<button class="btn primary" data-act="add-tx">记第一笔</button>');
    return;
  }

  const shown = list.slice(0, 400);
  $('#ledgerTable').innerHTML =
    '<table class="table"><thead><tr>' +
      '<th style="width:88px">日期</th><th style="width:70px">类型</th><th style="width:110px">分类</th>' +
      '<th>账户</th><th style="width:130px" class="right">金额</th><th>备注</th><th style="width:96px" class="right">操作</th>' +
    '</tr></thead><tbody>' +
    shown.map(txRow).join('') +
    '</tbody></table>' +
    (list.length > shown.length ? '<div class="muted pad">只显示最近 400 笔，共 ' + list.length + ' 笔。可以缩小日期范围。</div>' : '');
}

function txRow(t) {
  const cat = categoryById(t.categoryId);
  const a1 = accountById(t.accountId);
  const a2 = t.toAccountId ? accountById(t.toAccountId) : null;
  const typeInfo = TX_TYPES[t.type] || { name: t.type, cls: '' };
  let catHtml = '—', accHtml = '—', amtHtml = '';

  if (t.type === 'expense' || t.type === 'income') {
    catHtml = cat ? '<span class="chip" style="--c:' + esc(cat.color) + '">' + esc(cat.name) + '</span>' : '<span class="muted">未分类</span>';
    accHtml = esc(a1 ? a1.name : '已删除账户') + (a1 && a1.archived ? ' <span class="tag">已归档</span>' : '');
  } else if (t.type === 'transfer') {
    catHtml = '<span class="muted">—</span>';
    accHtml = esc(a1 ? a1.name : '?') + ' <span class="arrow">→</span> ' + esc(a2 ? a2.name : '?');
  } else {
    catHtml = '<span class="muted">余额校准</span>';
    accHtml = esc(a1 ? a1.name : '?');
  }

  if (t.type === 'expense') amtHtml = '<span class="amt out">-' + fmtMoney(t.amount) + '</span>';
  else if (t.type === 'income') amtHtml = '<span class="amt in">+' + fmtMoney(t.amount) + '</span>';
  else if (t.type === 'transfer') amtHtml = '<span class="amt mid">' + fmtMoney(t.amount) + '</span>';
  else amtHtml = '<span class="amt ' + (t.amount >= 0 ? 'in' : 'out') + '">' + fmtMoney(t.amount, { sign: true }) + '</span>';

  const goalChip = t.goalId && goalById(t.goalId) ? ' <span class="tag orange">' + esc(goalById(t.goalId).name) + '</span>' : '';

  return '<tr>' +
    '<td class="nowrap">' + esc(t.date) + '</td>' +
    '<td><span class="badge ' + typeInfo.cls + '">' + esc(typeInfo.name) + '</span></td>' +
    '<td>' + catHtml + '</td>' +
    '<td>' + accHtml + goalChip + '</td>' +
    '<td class="right">' + amtHtml + '</td>' +
    '<td class="note">' + esc(t.note || '') + '</td>' +
    '<td class="right nowrap">' +
      '<button class="icon-btn" data-act="edit-tx" data-id="' + esc(t.id) + '" title="编辑">✎</button>' +
      '<button class="icon-btn danger" data-act="del-tx" data-id="' + esc(t.id) + '" title="删除">🗑</button>' +
    '</td>' +
  '</tr>';
}

function openTxForm(tx) {
  const isEdit = !!tx;
  const base = tx ? {
    type: tx.type,
    date: tx.date,
    amount: tx.amount,
    accountId: tx.accountId,
    toAccountId: tx.toAccountId || '',
    categoryId: tx.categoryId || '',
    goalId: tx.goalId || '',
    note: tx.note || ''
  } : {
    type: 'expense',
    date: todayIso(),
    amount: '',
    accountId: (S.accounts.find(a => !a.archived) || {}).id || '',
    toAccountId: '',
    categoryId: (categoriesOf('expense')[0] || {}).id || '',
    goalId: '',
    note: ''
  };

  openForm({
    title: isEdit ? '编辑流水' : '记一笔',
    values: base,
    okText: isEdit ? '保存修改' : '记好了',
    fields: (v) => {
      const type = v.type || 'expense';
      const fields = [
        { name: 'type', label: '类型', type: 'select', required: true, rerender: true, options: [
          { value: 'expense', label: '支出' },
          { value: 'income', label: '收入' },
          { value: 'transfer', label: '账户之间调拨' },
          { value: 'adjust', label: '余额校准' }
        ] },
        { name: 'date', label: '日期', type: 'date', required: true }
      ];
      const accOpts = accountSelectOptions(null, v.accountId);
      if (type === 'expense' || type === 'income') {
        fields.push({ name: 'amount', label: '金额', type: 'money', required: true, positive: true });
        fields.push({ name: 'categoryId', label: '分类', type: 'select', required: true,
          options: categoriesOf(type).map(c => ({ value: c.id, label: c.name })) });
        fields.push({ name: 'accountId', label: type === 'expense' ? '从哪个账户支出' : '收入到哪个账户', type: 'select', required: true, options: accOpts });
        const gs = [{ value: '', label: '不关联目标' }].concat((S.goals || []).map(g => ({ value: g.id, label: g.name })));
        fields.push({ name: 'goalId', label: '关联目标（可选）', type: 'select', options: gs });
      } else if (type === 'transfer') {
        fields.push({ name: 'amount', label: '调拨金额', type: 'money', required: true, positive: true });
        fields.push({ name: 'accountId', label: '从哪个账户转出', type: 'select', required: true, options: accOpts });
        fields.push({ name: 'toAccountId', label: '转到哪个账户', type: 'select', required: true,
          options: [{ value: '', label: '请选择账户' }].concat(accOpts.slice(1)) });
      } else {
        fields.push({ name: 'accountId', label: '哪个账户', type: 'select', required: true, options: accOpts });
        fields.push({ name: 'targetBalance', label: '校准后的实际余额', type: 'money',
          hint: '填你现在真实看到的余额，系统会自动记一笔差额，不动历史记录' });
      }
      fields.push({ name: 'note', label: '备注', type: 'text', wide: true, placeholder: '例如：和朋友吃饭' });
      return fields;
    },
    onValidate: (out, raw) => {
      if (raw.type === 'transfer' && out.accountId === out.toAccountId) return '转出和转入不能是同一个账户';
      if (raw.type === 'adjust' && isNaN(parseMoney(raw.targetBalance))) return '请填写校准后的实际余额';
      return '';
    },
    onSubmit: async (out, raw) => {
      let payload;
      if (raw.type === 'adjust') {
        const acc = accountById(out.accountId);
        const delta = out.targetBalance - accountCostBalance(acc);
        if (delta === 0) throw new Error('这个账户余额已经是这个数字了，不用校准');
        payload = { type: 'adjust', date: out.date, amount: delta, accountId: out.accountId, note: out.note };
      } else {
        payload = {
          type: out.type, date: out.date, amount: out.amount, accountId: out.accountId,
          toAccountId: out.toAccountId || null, categoryId: out.categoryId || null,
          goalId: out.goalId || null, note: out.note
        };
      }
      if (isEdit) await mutateReq('PUT', '/transactions/' + tx.id, payload);
      else await mutateReq('POST', '/transactions', payload);
      render();
      toast(isEdit ? '修改已保存' : '记好了 ✅');
    }
  });
}

/* ============================================================ 账户 */

function viewAccounts() {
  const t = todayIso();
  const total = totalAssets();
  let html = '<div class="toolbar">' +
    '<div class="tb-left"><h2 class="page-title">账户</h2><span class="muted">每个账户属于一个池子，中短期池的账户还可以挂到具体目标下</span></div>' +
    '<div class="tb-right">' +
      '<button class="btn ghost" data-act="add-goal">＋ 新增目标</button>' +
      '<button class="btn primary" data-act="add-acc">＋ 新增账户</button>' +
    '</div>' +
  '</div>';

  pools().forEach(p => {
    const poolAccounts = accountsOfPool(p.id, false);
    const archived = accountsOfPool(p.id, true).filter(a => a.archived);
    const poolSum = poolAccounts.reduce((s, a) => s + accountValue(a, t), 0);

    html += '<section class="card pool-card pool-' + p.id + '">' +
      '<div class="card-head">' +
        '<h2>' + esc(p.name) + ' <span class="pool-sum">' + fmtMoney(poolSum) + '</span></h2>' +
        '<span class="muted">' + esc(p.desc) + ' · 占总资产 ' + (total > 0 ? (poolSum / total * 100).toFixed(1) : '0.0') + '%</span>' +
      '</div>';

    if (p.id === 'goal') {
      const goals = S.goals || [];
      html += '<div class="goal-grid">';
      if (!goals.length) {
        html += '<div class="empty small"><p>还没有目标。先加一个吧，比如「旅游计划」。</p><button class="btn primary" data-act="add-goal">新增目标</button></div>';
      }
      goals.forEach(g => { html += goalCard(g, t); });
      const orphans = accountsOfPool('goal', false).filter(a => !a.goalId);
      if (orphans.length) {
        html += '<div class="goal-block"><div class="goal-head"><div class="gh-left"><div class="gh-name">未归属目标的账户</div>' +
          '<div class="gh-sub">可以给它们指定一个目标</div></div></div><div class="acc-grid">' +
          orphans.map(a => accountCard(a, t)).join('') + '</div></div>';
      }
      html += '</div>';
    } else {
      html += '<div class="acc-grid">';
      if (!poolAccounts.length) {
        html += '<div class="empty small"><p>这个池子还没有账户。</p><button class="btn primary" data-act="add-acc" data-pool="' + p.id + '">添加一个</button></div>';
      }
      poolAccounts.forEach(a => { html += accountCard(a, t); });
      html += '</div>';
    }

    if (archived.length) {
      html += '<details class="archived"><summary>已归档账户（' + archived.length + '）</summary>' +
        '<div class="acc-grid">' + archived.map(a => accountCard(a, t)).join('') + '</div></details>';
    }
    html += '</section>';
  });

  return html;
}

function goalCard(g, t) {
  const pr = goalProgress(g, t);
  const days = g.dueDate ? Math.ceil((new Date(g.dueDate + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 86400000) : null;
  const dueText = g.dueDate ? '截止 ' + g.dueDate + (days !== null && days >= 0 ? '（还有 ' + days + ' 天）' : days !== null ? '（已过期）' : '') : '没有设置截止日期';

  return '<div class="goal-block' + (pr.done ? ' done' : '') + '">' +
    '<div class="goal-head">' +
      '<div class="gh-left">' +
        '<div class="gh-name">' + esc(g.name) + (pr.done ? ' <span class="tag green">已达成 🎉</span>' : '') + '</div>' +
        '<div class="gh-sub">' + esc(dueText) + (g.note ? ' · ' + esc(g.note) : '') + '</div>' +
      '</div>' +
      '<div class="gh-right">' +
        '<button class="icon-btn" data-act="edit-goal" data-id="' + esc(g.id) + '" title="编辑目标">✎</button>' +
        '<button class="icon-btn danger" data-act="del-goal" data-id="' + esc(g.id) + '" title="删除目标">🗑</button>' +
      '</div>' +
    '</div>' +
    '<div class="goal-nums">' +
      '<span class="big">' + fmtMoney(pr.saved) + '</span>' +
      '<span class="muted"> / 目标 ' + fmtMoney(pr.target) + '</span>' +
      '<span class="gh-pct">' + (pr.ratio * 100).toFixed(1) + '%</span>' +
    '</div>' +
    progressBar(pr.ratio, pr.done ? '#27ae60' : '#f2994a') +
    '<div class="goal-foot">' + (pr.done ? '已经攒够啦 🎉' : '还差 ' + fmtMoney(pr.remaining)) + '</div>' +
    (pr.accounts.length
      ? '<div class="acc-grid tight">' + pr.accounts.map(a => accountCard(a, t)).join('') + '</div>'
      : '<div class="muted pad">这个目标下还没有账户，添加一个专门存钱的地方吧</div>') +
    '<button class="btn ghost small" data-act="add-acc" data-pool="goal" data-goal="' + esc(g.id) + '">＋ 给这个目标添加账户</button>' +
  '</div>';
}

function accountCard(a, t) {
  const st = accountStat(a, t);
  let money = '<div class="acc-value">' + fmtMoney(st.value) + '</div>';
  if (a.pool === 'goose' && st.hasMarket) {
    money += '<div class="acc-sub">成本 ' + fmtMoney(st.cost) + ' · 市值 ' + fmtMoney(st.market) +
      ' · <b class="' + (st.profit >= 0 ? 'up' : 'down') + '">' + fmtMoney(st.profit, { sign: st.profit > 0 }) +
      '（' + (st.profitRate * 100).toFixed(2) + '%）</b></div>' +
      '<div class="acc-sub muted small">' + esc(st.marketDate || '—') + ' 的市值 ' + fmtMoney(st.anchor) +
      (st.added ? '，之后又' + (st.added > 0 ? '投入 ' : '取出 ') + fmtMoney(Math.abs(st.added)) : '') + '</div>';
  } else if (a.pool === 'goose') {
    money += '<div class="acc-sub muted">还没有填市值，先按投入成本算</div>';
  }

  return '<div class="acc-card' + (a.archived ? ' archived' : '') + '">' +
    '<div class="acc-top">' +
      '<div class="acc-name">' + esc(a.name) + '</div>' +
      '<span class="tag">' + esc(typeName(a.type)) + '</span>' +
    '</div>' +
    money +
    (a.note ? '<div class="acc-note">' + esc(a.note) + '</div>' : '') +
    '<div class="acc-actions">' +
      (a.pool === 'goose' ? '<button class="btn ghost small" data-act="valuation" data-id="' + esc(a.id) + '">更新市值</button>' : '') +
      '<button class="btn ghost small" data-act="edit-acc" data-id="' + esc(a.id) + '">编辑</button>' +
      '<button class="btn ghost small" data-act="archive-acc" data-id="' + esc(a.id) + '">' + (a.archived ? '恢复' : '归档') + '</button>' +
      '<button class="btn ghost small danger" data-act="del-acc" data-id="' + esc(a.id) + '">删除</button>' +
    '</div>' +
  '</div>';
}

function openAccountForm(acc, preset) {
  const p0 = preset || {};
  const vals = acc ? {
    name: acc.name, pool: acc.pool, type: acc.type, goalId: acc.goalId || '',
    openingBalance: acc.openingBalance, note: acc.note || ''
  } : {
    name: '', pool: p0.pool || 'cash', type: 'bank', goalId: p0.goalId || '',
    openingBalance: '', note: ''
  };

  openForm({
    title: acc ? '编辑账户' : '新增账户',
    values: vals,
    okText: acc ? '保存修改' : '添加账户',
    fields: (v) => {
      const fields = [
        { name: 'name', label: '账户名称', type: 'text', required: true, placeholder: '例如：招商银行储蓄卡' },
        { name: 'pool', label: '属于哪个池', type: 'select', required: true, rerender: true,
          options: pools().map(p => ({ value: p.id, label: p.name + '（' + p.desc + '）' })) },
        { name: 'type', label: '账户类型', type: 'select',
          options: accountTypes().map(t => ({ value: t.id, label: t.name })) }
      ];
      if ((v.pool || 'cash') === 'goal') {
        fields.push({ name: 'goalId', label: '挂到哪个目标下', type: 'select',
          options: [{ value: '', label: '暂不挂到目标' }].concat((S.goals || []).map(g => ({ value: g.id, label: g.name }))) });
      }
      fields.push({ name: 'openingBalance', label: '期初余额', type: 'money',
        hint: '记账起点的余额。所有流水都在这个数字上加减。' + (acc ? '' : '填 0 表示从零开始记。') });
      fields.push({ name: 'note', label: '备注', type: 'text', wide: true, placeholder: '例如：工资卡' });
      return fields;
    },
    onSubmit: async (out, raw) => {
      const payload = {
        name: out.name,
        pool: out.pool,
        type: out.type,
        goalId: out.pool === 'goal' ? (out.goalId || null) : null,
        openingBalance: isNaN(out.openingBalance) ? 0 : out.openingBalance,
        note: out.note
      };
      if (acc) await mutateReq('PUT', '/accounts/' + acc.id, payload);
      else await mutateReq('POST', '/accounts', payload);
      render();
      toast(acc ? '账户已更新' : '账户已添加');
    }
  });
}

function openValuationForm(acc) {
  const cur = accountStat(acc).hasMarket ? accountStat(acc).market : accountCostBalance(acc);
  openForm({
    title: '更新「' + acc.name + '」的市值',
    values: { marketValue: cur, date: todayIso() },
    okText: '更新',
    fields: [
      { name: 'marketValue', label: '现在值多少钱', type: 'money', required: true,
        hint: '当前总共值多少（不是赚了多少）。成本 ' + fmtMoney(accountCostBalance(acc)) + '，填完自动算盈亏。' },
      { name: 'date', label: '日期', type: 'date', required: true }
    ],
    onSubmit: async (out) => {
      await mutateReq('POST', '/accounts/' + acc.id + '/valuation', { marketValue: out.marketValue, date: out.date });
      render();
      toast('市值已更新');
    }
  });
}

function openGoalForm(g) {
  const vals = g ? { name: g.name, targetAmount: g.targetAmount, dueDate: g.dueDate || '', note: g.note || '' }
    : { name: '', targetAmount: '', dueDate: '', note: '' };
  openForm({
    title: g ? '编辑目标' : '新增目标',
    values: vals,
    okText: g ? '保存修改' : '添加目标',
    fields: [
      { name: 'name', label: '目标名称', type: 'text', required: true, placeholder: '例如：旅游计划' },
      { name: 'targetAmount', label: '目标金额', type: 'money', required: true, positive: true },
      { name: 'dueDate', label: '截止日期（可选）', type: 'date' },
      { name: 'note', label: '备注', type: 'text', wide: true, placeholder: '例如：明年春天去日本' }
    ],
    onSubmit: async (out) => {
      const payload = { name: out.name, targetAmount: out.targetAmount, dueDate: out.dueDate || null, note: out.note };
      if (g) await mutateReq('PUT', '/goals/' + g.id, payload);
      else await mutateReq('POST', '/goals', payload);
      render();
      toast(g ? '目标已更新' : '目标已添加');
    }
  });
}

/* ============================================================ 报表 */

/* ============================================================ 截图导入 */

function moneyToInput(cents) {
  if (cents === null || cents === undefined || !isFinite(cents)) return '';
  return (cents / 100).toFixed(2);
}

function defaultImportForm() {
  const accs = (S.accounts || []).filter(a => !a.archived);
  const recent = (S.transactions || [])
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map(t => t.accountId)
    .find(id => accs.some(a => a.id === id));
  const expCats = categoriesOf('expense');
  return {
    include: true,
    type: 'expense',
    date: todayIso(),
    amount: '',
    categoryId: (expCats[0] || {}).id || '',
    accountId: recent || (accs[0] ? accs[0].id : ''),
    toAccountId: '',
    note: ''
  };
}

/** 检查一条待入账记录填全了没，返回没填好的原因（填好了返回空串） */
/**
 * 切成「账户划拨」时，猜转入账户：
 * 截图里常常会写上对方账户名（比如备注认出来是「微信余额」），
 * 那就优先选它；猜不到再随便挑一个跟转出账户不同的。
 */
function guessTransferTarget(item) {
  const accs = (S.accounts || []).filter(a => !a.archived && a.id !== item.form.accountId);
  if (!accs.length) return '';
  const note = normalizeOcr(item.form.note || '').replace(/\s+/g, '');
  if (note) {
    const byNote = accs.find(a => {
      const n = normalizeOcr(a.name).replace(/\s+/g, '');
      return n.length >= 2 && note.indexOf(n) >= 0;
    });
    if (byNote) return byNote.id;
  }
  const raw = normalizeOcr(item.rawText || '').replace(/\s+/g, '');
  if (raw) {
    const byRaw = accs.find(a => {
      const n = normalizeOcr(a.name).replace(/\s+/g, '');
      return n.length >= 2 && raw.indexOf(n) >= 0;
    });
    if (byRaw) return byRaw.id;
  }
  return accs[0].id;
}

function importIssue(f) {
  if (f.type === 'transfer') {
    if (!(parseMoney(f.amount) > 0)) return '没填金额';
    if (!f.date) return '没填日期';
    if (!f.accountId) return '没选转出账户';
    if (!f.toAccountId) return '没选转入账户';
    if (f.toAccountId === f.accountId) return '转出和转入不能是同一个账户';
    return '';
  }
  if (!(parseMoney(f.amount) > 0)) return '没填金额';
  if (!f.date) return '没填日期';
  if (!f.accountId) return '没选账户';
  return '';
}

function viewImport() {
  const hasAccounts = (S.accounts || []).some(a => !a.archived);
  return '' +
  '<div class="toolbar">' +
    '<div class="tb-left">' +
      '<h2 class="page-title">截图导入</h2>' +
      '<span class="muted">把支付截图丢进来，自动认金额和日期，认错的地方直接改</span>' +
    '</div>' +
    '<div class="tb-right">' +
      '<button class="btn primary" data-act="pick-images">＋ 选择截图</button>' +
      '<button class="btn ghost" data-act="clear-import">清空列表</button>' +
    '</div>' +
  '</div>' +

  (hasAccounts ? '' :
    '<section class="card notice">还没有账户，先去「账户」里加一张银行卡或货基，截图才能入账。' +
    '<button class="btn ghost small" data-act="go" data-tab="accounts">去添加账户</button></section>') +

  '<section class="card dropzone" id="dropzone">' +
    '<div class="dz-emoji">📷</div>' +
    '<div class="dz-title">把支付截图拖到这里</div>' +
    '<div class="dz-sub">也可以点右上角「选择截图」，或者直接 Ctrl+V 粘贴。支持一次选多张。</div>' +
    '<div class="dz-note">图片只在你自己的电脑上识别，不会上传网络、也不会存进账本。</div>' +
  '</section>' +
  '<input type="file" id="importFiles" accept="image/*" multiple class="file-hidden">' +
  '<div class="engine-line" id="ocrEngine">识别引擎：检测中…</div>' +
  '<div class="feishu-line off" id="feishuLine"></div>' +

  '<div id="importDone"></div>' +
  '<div id="importSummary"></div>' +
  '<div id="batchTools"></div>' +
  '<div id="importList"></div>' +
  '<div id="importFooter"></div>';
}

function importStatusOf(item) {
  if (item.status === 'error') return { cls: 'err', text: '识别失败' };
  if (item.status === 'done') {
    const g = item.guess;
    if (!g) return { cls: 'warn', text: '需人工核对' };
    if (g.amount === null) return { cls: 'warn', text: '金额需手填' };
    return { cls: 'ok', text: '已识别' };
  }
  if (item.status === 'working') return { cls: 'busy', text: '识别中…' };
  return { cls: '', text: '排队中' };
}

/** 截图导入页顶部那行飞书状态：连没连上一眼就能看到 */
async function loadFeishuLine() {
  const box = document.getElementById('feishuLine');
  if (!box) return;
  let s = null;
  try {
    s = await api('GET', '/feishu/status');
  } catch (e) {
    box.innerHTML = '';
    return;
  }
  if (!document.getElementById('feishuLine')) return;
  const st = s.status || {};
  let cls = 'off';
  let text = '';
  if (!s.enabled) {
    text = '飞书自动收图没启用 —— 发给机器人的截图现在收不到';
  } else if (st.state === 'ok') {
    cls = 'ok';
    text = '飞书已连接 —— 发给机器人的截图会自动出现在下面';
  } else if (st.state === 'error') {
    cls = 'err';
    text = '飞书连不上：' + (st.message || '');
  } else {
    cls = 'busy';
    text = '飞书正在连接…';
  }
  box.className = 'feishu-line ' + cls;
  box.innerHTML = '<span class="fs-dot"></span><span class="fl-text">' + esc(text) + '</span>' +
    (!s.enabled || st.state === 'error'
      ? '<button class="btn ghost small" data-act="go" data-tab="settings">去设置</button>' : '') +
    (s.inboxCount ? '<span class="fl-count">收件箱还有 ' + s.inboxCount + ' 张待读</span>' : '');
}

/* 截图导入页开着的时候，每 10 秒去收件箱看一眼，新截图自动冒出来 */
let importPollTimer = null;
function stopImportPolling() {
  if (importPollTimer) { clearInterval(importPollTimer); importPollTimer = null; }
}
function startImportPolling() {
  stopImportPolling();
  importPollTimer = setInterval(async () => {
    if (ui.tab !== 'import') { stopImportPolling(); return; }
    await pullFeishuInbox();
    await loadFeishuLine();
  }, 10000);
}

async function loadOcrStatus() {
  const box = document.getElementById('ocrEngine');
  if (!box) return;
  try {
    const s = await api('GET', '/ocr/status');
    if (!document.getElementById('ocrEngine')) return;
    const ready = !!s.ready;
    box.innerHTML = '<span class="engine-badge ' + (ready ? 'ok' : (s.starting ? 'busy' : 'warn')) + '">' +
      (ready ? 'RapidOCR 高精度引擎' : (s.starting ? '引擎启动中' : '系统自带识别')) + '</span>' +
      '<span class="engine-msg">' + esc(s.message || '') + '</span>';
    if (!ready && s.starting) setTimeout(loadOcrStatus, 1500);
  } catch (e) {
    box.textContent = '';
  }
}

function importCardHtml(item) {
  const f = item.form;
  const st = importStatusOf(item);
  const isTransfer = f.type === 'transfer';
  const cats = categoriesOf(f.type);
  const warnings = (item.warnings || []).slice();
  const dup = findDuplicate(item);
  const issue = importIssue(f);

  const catOpts = cats.map(c => '<option value="' + esc(c.id) + '"' + (c.id === f.categoryId ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  const accOpts = (S.accounts || []).filter(a => !a.archived || a.id === f.accountId)
    .map(a => '<option value="' + esc(a.id) + '"' + (a.id === f.accountId ? ' selected' : '') + '>' +
      esc(poolById(a.pool).name + ' · ' + a.name) + '</option>').join('');
  const toAccOpts = '<option value="">请选择转入账户</option>' +
    (S.accounts || []).filter(a => !a.archived || a.id === f.toAccountId)
      .map(a => '<option value="' + esc(a.id) + '"' + (a.id === f.toAccountId ? ' selected' : '') + '>' +
        esc(poolById(a.pool).name + ' · ' + a.name) + '</option>').join('');

  const rawBlock = item.rawText
    ? '<details class="imp-raw"><summary>看识别到的原文</summary><pre>' + esc(item.rawText) + '</pre></details>'
    : '';

  return '<div class="imp-card' + (f.include ? '' : ' off') + '" data-id="' + esc(item.id) + '">' +
    '<div class="imp-left">' +
      '<img class="imp-thumb" src="' + esc(item.previewUrl) + '" data-act="zoom" data-id="' + esc(item.id) + '" alt="截图">' +
      '<label class="imp-check"><input type="checkbox" data-imp="include" data-id="' + esc(item.id) + '"' + (f.include ? ' checked' : '') + '> 计入</label>' +
    '</div>' +
    '<div class="imp-main">' +
      '<div class="imp-head">' +
        '<span class="imp-name" title="' + esc(item.name) + '">' + esc(item.name) + '</span>' +
        '<span class="imp-badge ' + st.cls + '">' + esc(st.text) + '</span>' +
        '<span class="imp-actions">' +
          '<button class="icon-btn" data-act="re-ocr" data-id="' + esc(item.id) + '" title="重新识别">↻</button>' +
          '<button class="icon-btn danger" data-act="del-import" data-id="' + esc(item.id) + '" title="移除">🗑</button>' +
        '</span>' +
      '</div>' +
      (warnings.length ? '<div class="imp-warn">' + warnings.map(esc).join(' · ') + '</div>' : '') +
      (issue && item.form.include ? '<div class="imp-warn">' + esc(issue) + '</div>' : '') +
      (dup === 'ledger' ? '<div class="imp-warn dup">账本里已经有一笔一样的（同日期同金额同账户），可能是重复截图</div>' : '') +
      (dup === 'batch' ? '<div class="imp-warn dup">这次导入里还有一张一模一样的，可能是重复拍了</div>' : '') +
      (item.status === 'error' ? '<div class="imp-warn">' + esc(item.error || '识别失败') + '，可以手动填写下面几项</div>' : '') +
      '<div class="imp-fields">' +
        '<label class="mini imp-type"><span>类型</span><select data-imp="type" data-id="' + esc(item.id) + '">' +
          '<option value="expense"' + (f.type === 'expense' ? ' selected' : '') + '>支出</option>' +
          '<option value="income"' + (f.type === 'income' ? ' selected' : '') + '>收入</option>' +
          '<option value="transfer"' + (f.type === 'transfer' ? ' selected' : '') + '>账户划拨</option>' +
        '</select></label>' +
        '<label class="mini imp-date"><span>日期</span><input type="date" data-imp="date" data-id="' + esc(item.id) + '" value="' + esc(f.date) + '"></label>' +
        '<label class="mini imp-amount"><span>金额</span><input type="text" inputmode="decimal" placeholder="0.00" data-imp="amount" data-id="' + esc(item.id) + '" value="' + esc(f.amount) + '"></label>' +
        (isTransfer ? '' :
          '<label class="mini imp-cat"><span>分类</span><select data-imp="categoryId" data-id="' + esc(item.id) + '">' + catOpts + '</select></label>') +
        '<label class="mini wide"><span>' + (isTransfer ? '从哪个账户转出' : '账户') + '</span><select data-imp="accountId" data-id="' + esc(item.id) + '">' + accOpts + '</select></label>' +
        (isTransfer
          ? '<label class="mini wide"><span>转到哪个账户</span><select data-imp="toAccountId" data-id="' + esc(item.id) + '">' + toAccOpts + '</select></label>'
          : '') +
        '<label class="mini wide2"><span>备注</span><input type="text" data-imp="note" data-id="' + esc(item.id) + '" value="' + esc(f.note) + '" placeholder="商户 / 用途"></label>' +
      '</div>' +
      rawBlock +
    '</div>' +
  '</div>';
}

function findDuplicate(item) {
  const amount = parseMoney(item.form.amount);
  if (!amount || amount <= 0 || !item.form.date) return false;
  const isTransfer = item.form.type === 'transfer';
  const same = o => o.date === item.form.date && o.amount === amount && o.type === item.form.type &&
    o.accountId === item.form.accountId &&
    (!isTransfer || o.toAccountId === item.form.toAccountId);
  const inLedger = (S.transactions || []).some(t =>
    same({ date: t.date, amount: t.amount, type: t.type, accountId: t.accountId, toAccountId: t.toAccountId }));
  if (inLedger) return 'ledger';
  const inBatch = ui.importItems.some(x =>
    x.id !== item.id && x.form.include &&
    same({
      date: x.form.date, amount: parseMoney(x.form.amount), type: x.form.type,
      accountId: x.form.accountId, toAccountId: x.form.toAccountId
    }));
  return inBatch ? 'batch' : false;
}

function renderImportList() {
  const box = document.getElementById('importList');
  if (!box) return;
  if (!ui.importItems.length) {
    box.innerHTML = '';
  } else {
    box.innerHTML = ui.importItems.map(importCardHtml).join('');
  }
  renderBatchTools();
  updateImportSummary();
  bindDropzone();
}

function renderBatchTools() {
  const box = document.getElementById('batchTools');
  if (!box) return;
  if (ui.importItems.length < 2) { box.innerHTML = ''; return; }
  const accOpts = (S.accounts || []).filter(a => !a.archived)
    .map(a => '<option value="' + esc(a.id) + '">' + esc(poolById(a.pool).name + ' · ' + a.name) + '</option>').join('');
  const catOpts = categoriesOf('expense').map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('');
  box.innerHTML = '<div class="card batch-tools">' +
    '<span class="bt-label">批量设置：</span>' +
    '<label class="mini"><span>账户</span><select id="bulkAccount">' + accOpts + '</select></label>' +
    '<button class="btn ghost small" data-act="apply-bulk" data-field="accountId" data-src="bulkAccount">应用到全部</button>' +
    '<span class="bt-sep"></span>' +
    '<label class="mini"><span>分类</span><select id="bulkCategory">' + catOpts + '</select></label>' +
    '<button class="btn ghost small" data-act="apply-bulk" data-field="categoryId" data-src="bulkCategory">应用到全部</button>' +
    '<span class="bt-sep"></span>' +
    '<button class="btn ghost small" data-act="sort-import">按日期排序</button>' +
  '</div>';
}

function updateImportSummary() {
  const sum = document.getElementById('importSummary');
  const foot = document.getElementById('importFooter');
  if (!sum || !foot) return;

  const total = ui.importItems.length;
  const done = ui.importItems.filter(i => i.status === 'done' || i.status === 'error').length;
  const working = ui.importItems.filter(i => i.status === 'working').length;
  const included = ui.importItems.filter(i => i.form.include);

  if (!total) {
    sum.innerHTML = '';
    foot.innerHTML = '';
    return;
  }

  let income = 0, expense = 0, transferSum = 0, transferCount = 0, ready = 0, bad = 0;
  included.forEach(i => {
    const amount = parseMoney(i.form.amount);
    if (!importIssue(i.form)) {
      ready++;
      if (i.form.type === 'income') income += amount;
      else if (i.form.type === 'transfer') { transferSum += amount; transferCount++; }
      else expense += amount;
    } else {
      bad++;
    }
  });

  sum.innerHTML = '<section class="mini-stats">' +
    '<div class="ms"><span>截图</span><b>' + total + ' 张</b></div>' +
    '<div class="ms"><span>识别进度</span><b>' + done + ' / ' + total + (working ? '（' + working + ' 张处理中）' : '') + '</b></div>' +
    '<div class="ms"><span>本次计入</span><b>' + included.length + ' 笔</b></div>' +
    '<div class="ms"><span>支出合计</span><b class="down">' + fmtMoney(expense) + '</b></div>' +
    '<div class="ms"><span>收入合计</span><b class="up">' + fmtMoney(income) + '</b></div>' +
    (transferCount ? '<div class="ms"><span>账户划拨</span><b class="mid">' + fmtMoney(transferSum) + '</b></div>' : '') +
  '</section>';

  let leftText;
  if (!included.length) leftText = '<span class="muted">没有勾选任何记录</span>';
  else if (bad) {
    const firstBad = included.find(i => !!importIssue(i.form));
    const why = firstBad ? importIssue(firstBad.form) : '有内容没填完整';
    leftText = '<span class="if-bad">有 ' + bad + ' 笔还没填好：' + esc(why) + '（已经标在对应那张上）</span>';
  }
  else leftText = '<span class="muted">' + (ready === 1 ? '这一笔填好了' : ready + ' 笔都填好了') +
    '，合计净额 ' + fmtMoney(income - expense, { sign: income - expense > 0 }) +
    (transferCount ? '（另有 ' + transferCount + ' 笔划拨，不计入收支）' : '') + '</span>';

  const dateList = included.map(i => i.form.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const range = dateList.length
    ? (dateList[0] === dateList[dateList.length - 1]
      ? dateLabel(dateList[0])
      : dateLabel(dateList[0]) + ' ~ ' + dateLabel(dateList[dateList.length - 1]))
    : '';

  const btnText = !ready ? '一起入账' : (ready === 1 ? '把这笔入账' : '把 ' + ready + ' 笔一起入账');
  foot.innerHTML = '<div class="imp-footer">' +
    '<div class="if-left">' + leftText +
      (range ? '<span class="if-range">覆盖 ' + esc(range) + '</span>' : '') +
    '</div>' +
    '<div class="if-right">' +
      '<button class="btn ghost" data-act="uncheck-all">全部不计入</button>' +
      '<button class="btn primary" data-act="submit-import"' + (ready && !bad ? '' : ' disabled') + '>' + esc(btnText) + '</button>' +
    '</div>' +
  '</div>';
}

function updateImportCard(id) {
  const item = ui.importItems.find(i => i.id === id);
  const el = document.querySelector('.imp-card[data-id="' + id + '"]');
  if (!item) { renderImportList(); return; }
  if (!el) { renderImportList(); return; }
  el.outerHTML = importCardHtml(item);
  updateImportSummary();
}

/* ---------------------------------------------------------- 加图片 / 识别 */

function bindDropzone() {
  const dz = document.getElementById('dropzone');
  const picker = document.getElementById('importFiles');
  if (picker && !picker.dataset.bound) {
    picker.dataset.bound = '1';
    picker.addEventListener('change', () => addImportFiles(picker.files));
  }
  if (dz && !dz.dataset.bound) {
    dz.dataset.bound = '1';
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault();
      dz.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault();
      dz.classList.remove('over');
    }));
    dz.addEventListener('drop', e => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) addImportFiles(files);
    });
    dz.addEventListener('click', e => {
      if (e.target.closest('[data-act]')) return;
      const p = document.getElementById('importFiles');
      if (p) p.click();
    });
  }
}

function addImportFiles(fileList) {
  const files = Array.prototype.slice.call(fileList || []).filter(f => /^image\//.test(f.type));
  if (!files.length) { toast('没有找到图片文件', 'error'); return; }
  let added = 0;
  files.forEach(file => {
    if (newImportItem(file)) added++;
  });
  if (!added) return;
  const doneBox = document.getElementById('importDone');
  if (doneBox) doneBox.innerHTML = '';
  renderImportList();
  runOcrQueue();
}

/** 建一条待识别记录；飞书来的会额外带 feishuName */
function newImportItem(file, extra) {
  if (!file) return null;
  if (file.size > 15 * 1024 * 1024) { toast((file.name || '图片') + ' 太大了，跳过', 'error'); return null; }
  const item = {
    id: 'imp_' + (++ui.importSeq) + '_' + Date.now().toString(36),
    file: file,
    name: file.name || ('截图 ' + ui.importSeq),
    previewUrl: URL.createObjectURL(file),
    status: 'waiting',
    error: '',
    guess: null,
    rawText: '',
    warnings: [],
    feishuName: '',
    form: defaultImportForm()
  };
  if (extra) Object.assign(item, extra);
  ui.importItems.push(item);
  return item;
}

/** 把飞书机器人收到的截图拉进待识别队列 */
async function pullFeishuInbox() {
  let data = null;
  try {
    data = await api('GET', '/feishu/inbox');
  } catch (e) {
    return;
  }
  const files = (data && data.files) || [];
  if (!files.length) return;
  const known = {};
  ui.importItems.forEach(i => { if (i.feishuName) known[i.feishuName] = 1; });
  const fresh = files.filter(f => !known[f.name]);
  if (!fresh.length) return;

  let added = 0;
  for (const f of fresh) {
    try {
      const res = await fetch('/api/feishu/image/' + encodeURIComponent(f.name));
      if (!res.ok) continue;
      const blob = await res.blob();
      const file = new File([blob], f.name, { type: blob.type || 'image/png' });
      if (newImportItem(file, { feishuName: f.name })) added++;
    } catch (e) { /* 单张失败不影响其它 */ }
  }
  if (!added) return;
  const doneBox = document.getElementById('importDone');
  if (doneBox) doneBox.innerHTML = '';
  renderImportList();
  runOcrQueue();
  toast('从飞书收到 ' + added + ' 张截图');
}

async function runOcrQueue() {
  if (ui.ocrBusy) return;
  if (!ui.importItems.some(i => i.status === 'waiting')) return;
  ui.ocrBusy = true;
  try {
    await Promise.all([ocrWorker(), ocrWorker()]);
  } finally {
    ui.ocrBusy = false;
    updateImportSummary();
  }
}

async function ocrWorker() {
  for (;;) {
    const item = ui.importItems.find(i => i.status === 'waiting');
    if (!item) return;
    item.status = 'working';
    updateImportCard(item.id);
    await runOneOcr(item);
  }
}

async function runOneOcr(item) {
  try {
    const dataUrl = await prepareImageForOcr(item.file);
    const res = await api('POST', '/ocr', { image: dataUrl });
    if (!res || !res.ok) throw new Error((res && res.error) || '识别失败');
    const g = safeParseOcr(res, S, todayIso());
    item.guess = g;
    item.rawText = g.rawText;
    item.warnings = g.warnings.slice();
    item.engine = res.engine || '';
    if (res.fallback) item.warnings.push('这张用的是系统自带识别（精度较低），建议核对一下');
    item.form.type = g.type;
    item.form.date = g.date;
    if (g.amount !== null) item.form.amount = moneyToInput(g.amount);
    if (g.categoryId) item.form.categoryId = g.categoryId;
    if (g.accountId) item.form.accountId = g.accountId;
    if (g.merchant && !item.form.note) item.form.note = g.merchant;
    item.status = 'done';
  } catch (e) {
    item.status = 'error';
    item.error = e.message || '识别失败';
    item.warnings = [];
  }
  updateImportCard(item.id);
  updateImportSummary();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('读取图片失败'));
    fr.readAsDataURL(file);
  });
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片打不开'));
    img.src = src;
  });
}

/** 太大的图先缩小，识别更快，传输也更省 */
async function prepareImageForOcr(file) {
  const raw = await fileToDataUrl(file);
  const MAX = 2000;
  let img;
  try {
    img = await loadImageEl(raw);
  } catch (e) {
    return raw;
  }
  const long = Math.max(img.width, img.height);
  if (long <= MAX && file.size <= 4 * 1024 * 1024) return raw;
  const scale = Math.min(1, MAX / long);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  try {
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch (e) {
    return raw;
  }
}

/* ---------------------------------------------------------- 入账 */

async function submitImport() {
  const items = ui.importItems.filter(i => i.form.include);
  if (!items.length) { toast('没有勾选任何记录', 'error'); return; }

  const bad = items.filter(i => !!importIssue(i.form));
  if (bad.length) {
    toast('有 ' + bad.length + ' 笔还没填完整，已经标出来了', 'error');
    const el = document.querySelector('.imp-card[data-id="' + bad[0].id + '"]');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  const payload = items.map(i => ({
    type: i.form.type,
    date: i.form.date,
    amount: parseMoney(i.form.amount),
    accountId: i.form.accountId,
    toAccountId: i.form.type === 'transfer' ? (i.form.toAccountId || null) : null,
    categoryId: i.form.categoryId || null,
    note: i.form.note || ''
  }));

  const btn = document.querySelector('[data-act="submit-import"]');
  if (btn) { btn.disabled = true; btn.textContent = '入账中…'; }
  try {
    const res = await mutateReq('POST', '/transactions/batch', { items: payload });
    const count = (res && res.count) || payload.length;
    const fsNames = items.map(i => i.feishuName).filter(Boolean);
    if (fsNames.length) {
      try { await api('POST', '/feishu/consume', { names: fsNames }); } catch (e) { /* ignore */ }
    }
    clearImportItems();
    render();
    const doneBox = document.getElementById('importDone');
    if (doneBox) {
      doneBox.innerHTML = '<section class="card ok-card">✅ 已经把 ' + count + ' 笔记进账本了。' +
        '<button class="btn ghost small" data-act="go" data-tab="ledger">去看看流水</button></section>';
    }
    toast('已入账 ' + count + ' 笔');
  } catch (e) {
    toast(e.message || '入账失败', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '把 ' + items.length + ' 笔一起入账'; }
  }
}

function clearImportItems() {
  ui.importItems.forEach(i => { try { URL.revokeObjectURL(i.previewUrl); } catch (e) { /* ignore */ } });
  ui.importItems = [];
}

function removeImportItem(id) {
  const i = ui.importItems.find(x => x.id === id);
  if (i) { try { URL.revokeObjectURL(i.previewUrl); } catch (e) { /* ignore */ } }
  ui.importItems = ui.importItems.filter(x => x.id !== id);
  if (i && i.feishuName) {
    api('POST', '/feishu/consume', { names: [i.feishuName] }).catch(() => { /* ignore */ });
  }
  renderImportList();
}

function zoomImage(id) {
  const item = ui.importItems.find(i => i.id === id);
  if (!item) return;
  openModal(item.name, '<div class="zoom-wrap"><img src="' + esc(item.previewUrl) + '" alt="截图"></div>', { hideCancel: true, okText: '关闭', noFocus: true });
  const card = document.querySelector('#modal .modal-card');
  if (card) card.style.maxWidth = '780px';
  $('#modalOk').onclick = () => closeModal();
}

function handleImportInput(el, rerender) {
  const id = el.dataset.id;
  const item = ui.importItems.find(i => i.id === id);
  if (!item) return;
  const field = el.dataset.imp;
  const value = el.type === 'checkbox' ? el.checked : el.value;
  item.form[field] = value;
  if (field === 'type') {
    const cats = categoriesOf(value);
    if (!cats.some(c => c.id === item.form.categoryId)) item.form.categoryId = (cats[0] || {}).id || '';
    // 切到划拨时，如果还没选转入账户，先替它挑一个不同的账户
    if (value === 'transfer' && !item.form.toAccountId) {
      item.form.toAccountId = guessTransferTarget(item);
    }
    updateImportCard(id);
    return;
  }
  if (field === 'include') {
    const card = document.querySelector('.imp-card[data-id="' + id + '"]');
    if (card) card.classList.toggle('off', !value);
  }
  // 选账户/日期/勾选这类改动要立刻重画卡片，好把"没填对"的原因显示出来；
  // 文本框（金额、备注）不重画，否则打字时焦点会丢。
  if (el.tagName === 'SELECT' || el.type === 'date' || el.type === 'checkbox') {
    updateImportCard(id);
  } else {
    updateImportSummary();
  }
}

function applyBulk(field, srcId) {
  const src = document.getElementById(srcId);
  if (!src) return;
  const value = src.value;
  let n = 0;
  ui.importItems.forEach(i => {
    if (!i.form.include) return;
    // 划拨有「转出/转入」两个账户，统一设置账户没有意义，跳过
    if (i.form.type === 'transfer') return;
    if (field === 'categoryId') {
      const cats = categoriesOf(i.form.type);
      if (!cats.some(c => c.id === value)) return;
    }
    i.form[field] = value;
    n++;
  });
  renderImportList();
  toast('已把 ' + n + ' 笔的' + (field === 'accountId' ? '账户' : '分类') + '统一设置');
}

/* ============================================================ 报表 */

function viewReports() {
  const r = ui.report;
  const accOptions = [{ value: 'all', label: '全部账户' }].concat(
    (S.accounts || []).filter(a => r.poolId === 'all' || a.pool === r.poolId)
      .map(a => ({ value: a.id, label: poolById(a.pool).name + ' · ' + a.name }))
  );

  return '<div class="toolbar">' +
      '<div class="tb-left"><h2 class="page-title">报表</h2><span class="muted">按月看收支，按池子或账户筛选</span></div>' +
      '<div class="tb-right">' +
        '<label class="mini"><span>月份</span><input type="month" id="rMonth" value="' + esc(r.month) + '"></label>' +
        '<label class="mini"><span>账户池</span><select id="rPool">' +
          '<option value="all">全部池子</option>' +
          pools().map(p => '<option value="' + p.id + '"' + (r.poolId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
        '</select></label>' +
        '<label class="mini"><span>账户</span><select id="rAcc">' +
          accOptions.map(o => '<option value="' + esc(o.value) + '"' + (r.accountId === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') +
        '</select></label>' +
        '<button class="btn ghost small" data-act="export-csv">导出流水 CSV</button>' +
      '</div>' +
    '</div>' +
    '<div id="reportBody"></div>';
}

function reportFilter() {
  return { poolId: ui.report.poolId, accountId: ui.report.accountId };
}

function updateReport() {
  const r = ui.report;
  const f = reportFilter();
  const ms = monthSummary(r.month, f);
  const expenseCats = categoryBreakdown(r.month, 'expense', f);
  const incomeCats = categoryBreakdown(r.month, 'income', f);
  const expenseTotal = expenseCats.reduce((s, x) => s + x.value, 0);
  const incomeTotal = incomeCats.reduce((s, x) => s + x.value, 0);
  const flow = monthlyFlowSeries(12, r.month, f);
  const assets = assetSeries(12, r.month, f);

  $('#reportBody').innerHTML =
    '<section class="stat-row">' +
      statCard('收入', fmtMoney(ms.income), monthLabel(r.month) + ' · ' + ms.count + ' 笔流水', 'good') +
      statCard('支出', fmtMoney(ms.expense), '平均每天 ' + fmtMoney(Math.round(ms.expense / daysInMonth(r.month))), 'bad') +
      statCard('结余', fmtMoney(ms.net, { sign: ms.net > 0 }), ms.net >= 0 ? '存下来的钱' : '这个月花超了', ms.net >= 0 ? 'good' : 'bad') +
      statCard('结余率', (ms.income > 0 ? (ms.net / ms.income * 100).toFixed(1) : '0.0') + '%', '结余 ÷ 收入') +
    '</section>' +

    '<section class="grid-2">' +
      '<div class="card"><div class="card-head"><h2>支出分类占比</h2><span class="muted">' + monthLabel(r.month) + '</span></div>' +
        (expenseTotal
          ? '<div class="donut-wrap">' + donutChart(expenseCats, { centerTitle: '支出', centerValue: fmtMoney(expenseTotal) }) +
            '<div class="legend-wrap">' + legendList(expenseCats, expenseTotal) + '</div></div>'
          : '<div class="chart-empty">这个月没有支出</div>') +
      '</div>' +
      '<div class="card"><div class="card-head"><h2>收入分类占比</h2><span class="muted">' + monthLabel(r.month) + '</span></div>' +
        (incomeTotal
          ? '<div class="donut-wrap">' + donutChart(incomeCats, { centerTitle: '收入', centerValue: fmtMoney(incomeTotal) }) +
            '<div class="legend-wrap">' + legendList(incomeCats, incomeTotal) + '</div></div>'
          : '<div class="chart-empty">这个月没有收入</div>') +
      '</div>' +
    '</section>' +

    '<section class="card"><div class="card-head"><h2>近 12 个月收支</h2>' +
      '<span class="legend-inline"><i class="sq" style="background:' + CHART.income + '"></i>收入' +
      '<i class="sq" style="background:' + CHART.expense + '"></i>支出</span></div>' +
      barsChart(flow) +
    '</section>' +

    '<section class="card"><div class="card-head"><h2>资产趋势</h2><span class="muted">近 12 个月 · 每月月底</span></div>' +
      lineChart(assets) +
    '</section>';
}

/* ============================================================ 设置 */

function viewSettings() {
  const catBlock = (kind, title) =>
    '<div class="cat-col"><div class="cat-head"><h3>' + title + '</h3>' +
      '<button class="btn ghost small" data-act="add-cat" data-kind="' + kind + '">＋ 添加</button></div>' +
      '<ul class="cat-list">' + categoriesOf(kind).map(c =>
        '<li><span class="dot" style="background:' + esc(c.color) + '"></span>' +
        '<span class="cat-name">' + esc(c.name) + '</span>' +
        (c.builtin ? '<span class="tag">内置</span>' : '') +
        '<span class="cat-actions">' +
          '<button class="icon-btn" data-act="edit-cat" data-id="' + esc(c.id) + '" title="改名">✎</button>' +
          (c.builtin ? '' : '<button class="icon-btn danger" data-act="del-cat" data-id="' + esc(c.id) + '" title="删除">🗑</button>') +
        '</span></li>').join('') + '</ul></div>';

  return '<div class="toolbar"><div class="tb-left"><h2 class="page-title">设置</h2>' +
      '<span class="muted">分类管理、数据备份与还原</span></div></div>' +

    '<section class="card"><div class="card-head"><h2>分类管理</h2><span class="muted">内置分类可以改名但不能删除</span></div>' +
      '<div class="cat-cols">' + catBlock('expense', '支出分类') + catBlock('income', '收入分类') + '</div>' +
    '</section>' +

    '<section class="card"><div class="card-head"><h2>飞书自动收图</h2>' +
      '<span class="muted">把支付截图发给飞书机器人，「截图导入」页会自动读进来</span></div>' +
      '<div id="feishuBox"><div class="muted pad">读取中…</div></div>' +
    '</section>' +

    '<section class="card"><div class="card-head"><h2>手机访问</h2>' +
      '<span class="muted">手机和电脑连同一个 WiFi 就能用，不用装 App</span></div>' +
      '<div id="lanBox"><div class="muted pad">读取中…</div></div>' +
    '</section>' +

    '<section class="card"><div class="card-head"><h2>数据备份</h2>' +
      '<span class="muted">数据保存在 data/finance.json，每次保存前都会自动备份</span></div>' +
      '<div class="data-actions">' +
        '<a class="btn primary" href="/api/backup" download>导出备份文件</a>' +
        '<label class="btn ghost">导入备份文件<input type="file" id="importFile" accept=".json,application/json" style="display:none"></label>' +
        '<button class="btn ghost" data-act="seed">载入示例数据</button>' +
        '<button class="btn danger" data-act="reset">清空全部数据</button>' +
      '</div>' +
      '<div class="muted small pad">载入示例数据和清空数据都会覆盖当前内容（覆盖前会自动备份一份）。</div>' +
    '</section>' +

    '<section class="card"><div class="card-head"><h2>从自动备份恢复</h2><span class="muted">最近 50 份</span></div>' +
      '<div id="backupList"><div class="muted pad">读取中…</div></div>' +
    '</section>' +

    '<section class="card"><div class="card-head"><h2>关于</h2></div>' +
      '<p class="about">这是一个纯本地运行的个人财务助手：数据只存在你自己的电脑上，不联网、不上传、不需要账号。</p>' +
      '<p class="about muted">三大账户池：日常现金池 / 中短期目标池 / 长期金鹅池。</p>' +
    '</section>';
}

const FEISHU_HELP = '' +
  '<ol class="fs-steps">' +
    '<li><b>这一步最容易走错</b>：要建的是「<b>企业自建应用</b>」，不是群里的「自定义机器人 / 群机器人」。' +
      '自定义机器人只能往外发消息、收不到消息，用它做不了这件事。</li>' +
    '<li>浏览器打开 <b>open.feishu.cn</b> → 右上角「开发者后台」→「创建企业自建应用」，名字随便起，比如「记账机器人」。</li>' +
    '<li>进应用后，左侧「添加应用能力」→ 选「<b>机器人</b>」→ 添加。</li>' +
    '<li>左侧「权限管理」，搜索并开通这两个权限：' +
      '<code>im:message</code>（获取与发送单聊、群组消息）和 <code>im:resource</code>（获取消息中的资源文件）。</li>' +
    '<li>左侧「事件与回调」→「事件配置」→ 订阅方式选「<b>使用长连接接收事件</b>」→ 添加事件「<b>接收消息 im.message.receive_v1</b>」。' +
      '（长连接不用填公网地址，本机直接连出去）</li>' +
    '<li>左侧「版本管理与发布」→ 创建版本并发布。个人版飞书一般能直接发布，公司版可能需要管理员点一下同意。</li>' +
    '<li>回到「凭证与基础信息」，把 <b>App ID</b> 和 <b>App Secret</b> 填到上面，勾上「启用」，点保存。' +
      '<b>这一步不做，机器人收到的图程序是拿不到的。</b></li>' +
    '<li>然后在飞书里搜索你刚建的机器人，把支付截图<b>发给它</b>（单聊或拉个群都行）。</li>' +
  '</ol>' +
  '<div class="fs-tip">注意：飞书不允许机器人读你「发给自己」的消息，所以要发给机器人，不能发给自己的文件传输助手。</div>';

const FEISHU_TROUBLE = '' +
  '<div class="fs-trouble">' +
    '<b>连不上时按顺序检查这几项：</b>' +
    '<ol class="fs-steps">' +
      '<li>App ID / App Secret 有没有抄错（多复制了空格也算错）。</li>' +
      '<li>「版本管理与发布」里有没有<b>创建版本并发布</b>；没发布的应用连不上。</li>' +
      '<li>权限里有没有开通 <code>im:message</code> 和 <code>im:resource</code>。</li>' +
      '<li>事件订阅方式是不是选的「<b>使用长连接接收事件</b>」，并添加了「接收消息」事件。</li>' +
      '<li>确认你建的是「<b>企业自建应用</b>」的机器人，不是群里的「自定义机器人」。</li>' +
    '</ol>' +
  '</div>';

async function loadFeishuPanel() {
  const box = document.getElementById('feishuBox');
  if (!box) return;
  let s = null;
  try {
    s = await api('GET', '/feishu/status');
  } catch (e) {
    box.innerHTML = '<div class="muted pad">读取失败：' + esc(e.message) + '</div>';
    return;
  }
  if (!document.getElementById('feishuBox')) return;

  const st = s.status || {};
  const cls = st.state === 'ok' ? 'ok' : (st.state === 'error' ? 'err' : (st.state === 'connecting' ? 'busy' : 'off'));
  box.innerHTML =
    '<div class="fs-state ' + cls + '"><span class="fs-dot"></span>' + esc(st.message || '未启用') +
      (st.saved ? '<span class="fs-count">已收到 ' + st.saved + ' 张</span>' : '') +
    '</div>' +
    '<div class="fs-form">' +
      '<label class="mini"><span>App ID</span><input type="text" id="fsAppId" value="' + esc(s.appId || '') + '" placeholder="cli_xxxxxxxxxxxx"></label>' +
      '<label class="mini"><span>App Secret</span><input type="password" id="fsSecret" placeholder="' +
        (s.hasSecret ? esc(s.secretMask || '已保存') + '（留空表示不改）' : '填一次就存下来') + '"></label>' +
      '<label class="switch fs-enable"><input type="checkbox" id="fsEnabled"' + (s.enabled ? ' checked' : '') + '><span>启用</span></label>' +
      '<button class="btn primary" data-act="save-feishu">保存并连接</button>' +
      '<button class="btn ghost small" data-act="refresh-feishu">刷新状态</button>' +
      (s.appId || s.hasSecret ? '<button class="btn ghost small danger" data-act="clear-feishu-cred">清除凭据</button>' : '') +
    '</div>' +
    (s.inboxCount
      ? '<div class="fs-inbox">飞书收件箱里还有 <b>' + s.inboxCount + '</b> 张图没处理。' +
        '去「截图导入」页会自动读进来 <button class="btn ghost small" data-act="clear-feishu">全部删掉</button></div>'
      : '') +
    (st.state === 'error' ? FEISHU_TROUBLE : '') +
    '<details class="fs-help"><summary>怎么申请 App ID / App Secret（一次性，约 3 分钟）</summary>' + FEISHU_HELP + '</details>';

  if (st.state === 'connecting') setTimeout(loadFeishuPanel, 2500);
}

async function loadLanPanel() {
  const box = document.getElementById('lanBox');
  if (!box) return;
  let s = null;
  try {
    s = await api('GET', '/lan/info');
  } catch (e) {
    box.innerHTML = '<div class="muted pad">读取失败：' + esc(e.message) + '</div>';
    return;
  }
  if (!document.getElementById('lanBox')) return;

  if (!s.addresses || !s.addresses.length) {
    box.innerHTML = '<div class="lan-note">这台电脑现在没连上 WiFi 或网线，手机暂时连不过来。连上网络后回到这一页刷新就行。</div>';
    return;
  }

  box.innerHTML =
    '<div class="lan-url">' + esc(s.addresses[0].url) + '</div>' +
    '<div class="lan-code">' + esc(s.token) + '</div>' +
    '<div class="lan-note">' +
      '① 手机连上和电脑 <b>同一个 WiFi</b>（不要用流量）<br>' +
      '② 手机浏览器打开上面那行网址<br>' +
      '③ 第一次会让你输配对码，就是下面那 6 位，输一次以后就记住了<br>' +
      '④ 想更像 App，可以在手机浏览器里选「添加到主屏幕」' +
    '</div>' +
    '<div class="lan-warn">' +
      '手机打不开？多半是 Windows 防火墙拦了：双击 <b>tools\\开启手机访问.bat</b> 放行一下即可。<br>' +
      '这个网址只在同一个 WiFi 下有效，出门就用不了了。' +
    '</div>' +
    (s.addresses.length > 1
      ? '<div class="lan-note" style="margin-top:8px">（这台电脑有多个网段，上面是主用地址。如果连不上，也可以试：' +
        s.addresses.slice(1).map(a => esc(a.url)).join(' 、 ') + '）</div>'
      : '');
}

async function loadBackupList() {
  const box = document.getElementById('backupList');
  if (!box) return;
  try {
    const data = await api('GET', '/backups');
    const list = data.backups || [];
    if (!list.length) {
      box.innerHTML = '<div class="muted pad">还没有自动备份。记第一笔账之后就会有了。</div>';
      return;
    }
    box.innerHTML = '<ul class="backup-list">' + list.slice(0, 20).map(b =>
      '<li><span class="bk-name">' + esc(b.name.replace(/^finance-|\.json$/g, '')) + '</span>' +
      '<span class="muted small">' + (b.size / 1024).toFixed(1) + ' KB</span>' +
      '<button class="btn ghost small" data-act="restore-backup" data-name="' + esc(b.name) + '">恢复这一份</button></li>').join('') + '</ul>';
  } catch (e) {
    box.innerHTML = '<div class="muted pad">读取备份列表失败：' + esc(e.message) + '</div>';
  }
}

/* ============================================================ 渲染入口 */

function render() {
  $$('#nav .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  renderTop();

  const view = $('#view');
  if (ui.tab === 'overview') view.innerHTML = viewOverview();
  else if (ui.tab === 'ledger') { view.innerHTML = viewLedger(); bindLedgerFilters(); updateLedger(); }
  else if (ui.tab === 'import') {
    view.innerHTML = viewImport();
    renderImportList();
    loadOcrStatus();
    loadFeishuLine();
    pullFeishuInbox().then(startImportPolling);
  }
  else if (ui.tab === 'accounts') view.innerHTML = viewAccounts();
  else if (ui.tab === 'reports') { view.innerHTML = viewReports(); bindReportFilters(); updateReport(); }
  else if (ui.tab === 'settings') { view.innerHTML = viewSettings(); loadBackupList(); loadFeishuPanel(); loadLanPanel(); }
  if (ui.tab !== 'import') stopImportPolling();
}

function bindReportFilters() {
  const bind = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      ui.report[key] = el.value;
      if (key === 'poolId') ui.report.accountId = 'all';
      render();
    });
  };
  bind('rMonth', 'month');
  bind('rPool', 'poolId');
  bind('rAcc', 'accountId');
}

/* ============================================================ 事件 */

document.addEventListener('click', async (e) => {
  const navBtn = e.target.closest('#nav .tab');
  if (navBtn) {
    ui.tab = navBtn.dataset.tab;
    render();
    return;
  }

  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;

  try {
    if (act === 'go') { ui.tab = btn.dataset.tab; render(); return; }

    if (act === 'add-tx') { openTxForm(null); return; }
    if (act === 'edit-tx') { openTxForm((S.transactions || []).find(t => t.id === id)); return; }
    if (act === 'del-tx') {
      const t = (S.transactions || []).find(x => x.id === id);
      if (!t) return;
      if (await confirmBox('删除这笔流水？', '删除后就找不回来了，账户余额也会跟着变。')) {
        await mutateReq('DELETE', '/transactions/' + id);
        render();
        toast('已删除');
      }
      return;
    }

    if (act === 'add-acc') {
      openAccountForm(null, { pool: btn.dataset.pool || (ui.tab === 'accounts' ? undefined : 'cash'), goalId: btn.dataset.goal || '' });
      return;
    }
    if (act === 'edit-acc') { openAccountForm(accountById(id)); return; }
    if (act === 'valuation') { openValuationForm(accountById(id)); return; }
    if (act === 'archive-acc') {
      const a = accountById(id);
      if (!a) return;
      const next = !a.archived;
      if (next && !(await confirmBox('归档这个账户？', '归档后它不计入总资产，但历史流水都还在。之后可以随时恢复。', { okText: '归档', danger: false }))) return;
      await mutateReq('PUT', '/accounts/' + id, { archived: next });
      render();
      toast(next ? '已归档' : '已恢复');
      return;
    }
    if (act === 'del-acc') {
      const a = accountById(id);
      if (!a) return;
      if (!(await confirmBox('删除账户「' + a.name + '」？', '如果这个账户已经有流水，系统会拦下来并建议你改成归档。'))) return;
      await mutateReq('DELETE', '/accounts/' + id);
      render();
      toast('账户已删除');
      return;
    }

    if (act === 'add-goal') { openGoalForm(null); return; }
    if (act === 'edit-goal') { openGoalForm(goalById(id)); return; }
    if (act === 'del-goal') {
      const g = goalById(id);
      if (!g) return;
      if (!(await confirmBox('删除目标「' + g.name + '」？', '目标下面的账户会被保留，只是不再挂在任何目标下。'))) return;
      await mutateReq('DELETE', '/goals/' + id);
      render();
      toast('目标已删除');
      return;
    }

    if (act === 'reset-filter') {
      ui.ledger = { from: '', to: '', type: '', categoryId: '', accountId: '', keyword: '' };
      render();
      return;
    }

    if (act === 'add-cat') {
      const kind = btn.dataset.kind;
      openForm({
        title: (kind === 'income' ? '新增收入分类' : '新增支出分类'),
        values: { name: '' },
        okText: '添加',
        fields: [{ name: 'name', label: '分类名称', type: 'text', required: true, placeholder: '例如：宠物' }],
        onSubmit: async (out) => {
          await mutateReq('POST', '/categories', { name: out.name, kind: kind });
          render();
          toast('分类已添加');
        }
      });
      return;
    }
    if (act === 'edit-cat') {
      const c = categoryById(id);
      openForm({
        title: '修改分类名称',
        values: { name: c.name },
        fields: [{ name: 'name', label: '分类名称', type: 'text', required: true }],
        onSubmit: async (out) => {
          await mutateReq('PUT', '/categories/' + c.id, { name: out.name });
          render();
          toast('已改名');
        }
      });
      return;
    }
    if (act === 'del-cat') {
      const c = categoryById(id);
      if (!(await confirmBox('删除分类「' + c.name + '」？', '如果已经有流水用到它，系统会拦下来。'))) return;
      await mutateReq('DELETE', '/categories/' + id);
      render();
      toast('分类已删除');
      return;
    }

    if (act === 'seed') {
      const hasData = (S.accounts || []).length > 0 || (S.transactions || []).length > 0;
      const msg = hasData
        ? '⚠️ 你的账本里已经有数据了！载入示例会把它全部覆盖掉（覆盖前会自动备份一份，但请先确认你不需要现有数据）。'
        : '会用一份示例账本写入当前的空账本。';
      if (!(await confirmBox(hasData ? '确定要覆盖现有数据？' : '载入示例数据？', msg, { okText: hasData ? '我确定，覆盖' : '载入' }))) return;
      await mutateReq('POST', '/seed', { force: true });
      render();
      toast('示例数据已载入');
      return;
    }
    if (act === 'reset') {
      if (!(await confirmBox('清空全部数据？', '所有账户、目标、流水都会被删除（清空前会自动备份一份）。请确认你已经导出过备份。'))) return;
      await mutateReq('POST', '/reset', { force: true });
      render();
      toast('已清空');
      return;
    }
    if (act === 'restore-backup') {
      const name = btn.dataset.name;
      if (!(await confirmBox('恢复到这一份备份？', '当前数据会被这一份备份覆盖（覆盖前会自动备份一份）。'))) return;
      await mutateReq('POST', '/backups/restore', { name: name });
      render();
      toast('已恢复');
      return;
    }
    if (act === 'export-csv') {
      exportCsv();
      return;
    }

    /* ------------------------------------------------------ 截图导入 */

    if (act === 'pick-images') {
      const p = document.getElementById('importFiles');
      if (p) p.click();
      return;
    }
    if (act === 'clear-import') {
      if (!ui.importItems.length) return;
      if (!(await confirmBox('清空截图列表？', '只是把待入账的截图去掉，不会动账本里已有的记录。'))) return;
      clearImportItems();
      render();
      return;
    }
    if (act === 'del-import') { removeImportItem(id); return; }
    if (act === 'zoom') { zoomImage(id); return; }
    if (act === 're-ocr') {
      const it = ui.importItems.find(x => x.id === id);
      if (!it) return;
      it.status = 'waiting';
      it.error = '';
      it.warnings = [];
      updateImportCard(id);
      runOcrQueue();
      return;
    }
    if (act === 'apply-bulk') {
      applyBulk(btn.dataset.field, btn.dataset.src);
      return;
    }
    if (act === 'sort-import') {
      ui.importItems.sort((a, b) => {
        const da = a.form.date || '';
        const db = b.form.date || '';
        if (da !== db) return da.localeCompare(db);
        return String(a.name).localeCompare(String(b.name), 'zh');
      });
      renderImportList();
      toast('已按日期排好');
      return;
    }
    if (act === 'uncheck-all') {
      ui.importItems.forEach(i => { i.form.include = false; });
      renderImportList();
      return;
    }
    if (act === 'submit-import') { await submitImport(); return; }

    /* ------------------------------------------------------ 飞书连接 */

    if (act === 'save-feishu') {
      const appId = (document.getElementById('fsAppId') || {}).value || '';
      const secret = (document.getElementById('fsSecret') || {}).value || '';
      const enabled = !!(document.getElementById('fsEnabled') || {}).checked;
      if (!appId.trim()) { toast('请先填 App ID', 'error'); return; }
      await mutateReq('POST', '/feishu/config', { appId: appId.trim(), appSecret: secret, enabled: enabled });
      toast(enabled ? '已保存，正在连接飞书…' : '已保存（未启用）');
      setTimeout(loadFeishuPanel, 1500);
      return;
    }
    if (act === 'refresh-feishu') { await loadFeishuPanel(); return; }
    if (act === 'clear-feishu-cred') {
      if (!(await confirmBox('清除飞书凭据？', 'App ID 和 App Secret 会从本机删掉，飞书连接会断开。以后想用再填一次就行。'))) return;
      await mutateReq('POST', '/feishu/config', { appId: '', clearSecret: true, enabled: false });
      toast('凭据已清除');
      await loadFeishuPanel();
      return;
    }
    if (act === 'clear-feishu') {
      if (!(await confirmBox('清掉飞书收件箱里的图片？', '这些是还没读进「截图导入」的截图，删掉就没了（飞书聊天里还在，可以重新发一次）。'))) return;
      const r = await api('POST', '/feishu/clear', {});
      toast('清掉了 ' + ((r && r.removed) || 0) + ' 张');
      await loadFeishuPanel();
      return;
    }
  } catch (err) {
    toast(err.message || '操作失败', 'error');
  }
});

document.addEventListener('input', (e) => {
  const el = (e.target && e.target.closest) ? e.target.closest('[data-imp]') : null;
  if (!el) return;
  handleImportInput(el);
});

document.addEventListener('change', async (e) => {
  if (e.target && e.target.id === 'importFile') {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!(await confirmBox('导入这份备份？', '当前数据会被覆盖（覆盖前会自动备份一份）。'))) { e.target.value = ''; return; }
      await mutateReq('POST', '/restore', { data: data });
      render();
      toast('导入成功');
    } catch (err) {
      toast('导入失败：' + (err.message || '文件格式不正确'), 'error');
    } finally {
      e.target.value = '';
    }
  }
});

/* 在截图导入页按 Ctrl+V 可以直接粘贴截图 */
document.addEventListener('paste', (e) => {
  if (ui.tab !== 'import') return;
  const items = (e.clipboardData && e.clipboardData.items) || [];
  const files = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
      const f = items[i].getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length) return;
  e.preventDefault();
  addImportFiles(files);
});

/* 拖到页面别的地方时不要触发浏览器打开图片 */
['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => {
  if (ui.tab === 'import' && !e.target.closest('#dropzone')) e.preventDefault();
}));

function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv() {
  const f = ui.report;
  const rows = [['日期', '类型', '分类', '账户', '转入账户', '金额', '备注']];
  (S.transactions || [])
    .filter(t => monthKeyOf(t.date) === f.month)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(t => {
      const cat = categoryById(t.categoryId);
      const a1 = accountById(t.accountId);
      const a2 = t.toAccountId ? accountById(t.toAccountId) : null;
      rows.push([
        t.date,
        (TX_TYPES[t.type] || {}).name || t.type,
        cat ? cat.name : '',
        a1 ? a1.name : '',
        a2 ? a2.name : '',
        (t.amount / 100).toFixed(2),
        t.note || ''
      ]);
    });
  const csv = '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '流水-' + f.month + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================ 启动 */

(async function boot() {
  try {
    await refresh();
    $('#loading').classList.add('hidden');
    render();
  } catch (e) {
    $('#loading').innerHTML = '读取数据失败：' + esc(e.message) + '<br>请关掉黑色窗口，重新双击「启动助手.bat」。';
  }
})();
