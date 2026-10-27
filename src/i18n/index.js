import en from './en.js';
import pcm from './pcm.js';
import yo from './yo.js';
import ha from './ha.js';
import ig from './ig.js';

export const LOCALES = { en, pcm, yo, ha, ig };
export const LANG_CODES = Object.keys(LOCALES);

export function translator(lang) {
  const dict = LOCALES[lang] || en;
  return (key, vars) => {
    let s = dict[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

/** Pick a language from cookie, then Accept-Language, then English. */
export function pickLang(cookieLang, acceptLanguage = '') {
  if (LOCALES[cookieLang]) return cookieLang;
  const a = acceptLanguage.toLowerCase();
  for (const code of ['yo', 'ha', 'ig', 'pcm']) if (a.includes(code)) return code;
  return 'en';
}
