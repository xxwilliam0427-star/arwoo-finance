'use strict';

/* ============================================================ 提示条 */

let toastTimer = null;
function toast(msg, kind) {
  const box = $('#toast');
  box.textContent = msg;
  box.className = 'toast ' + (kind || 'info');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = 'toast hidden'; }, 3200);
}

/* ============================================================ 弹窗 / 表单 */

function closeModal() {
  $('#modal').classList.add('hidden');
  const card = $('#modal .modal-card');
  if (card) card.style.maxWidth = '';
}

function openModal(title, bodyHtml, opts) {
  const o = opts || {};
  $('#modalOk').onclick = null;
  $('#modalCancel').onclick = null;
  $('#modalClose').onclick = null;
  $('#modalTitle').textContent = title;
  $('#modalBody').oninput = null;
  $('#modalBody').onchange = null;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalError').textContent = '';
  $('#modalOk').textContent = o.okText || '保存';
  $('#modalOk').className = 'btn ' + (o.okClass || 'primary');
  $('#modalCancel').textContent = o.cancelText || '取消';
  $('#modalCancel').style.display = o.hideCancel ? 'none' : '';
  $('#modal').classList.remove('hidden');
  const first = $('#modalBody input, #modalBody select, #modalBody textarea');
  if (first && !o.noFocus) setTimeout(() => first.focus(), 30);
  return o;
}

function showModalError(msg) {
  $('#modalError').textContent = msg || '';
}

/**
 * 通用表单弹窗
 * fields 可以是数组，也可以是 (values) => 数组 的函数（值变化时按需重绘）
 */
function openForm(cfg) {
  const values = Object.assign({}, cfg.values || {});
  const dynamic = typeof cfg.fields === 'function';

  function getFields() {
    return dynamic ? cfg.fields(values) : cfg.fields;
  }

  function renderBody() {
    const fields = getFields().filter(f => !f.hidden);
    $('#modalBody').innerHTML = fields.map(f => fieldHtml(f, values[f.name])).join('');
  }

  renderBody();
  openModal(cfg.title, '', { okText: cfg.okText, hideCancel: cfg.hideCancel, okClass: cfg.okClass, cancelText: cfg.cancelText, noFocus: true });
  // openModal 会清空 body，这里重新写入
  renderBody();
  const first = $('#modalBody input, #modalBody select, #modalBody textarea');
  if (first) setTimeout(() => first.focus(), 30);

  $('#modalBody').oninput = (e) => {
    const el = e.target;
    if (!el.name) return;
    values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  };
  $('#modalBody').onchange = (e) => {
    const el = e.target;
    if (!el.name) return;
    values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.rerender === '1') {
      renderBody();
      const again = $('#modalBody [name="' + el.name + '"]');
      if (again) again.focus();
    }
  };

  $('#modalOk').onclick = async () => {
    const fields = getFields().filter(f => !f.hidden);
    const out = {};
    for (const f of fields) {
      let v = values[f.name];
      if (f.type === 'checkbox') {
        v = !!v;
      } else if (f.type === 'money') {
        v = parseMoney(v);
        if (isNaN(v)) return showModalError('「' + f.label + '」请填写正确的金额');
      } else if (f.type === 'number') {
        v = Number(v);
        if (!isFinite(v)) return showModalError('「' + f.label + '」请填写正确的数字');
      } else {
        v = (v === undefined || v === null) ? '' : String(v);
      }
      if (f.required) {
        if (f.type === 'checkbox') { /* 复选框不做必填校验 */ }
        else if (v === '' || (f.type === 'money' && v === 0) ) return showModalError('请填写「' + f.label + '」');
      }
      if (f.type === 'money' && f.positive && v <= 0) return showModalError('「' + f.label + '」必须大于 0');
      if (f.type === 'number' && f.positive && v <= 0) return showModalError('「' + f.label + '」必须大于 0');
      out[f.name] = v;
    }
    if (cfg.onValidate) {
      const msg = cfg.onValidate(out, values);
      if (msg) return showModalError(msg);
    }
    const btn = $('#modalOk');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      await cfg.onSubmit(out, values);
      closeModal();
    } catch (err) {
      showModalError(err.message || '保存失败');
    } finally {
      btn.disabled = false;
      btn.textContent = cfg.okText || '保存';
    }
  };
  return values;
}

function fieldHtml(f, value) {
  const v = value === undefined || value === null ? (f.value !== undefined ? f.value : '') : value;
  const label = '<label class="field ' + (f.wide ? 'wide' : '') + '">' +
    '<span class="field-label">' + esc(f.label) + (f.required ? ' <i class="req">*</i>' : '') + '</span>';
  const hint = f.hint ? '<span class="field-hint">' + esc(f.hint) + '</span>' : '';
  let control = '';

  if (f.type === 'select') {
    control = '<select name="' + esc(f.name) + '"' + (f.rerender ? ' data-rerender="1"' : '') + '>' +
      (f.options || []).map(o => {
        const sel = String(o.value) === String(v) ? ' selected' : '';
        return '<option value="' + esc(o.value) + '"' + sel + '>' + esc(o.label) + '</option>';
      }).join('') + '</select>';
  } else if (f.type === 'textarea') {
    control = '<textarea name="' + esc(f.name) + '" rows="2" placeholder="' + esc(f.placeholder || '') + '">' + esc(v) + '</textarea>';
  } else if (f.type === 'checkbox') {
    control = '<label class="switch"><input type="checkbox" name="' + esc(f.name) + '"' + (v ? ' checked' : '') + '><span>' + esc(f.checkLabel || '') + '</span></label>';
  } else if (f.type === 'money') {
    const shown = (v === '' || v === undefined || v === null || v === 0 && f.hideZero) ? '' : (typeof v === 'number' ? (v / 100).toFixed(2) : v);
    control = '<div class="money-input"><span class="prefix">¥</span><input type="text" inputmode="decimal" name="' + esc(f.name) + '" value="' + esc(shown) + '" placeholder="' + esc(f.placeholder || '0.00') + '"></div>';
  } else {
    const type = f.type === 'date' ? 'date' : (f.type === 'number' ? 'number' : 'text');
    control = '<input type="' + type + '" name="' + esc(f.name) + '" value="' + esc(v) + '" placeholder="' + esc(f.placeholder || '') + '"' +
      (f.min !== undefined ? ' min="' + f.min + '"' : '') + '>';
  }

  return label + control + hint + '</label>';
}

/* ============================================================ 确认框 */

function confirmBox(title, message, opts) {
  const o = opts || {};
  return new Promise(resolve => {
    openModal(title, '<p class="confirm-text">' + esc(message) + '</p>', {
      okText: o.okText || '确定',
      cancelText: o.cancelText || '取消',
      okClass: o.danger === false ? 'primary' : 'danger',
      noFocus: true
    });
    $('#modalOk').onclick = () => { closeModal(); resolve(true); };
    $('#modalCancel').onclick = () => { closeModal(); resolve(false); };
    $('#modalClose').onclick = () => { closeModal(); resolve(false); };
  });
}

/* 弹窗通用关闭按钮 */
$('#modalClose').addEventListener('click', () => closeModal());
$('#modalCancel').addEventListener('click', () => {
  // confirmBox 会自己覆盖 onclick 处理并关闭；这里兜底普通表单
  if ($('#modalCancel').onclick) return;
  closeModal();
});
