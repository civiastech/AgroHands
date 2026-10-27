# Android build toolchain for the Google Play app (Trusted Web Activity). Build-time only; never deployed.
#   Used by android/build.sh — you don't need Android Studio or Java on your machine.
FROM eclipse-temurin:17-jdk-jammy

RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# SDK versions match what Bubblewrap 1.x generates (compile/target SDK 36, build-tools 36.1.0).
ENV ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk
RUN mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o /tmp/tools.zip \
 && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/tools.zip \
 && yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses > /dev/null \
 && $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.1.0" > /dev/null \
 && ln -s $ANDROID_HOME/cmdline-tools/latest $ANDROID_HOME/tools

RUN npm install -g @bubblewrap/cli@1 \
 && mkdir -p /root/.bubblewrap \
 && printf '{"jdkPath":"%s","androidSdkPath":"%s"}\n' "$JAVA_HOME" "$ANDROID_HOME" > /root/.bubblewrap/config.json

WORKDIR /work
