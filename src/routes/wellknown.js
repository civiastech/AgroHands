// /.well-known/* — Android app links (Google Play TWA) and security contact.
import { config } from '../config.js';

export function assetLinks(c = config) {
  if (!c.android.certFingerprints.length) return [];
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: c.android.packageName, sha256_cert_fingerprints: c.android.certFingerprints },
  }];
}

export default function register(r) {
  // Chrome on Android fetches this to confirm the Play Store app is allowed to open this site full-screen.
  r.get('/.well-known/assetlinks.json', (ctx) => {
    ctx.res.headers['Cache-Control'] = 'public, max-age=3600';
    ctx.res.headers['Access-Control-Allow-Origin'] = '*';
    ctx.res.json(assetLinks());
  });

  r.get('/.well-known/security.txt', (ctx) => {
    if (!config.supportEmail) return ctx.res.text('Not configured', 404);
    const expires = new Date(Date.now() + 365 * 86400 * 1000).toISOString();
    ctx.res.text(`Contact: mailto:${config.supportEmail}\nExpires: ${expires}\nPreferred-Languages: en\nCanonical: ${config.baseUrl}/.well-known/security.txt\n`);
  });
}
