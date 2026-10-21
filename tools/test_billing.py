#!/usr/bin/env python3
"""Exercise tip purchase transitions with a plain JDK, without Android or network dependencies."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "android/app/src/main/java/io/github/thewhytewolf/pf2esubsystems/TipPurchases.java"
TEST = ROOT / "tools/tests/TipPurchasesTest.java"


def jdk_tool(name):
    path = str(Path(os.environ["JAVA_HOME"]) / "bin" / name) if os.environ.get("JAVA_HOME") else shutil.which(name)
    if not path:
        raise SystemExit("Install a JDK (21 recommended) to run billing state checks.")
    return path


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="pf2e-billing-tests-") as output:
        subprocess.run([jdk_tool("javac"), "--release", "17", "-d", output, str(SOURCE), str(TEST)], check=True)
        subprocess.run([jdk_tool("java"), "-cp", output,
                        "io.github.thewhytewolf.pf2esubsystems.TipPurchasesTest"], check=True)
