// Writes android/twa-manifest.json (Bubblewrap's config for the Google Play app) from .env / environment.
//   npm run android:config
// Inputs: BASE_URL (your live https domain), ANDROID_PACKAGE, ANDROID_VERSION_CODE (optional),
//         ANDROID_ASSET_URL (optional: where Bubblewrap downloads icons from; defaults to BASE_URL).
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { config } from '../src/config.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const site = new URL(config.baseUrl);
const assets = (process.env.ANDROID_ASSET_URL || config.baseUrl).replace(/\/$/, '');

// Play needs a strictly increasing integer per upload. Default: 1.2.3 → 10203.
const [maj, min, patch] = pkg.version.split('.').map(Number);
const versionCode = Number(process.env.ANDROID_VERSION_CODE || maj * 10000 + min * 100 + patch);

if (site.protocol !== 'https:' && !process.env.ANDROID_ALLOW_HTTP) {
  console.error(`BASE_URL must be your live https:// address (got ${config.baseUrl}). Set it in .env first.`);
  process.exit(1);
}

const twa = {
  packageId: config.android.packageName,
  host: site.host,
  name: 'AgroHands',
  launcherName: 'AgroHands',
  display: 'standalone',
  orientation: 'portrait',
  themeColor: '#1F6F43',
  themeColorDark: '#1F6F43',
  navigationColor: '#1F6F43',
  navigationColorDark: '#1F6F43',
  navigationDividerColor: '#1F6F43',
  navigationDividerColorDark: '#1F6F43',
  backgroundColor: '#F7F9F7',
  enableNotifications: false,
  startUrl: '/',
  iconUrl: `${assets}/icons/icon-512.png`,
  maskableIconUrl: `${assets}/icons/maskable-512.png`,
  monochromeIconUrl: `${assets}/icons/monochrome-512.png`,
  splashScreenFadeOutDuration: 300,
  signingKey: { path: './android.keystore', alias: 'upload' },
  appVersion: pkg.version,
  appVersionCode: versionCode,
  shortcuts: [
    { name: 'Find farm work', shortName: 'Find work', url: '/w', chosenIconUrl: `${assets}/icons/icon-192.png` },
    { name: 'Post a job', shortName: 'Post job', url: '/f/jobs/new', chosenIconUrl: `${assets}/icons/icon-192.png` },
    { name: 'Training academy', shortName: 'Academy', url: '/academy', chosenIconUrl: `${assets}/icons/icon-192.png` },
  ],
  generatorApp: 'bubblewrap-cli',
  webManifestUrl: `${assets}/manifest.webmanifest`,
  fallbackType: 'customtabs',
  // The "Use my current location" button needs Android's location permission passed through to the site.
  features: { locationDelegation: { enabled: true } },
  alphaDependencies: { enabled: false },
  enableSiteSettingsShortcut: true,
  isChromeOSOnly: false,
  isMetaQuest: false,
  fullScopeUrl: `${config.baseUrl}/`,
  minSdkVersion: 24, // Android 7.0+, the minimum the TWA library (androidbrowserhelper) supports
  fingerprints: [],
  additionalTrustedOrigins: [],
  retainedBundles: [],
};

mkdirSync(new URL('../android/', import.meta.url), { recursive: true });
writeFileSync(new URL('../android/twa-manifest.json', import.meta.url), JSON.stringify(twa, null, 2) + '\n');
console.log(`android/twa-manifest.json → ${twa.packageId} v${twa.appVersion} (code ${versionCode}) for ${twa.host}`);
