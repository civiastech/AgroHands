# Publishing AgroHands on Google Play

The Android app is a **Trusted Web Activity (TWA)**: a small, signed Android app (about 1.5 MB) that opens your live site full-screen. There's no URL bar, and it has its own icon, splash screen and location permission. Changes to the website reach app users instantly. You only upload a new app build when the Android shell itself changes.

Everything in the code is ready. The steps below need **you**: a live domain, a Google Play developer account and your own signing key.

## What's already done

| Requirement | Where |
| --- | --- |
| Installable PWA: manifest with id/scope, 192 + 512 PNG icons, maskable + monochrome icons, shortcuts, screenshots | `/manifest.webmanifest`, `public/icons/` |
| Offline fallback (Chrome's TWA offline check) | service worker precaches `/offline` |
| Digital Asset Links (removes the browser bar) | `/.well-known/assetlinks.json` (from `ANDROID_CERT_SHA256`) |
| Public privacy policy (location, device data, retention, children, contact) | `/privacy` |
| Public account-deletion page + in-app deletion | `/account-deletion`, `/me/delete` |
| Target SDK 36, min SDK 24 (Android 7.0+), location delegation for the GPS button | `scripts/android-config.js` |
| Signed `.aab` build with no Android Studio or Java needed (Docker only) | `npm run android:build` |
| Store graphics: 512 icon, 1024×500 feature graphic, 5 phone screenshots (1080×1920) | `android/store/` |
| Emoji limited to ones that render on Android 7+ | |
| Tests for all of the above | `test/ops.test.js` |

## Step by step

### 1. Put the site live first

Follow [DEPLOYMENT.md](DEPLOYMENT.md). In the server's `.env`, also set `SUPPORT_EMAIL`, a real inbox Google and users can reach. Check `https://your-domain/privacy` and `https://your-domain/account-deletion` load.

### 2. Create your upload key (once, on your computer)

```bash
cp .env.example .env            # on your computer too, if you haven't
#   set BASE_URL=https://your-domain (and ANDROID_PACKAGE if you want a different id)
npm run android:keystore        # asks for a password (6+ characters)
```

This creates `android/android.keystore`. **Back up the file and its password together**, for example in a password manager plus an offline copy. It is git-ignored on purpose. If you lose it, Play can reset the upload key, but that takes days.

### 3. Link the key to your site

```bash
npm run android:fingerprint     # prints AA:BB:…
```

On the server, set `ANDROID_CERT_SHA256=<that value>` in `.env` and run `./deploy/deploy.sh`. Check `https://your-domain/.well-known/assetlinks.json` shows it.

### 4. Build

```bash
npm run android:build
```

The first run downloads the Android toolchain into a Docker image (about 2 GB, once). The build produces:

- `android/app-release-bundle.aab`: upload this to Play.
- `android/app-release-signed.apk`: copy this to an Android phone and install it to test. If it opens with **no browser bar**, Asset Links work. If you see a URL bar, the fingerprint on the server doesn't match.

**Or build on GitHub** (no Docker needed on your computer): add the repository secrets `ANDROID_KEYSTORE_BASE64` (your keystore file, base64-encoded; the command is at the top of `.github/workflows/android.yml`) and `ANDROID_KEYSTORE_PASSWORD`, plus the variable `BASE_URL`. Then go to **Actions → Android → Run workflow** and download the **android-release** artifact. Without secrets, the same workflow builds a throwaway-key test app on every relevant change, so a broken Android build is caught early.

### 5. Play Console

1. Create a developer account at play.google.com/console ($25, one-time; identity verification takes a few days). An **organisation** account (needs a D-U-N-S number for your CAC-registered company) avoids the testing rule in step 7 and shows your company name.
2. **Create app**: name *AgroHands*, type *App*, *Free*.
3. **Testing → Closed testing → Create release** and upload the `.aab`. Accept **Play App Signing** (the default).
4. **Important:** open **Setup → App integrity → App signing**, copy the **App signing key SHA-256**, and add it to the server so it holds both keys:
   `ANDROID_CERT_SHA256=<upload key>,<Play app-signing key>`. Then run `./deploy/deploy.sh`. Without this, people who install from Play will see a browser bar.

### 6. Store listing and App content

Use the text and answers below. Graphics are in `android/store/`:

- App icon: `play-icon-512.png`
- Feature graphic: `feature-graphic-1024x500.png`
- Phone screenshots: `screenshots/01…05.png`

To refresh the screenshots after UI changes, run `npm run seed && npm start`, then `npm run play:assets`.

### 7. Testing, then production

- **Personal developer accounts** (created after Nov 2023) must run a closed test with **at least 12 testers opted in for 14 days in a row** before they can apply for production. Recruit farmers, workers and field agents from your pilot, and add their Gmail addresses to the tester list.
- Then **Production → Create release**, using the same `.aab` or a newer one. The first review usually takes 1–7 days.

### 8. Updates

- **Website changes** (almost everything): just deploy the server. App users get them immediately.
- **App shell changes** (icon, name, colours, shortcuts): bump `version` in `package.json` (the version code must go up for every upload), run `npm run android:build`, and upload the new `.aab`.

---

## Store listing (copy-paste)

**App name** (30 max): `AgroHands: Farm Jobs & Workers`

**Short description** (80 max): `Verified farm workers and fair farm jobs in Nigeria, with signed contracts.`

**Full description:**

```text
AgroHands connects Nigerian farm owners with verified, trained farm workers, and gives every worker a fair, written contract.

FOR FARM WORKERS
• Register free with your phone number. Workers never pay to get a job.
• Get verified with your NIN and build your level: Registered → Bronze → Silver → Gold.
• Free training: farm safety, your rights at work, safe use of agrochemicals and good farming practice. Earn certificates anyone can check.
• Get job offers that match your skills, your area and your wage.
• Accept offers and sign your contract on your phone with your PIN.
• Use it in English, Pidgin, Yorùbá, Hausa, Igbo or French.

FOR FARM OWNERS
• Post a job in minutes: harvesting, planting, weeding, spraying, poultry, tractor work and more.
• See a ranked shortlist of workers near your farm, with clear reasons for each match: skills, reliability, ratings and distance.
• Every worker is identity-checked. Higher levels add guarantors, address checks and practical assessments.
• Contracts meet the Labour Act and are signed by both sides on the phone, with a printable copy.
• Rate workers after each job, and get disputes mediated.

BUILT FOR REAL FARMS
• Works on low-cost Android phones and slow networks.
• Training pages work offline.
• No phone data? Workers can also use AgroHands by USSD.
• Field agents help people register and get verified in person.

Your data is protected under the Nigeria Data Protection Act. We never store your full NIN, and you can download or delete your data at any time.
```

**Category:** Business · **Tags:** Jobs, Agriculture, Business
**Contact email:** your `SUPPORT_EMAIL` · **Website:** your domain · **Privacy policy:** `https://your-domain/privacy`

---

## App content answers

| Section | Answer |
| --- | --- |
| Privacy policy | `https://your-domain/privacy` |
| App access | *All or some functionality is restricted.* On the live site, create one worker account and one farmer account for Google's reviewers (register normally, then use the agent desk to verify the worker). Enter both phone numbers and PINs here, with this note: "Log in at the start screen. Worker: see offers and training. Farmer: post a job and view the shortlist." |
| Ads | No ads |
| Content rating | Category: *Utility, Productivity, Communication, or Other*. No violence, sexual content, profanity, drugs, gambling. **Users can interact or exchange information: Yes** (contracts reveal phone numbers after signing). **Shares user's physical location with other users: No** (only an approximate distance is shown). **Allows purchase of digital goods: No.** |
| Target audience | **18 and over** only. Not designed for children. |
| News app | No |
| Government app | No |
| Financial features | None (payroll is not in this version) |
| Health | No |
| Data safety | See below |
| Account deletion URL | `https://your-domain/account-deletion` |

### Data safety

- Collects or shares data: **Yes, it collects. It does not share.** (Farms seeing a worker's profile after the worker accepts is user-initiated, and NIN checks by a verification provider and SMS delivery by Africa's Talking are processing on your behalf. Neither counts as "sharing" under Play's definitions.)
- Encrypted in transit: **Yes**
- Users can request deletion: **Yes** (`/account-deletion`)

| Data type | Collected | Required? | Purposes |
| --- | --- | --- | --- |
| Personal info → Name | Yes | Required | App functionality, Account management |
| Personal info → Phone number | Yes | Required | App functionality, Account management, Fraud prevention |
| Personal info → Address (state, town) | Yes | Required for workers and farms | App functionality |
| Personal info → Other info (date of birth, gender, NIN last 4 digits, guarantor) | Yes | Optional / required for verification | App functionality, Fraud prevention, security and compliance |
| Location → Approximate location | Yes | Optional | App functionality |
| Location → Precise location (only when "Use my current location" is pressed) | Yes | Optional | App functionality |
| Financial info → Other financial info (wage expectation, job pay) | Yes | Required | App functionality |

Payments: none are taken inside the app (paid courses show "not available in the Android app"), so answer **No** for "Purchase history" and "Payment info" unless you later add Google Play billing.
| App activity → Other user-generated content (ratings, dispute text) | Yes | Optional | App functionality |
| App activity → Other actions (training progress, quiz results) | Yes | Optional | App functionality |

Not collected: email, photos, contacts, messages, audio, files, calendar, health, web browsing, device IDs, advertising IDs, crash or analytics data.

Have a lawyer check these answers alongside `/privacy`, `/terms` and the retention periods stated on `/account-deletion` (6 years for contracts, 7 days to process requests made outside the app, 14-day backup roll-off). Those periods are reasonable defaults, not legal advice.
