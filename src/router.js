// Minimal router: app.get('/jobs/:id', handler). Handlers receive (ctx) and may be async.

export class Router {
  constructor() {
    this.routes = [];
  }
  add(method, path, ...handlers) {
    const keys = [];
    const pattern = path
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, path, regex: new RegExp(`^${pattern}/?$`), keys, handlers });
  }
  get(path, ...h) { this.add('GET', path, ...h); }
  post(path, ...h) { this.add('POST', path, ...h); }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = r.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      try {
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      } catch {
        return null; // malformed %-escape: treat as not found, not a crash
      }
      return { handlers: r.handlers, params, route: r.path };
    }
    return null;
  }
}
