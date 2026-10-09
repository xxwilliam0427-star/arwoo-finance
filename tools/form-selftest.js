'use strict';

// Exercise the real form renderer and save handler without touching ledger data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const elements = new Map();
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, {
    innerHTML: '', textContent: '', style: {}, dataset: {},
    classList: { add() {}, remove() {} }, addEventListener() {}, focus() {}
  });
  return elements.get(selector);
}
const context = vm.createContext({
  document: { querySelector: element }, setTimeout() {}, clearTimeout() {}
});
for (const file of ['core.js', 'ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'js', file), 'utf8'), context);
}

async function save(initial, edit, rerender = false, name = 'amount', positive = true) {
  let submitted;
  const field = { name, label: '金额', type: 'money', required: positive, positive };
  const values = context.openForm({
    title: '编辑', values: { [name]: initial, note: '', type: 'expense' },
    fields: () => [field, { name: 'note', type: 'text', label: '备注' }],
    onSubmit(out) { submitted = out; }
  });
  const body = element('#modalBody');
  if (typeof initial === 'number' && Number.isFinite(initial)) {
    assert.ok(body.innerHTML.includes('value="' + (initial / 100).toFixed(2) + '"'));
  }
  body.oninput({ target: { name: 'note', type: 'text', value: '仅修改备注' } });
  if (edit !== undefined) body.oninput({ target: { name, type: 'text', value: edit } });
  if (rerender) body.onchange({ target: {
    name: 'type', type: 'select', value: 'income', dataset: { rerender: '1' }
  } });
  await element('#modalOk').onclick();
  assert.equal(values.note, '仅修改备注');
  return submitted;
}

(async () => {
  for (const amount of [2100, 2137, 1]) {
    assert.equal((await save(amount)).amount, amount, '金额未改动时保持原值');
    assert.equal((await save(amount, undefined, true)).amount, amount, '重绘后保持原值');
  }
  assert.equal((await save(2100, '21')).amount, 2100);
  assert.equal((await save(2100, '21.37', true)).amount, 2137);
  assert.equal((await save('', '21')).amount, 2100, '新建时元转换为分');
  assert.equal((await save('', '0.01')).amount, 1);
  for (const name of ['openingBalance', 'targetAmount', 'marketValue']) {
    assert.equal((await save(2100, undefined, true, name))[name], 2100);
  }
  assert.equal((await save(-2100, undefined, false, 'openingBalance', false)).openingBalance, -2100);
  assert.equal((await save(0, undefined, false, 'openingBalance', false)).openingBalance, 0);
  for (const invalid of ['', 'abc', '0', '-21', Infinity, NaN]) {
    assert.equal(await save(invalid), undefined, '无效金额不可提交');
  }
  console.log('金额表单回归测试通过：保留原金额、修改金额、新建、重绘、共享表单和校验。');
})().catch(err => { console.error(err); process.exitCode = 1; });
