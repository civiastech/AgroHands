// Structured logger. JSON lines in production (ready for Loki, CloudWatch, Datadog…), readable lines in dev.
import { config } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLOURS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };

let threshold = LEVELS[config.logLevel] ?? LEVELS.info;
let format = config.logFormat;
let sink = (line, level) => (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');

function serialise(value) {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack, ...(value.status && { status: value.status }) };
  return value;
}

function write(level, msg, fields = {}) {
  if (LEVELS[level] < threshold) return;
  const data = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) data[k] = serialise(v);
  if (format === 'json') {
    sink(JSON.stringify({ time: new Date().toISOString(), level, msg, ...data }), level);
  } else {
    const extra = Object.keys(data).length ? ' ' + Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ') : '';
    const tty = process.stdout.isTTY;
    sink(`${tty ? COLOURS[level] : ''}${level.toUpperCase().padEnd(5)}${tty ? '\x1b[0m' : ''} ${msg}${extra}`, level);
  }
}

function make(bound = {}) {
  return {
    debug: (msg, f) => write('debug', msg, { ...bound, ...f }),
    info: (msg, f) => write('info', msg, { ...bound, ...f }),
    warn: (msg, f) => write('warn', msg, { ...bound, ...f }),
    error: (msg, f) => write('error', msg, { ...bound, ...f }),
    child: (f) => make({ ...bound, ...f }),
  };
}

export const log = make();

/** For tests: silence or capture output. */
export function configureLogger({ level, format: fmt, sink: s } = {}) {
  if (level) threshold = LEVELS[level];
  if (fmt) format = fmt;
  if (s) sink = s;
}
