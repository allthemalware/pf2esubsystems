#!/usr/bin/env python3
"""Run the pinned Gradle wrapper; fetch and verify the official JAR if absent."""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
JAR = ROOT / "android/gradle/wrapper/gradle-wrapper.jar"
URL = "https://raw.githubusercontent.com/gradle/gradle/v8.13.0/gradle/wrapper/gradle-wrapper.jar"
# https://gradle.org/release-checksums/ — Gradle 8.13 wrapper JAR.
SHA256 = "81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f"


def main():
    java = str(Path(os.environ["JAVA_HOME"]) / "bin/java") if os.environ.get("JAVA_HOME") else shutil.which("java")
    if not java:
        raise SystemExit("Install JDK 17 or 21, then set JAVA_HOME to its installation directory.")
    try:
        info = subprocess.run([java, "-version"], capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"Cannot run Java: {exc}")
    version = re.search(r'version "(\d+)', info.stderr + info.stdout)
    if not version or not 17 <= int(version[1]) <= 23:
        raise SystemExit("This build needs JDK 17–23 (21 recommended). Set JAVA_HOME to that JDK; Gradle 8.13 cannot run on this Java version.")
    if not JAR.exists():
        print("Downloading the official Gradle 8.13 wrapper JAR…", flush=True)
        try:
            with urllib.request.urlopen(URL, timeout=30) as response:
                data = response.read()
        except (OSError, urllib.error.URLError) as exc:
            raise SystemExit(f"Cannot download the Gradle wrapper: {exc}. Run this command with internet access.")
        if hashlib.sha256(data).hexdigest() != SHA256:
            raise SystemExit("Gradle wrapper checksum mismatch; nothing was installed.")
        JAR.parent.mkdir(parents=True, exist_ok=True)
        temp = JAR.with_suffix(".tmp")
        temp.write_bytes(data)
        temp.replace(JAR)
    if hashlib.sha256(JAR.read_bytes()).hexdigest() != SHA256:
        raise SystemExit(f"Unexpected Gradle wrapper checksum. Remove {JAR} and retry.")
    result = subprocess.run([java, "-classpath", str(JAR), "org.gradle.wrapper.GradleWrapperMain", *sys.argv[1:]], cwd=ROOT / "android")
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
