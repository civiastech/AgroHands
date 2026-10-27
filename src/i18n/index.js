import en from './en.js';
import pcm from './pcm.js';
import yo from './yo.js';
import ha from './ha.js';
import ig from './ig.js';
import fr from './fr.js';

export const LOCALES = { en, pcm, yo, ha, ig, fr };
export const LANG_CODES = Object.keys(LOCALES);

/** BCP 47 tag for the HTML lang attribute (Nigerian Pidgin has no browser-known code, so use en-NG). */
export const htmlLang = (code) => (code === 'pcm' ? 'en-NG' : code);

export function translator(lang) {
  const dict = LOCALES[lang] || en;
  return (key, vars) => {
    let s = dict[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

/**
 * Pick a language from the cookie, then the browser's Accept-Language (in preference order), then English.
 * "fr-BE,fr;q=0.9,en;q=0.8" → fr. Unknown languages are skipped.
 */
export function pickLang(cookieLang, acceptLanguage = '') {
  if (LOCALES[cookieLang]) return cookieLang;
  const prefs = String(acceptLanguage)
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.split('=')[1] ?? 1);
      return { primary: tag.split('-')[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((p) => p.primary && p.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { primary } of prefs) if (LOCALES[primary]) return primary;
  return 'en';
}
