// Minimal Prometheus metrics: request counts and latency histogram, plus process and business gauges.
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

const requests = new Map(); // "method|route|status" -> count
const latency = new Map(); // route -> { buckets: number[], sum, count }
const counters = new Map(); // name -> count
const started = Date.now();

export function observeRequest(method, route, status, seconds) {
  const k = `${method}|${route}|${status}`;
  requests.set(k, (requests.get(k) || 0) + 1);
  let h = latency.get(route);
  if (!h) latency.set(route, (h = { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }));
  BUCKETS.forEach((b, i) => { if (seconds <= b) h.buckets[i]++; });
  h.sum += seconds;
  h.count++;
}

export function inc(name) {
  counters.set(name, (counters.get(name) || 0) + 1);
}

const label = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** @param {Record<string, number>} gauges extra gauges, e.g. business KPIs read from the database */
export function renderMetrics(gauges = {}) {
  const out = [];
  out.push('# HELP http_requests_total HTTP requests by method, route and status.', '# TYPE http_requests_total counter');
  for (const [k, v] of requests) {
    const [method, route, status] = k.split('|');
    out.push(`http_requests_total{method="${label(method)}",route="${label(route)}",status="${status}"} ${v}`);
  }
  out.push('# HELP http_request_duration_seconds Request latency.', '# TYPE http_request_duration_seconds histogram');
  for (const [route, h] of latency) {
    const r = label(route);
    BUCKETS.forEach((b, i) => out.push(`http_request_duration_seconds_bucket{route="${r}",le="${b}"} ${h.buckets[i]}`));
    out.push(`http_request_duration_seconds_bucket{route="${r}",le="+Inf"} ${h.count}`);
    out.push(`http_request_duration_seconds_sum{route="${r}"} ${h.sum.toFixed(6)}`);
    out.push(`http_request_duration_seconds_count{route="${r}"} ${h.count}`);
  }
  out.push('# TYPE app_events_total counter');
  for (const [name, v] of counters) out.push(`app_events_total{event="${label(name)}"} ${v}`);
  const mem = process.memoryUsage();
  out.push(
    '# TYPE process_uptime_seconds gauge', `process_uptime_seconds ${((Date.now() - started) / 1000).toFixed(0)}`,
    '# TYPE process_resident_memory_bytes gauge', `process_resident_memory_bytes ${mem.rss}`,
    '# TYPE nodejs_heap_used_bytes gauge', `nodejs_heap_used_bytes ${mem.heapUsed}`,
  );
  for (const [name, v] of Object.entries(gauges)) out.push(`# TYPE ${name} gauge`, `${name} ${v}`);
  return out.join('\n') + '\n';
}
