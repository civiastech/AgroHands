#!/bin/sh
# Builds the Google Play app (Trusted Web Activity) inside Docker. Needs only Docker.
#
#   sh android/build.sh keystore      once: create your upload key (android/android.keystore). BACK IT UP.
#   sh android/build.sh fingerprint   print the key's SHA-256 → ANDROID_CERT_SHA256 in the server's .env
#   sh android/build.sh build         make android/app-release-bundle.aab (upload to Play) + a signed test APK
#
# Reads BASE_URL / ANDROID_PACKAGE / ANDROID_VERSION_CODE from .env (or the environment).
# The keystore password comes from ANDROID_KEYSTORE_PASSWORD (asked for if not set).
# shellcheck disable=SC2016  # single quotes are deliberate: variables expand inside the build container, not here
set -eu
cd "$(dirname "$0")/.."

export MSYS_NO_PATHCONV=1                         # Git Bash on Windows: don't rewrite /work paths
ROOT=$(pwd -W 2>/dev/null || pwd)
IMAGE=agrohands-android-builder
KEYSTORE=android/android.keystore

docker image inspect $IMAGE >/dev/null 2>&1 || docker build -t $IMAGE android

password() {
  if [ -z "${ANDROID_KEYSTORE_PASSWORD:-}" ]; then
    printf 'Keystore password: ' >&2
    stty -echo 2>/dev/null || true; read -r ANDROID_KEYSTORE_PASSWORD; stty echo 2>/dev/null || true; echo >&2
  fi
  [ ${#ANDROID_KEYSTORE_PASSWORD} -ge 6 ] || { echo "Password must be at least 6 characters." >&2; exit 1; }
}

run() { docker run --rm -e ANDROID_KEYSTORE_PASSWORD -v "$ROOT:/work" -w /work "$@"; }

case "${1:-}" in
  keystore)
    [ -f $KEYSTORE ] && { echo "$KEYSTORE already exists — refusing to overwrite your signing key."; exit 1; }
    password
    run $IMAGE sh -c 'keytool -genkeypair -keystore android/android.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass "$ANDROID_KEYSTORE_PASSWORD" -keypass "$ANDROID_KEYSTORE_PASSWORD" -dname "CN=AgroHands, O=AgroHands, C=NG"'
    echo "✔ Created $KEYSTORE. Back it up somewhere safe (with the password) — you need it for every future update."
    ;;

  fingerprint)
    password
    run $IMAGE sh -c 'keytool -list -v -keystore android/android.keystore -alias upload -storepass "$ANDROID_KEYSTORE_PASSWORD"' \
      | sed -n 's/.*SHA256: *//p'
    echo "↑ Put this in ANDROID_CERT_SHA256 on the server (comma-separate it with Play's app-signing key fingerprint)."
    ;;

  build)
    [ -f $KEYSTORE ] || { echo "No $KEYSTORE yet. Run: sh android/build.sh keystore"; exit 1; }
    password
    run --add-host=host.docker.internal:host-gateway -e ANDROID_ASSET_URL -e ANDROID_ALLOW_HTTP -e BASE_URL -e ANDROID_PACKAGE -e ANDROID_VERSION_CODE \
      $IMAGE sh -c '
        set -e
        node --env-file-if-exists=.env --disable-warning=ExperimentalWarning scripts/android-config.js
        cd android
        bubblewrap update --skipVersionUpgrade --manifest=./twa-manifest.json
        BUBBLEWRAP_KEYSTORE_PASSWORD="$ANDROID_KEYSTORE_PASSWORD" BUBBLEWRAP_KEY_PASSWORD="$ANDROID_KEYSTORE_PASSWORD" \
          bubblewrap build --skipPwaValidation --manifest=./twa-manifest.json
      '
    echo "✔ android/app-release-bundle.aab  → upload this in Play Console"
    echo "✔ android/app-release-signed.apk  → install on a phone to test (adb install, or copy and open)"
    ;;

  *)
    sed -n '2,10p' "$0"; exit 1 ;;
esac
