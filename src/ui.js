// Small DOM helpers shared by the views.

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function slider({ label, min, max, step, value, unit = '', fmt = (v) => v, onInput }) {
  const node = h(`<div class="control"><label><span>${label}</span><b></b></label><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"/></div>`);
  const input = node.querySelector('input');
  const out = node.querySelector('b');
  const show = () => (out.textContent = `${fmt(+input.value)}${unit}`);
  input.addEventListener('input', () => { show(); onInput(+input.value); });
  show();
  node.set = (v) => { input.value = v; show(); };
  return node;
}

export function select({ label, options, value, onChange }) {
  const node = h(`<div class="control"><label><span>${label}</span></label><select aria-label="${label}"></select></div>`);
  const sel = node.querySelector('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === value) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  node.set = (v) => (sel.value = v);
  return node;
}

export function segmented({ options, value, onChange }) {
  const node = h('<div class="seg" role="group"></div>');
  const render = () => {
    node.innerHTML = '';
    for (const o of options) {
      const b = h(`<button type="button" class="${o.value === value ? 'on' : ''}">${o.label}</button>`);
      b.addEventListener('click', () => { value = o.value; render(); onChange(o.value); });
      node.append(b);
    }
  };
  render();
  node.set = (v) => { value = v; render(); };
  return node;
}

export function legend(items) {
  return h(`<div class="legend">${items.map((i) => `<span><i style="background:${i.color}"></i>${i.name}</span>`).join('')}</div>`);
}

export const pct = (p) => `${Math.round(p * 100)}%`;
