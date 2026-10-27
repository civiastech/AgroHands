// Tiny, safe HTML templating: every interpolated value is escaped unless wrapped in raw().

const RAW = Symbol('raw');

export function raw(str) {
  return { [RAW]: true, value: String(str ?? '') };
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'object' && value[RAW]) return value.value;
  return esc(value);
}

export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return raw(out);
}

export function toString(fragment) {
  return render(fragment);
}

export function naira(n) {
  const v = Math.round(Number(n) || 0);
  return '₦' + v.toLocaleString('en-NG');
}
