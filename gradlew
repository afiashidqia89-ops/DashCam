#!/usr/bin/env bash
# Gradle wrapper bootstrap.
# Download gradle-wrapper.jar on first run if it's missing, then run gradle.
# This makes the project work even without a pre-installed gradle on the machine.

set -e

APP_HOME=$(cd "$(dirname "$0")" && pwd)
WRAPPER_JAR="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
WRAPPER_PROPS="$APP_HOME/gradle/wrapper/gradle-wrapper.properties"
GRADLE_VERSION="8.7"
GRADLE_DIST_URL="https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip"

# If wrapper jar missing, download it from the official Gradle repo
if [ ! -f "$WRAPPER_JAR" ]; then
  echo "gradle-wrapper.jar missing, downloading from gradle/gradle GitHub…"
  mkdir -p "$APP_HOME/gradle/wrapper"
  curl -fsSL -o "$WRAPPER_JAR" \
    "https://raw.githubusercontent.com/gradle/gradle/v${GRADLE_VERSION}/gradle/wrapper/gradle-wrapper.jar"
fi

# If wrapper properties missing, write default ones
if [ ! -f "$WRAPPER_PROPS" ]; then
  cat > "$WRAPPER_PROPS" <<EOF
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=${GRADLE_DIST_URL}
networkTimeout=10000
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
EOF
fi

# Execute the actual Gradle wrapper jar
if command -v java >/dev/null 2>&1; then
  exec java -classpath "$WRAPPER_JAR" org.gradle.wrapper.GradleWrapperMain "$@"
else
  echo "Java is required to run Gradle. Please install Java 17+."
  exit 1
fi
