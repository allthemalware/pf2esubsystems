#!/usr/bin/env python3
"""
build.py — assemble the single, self-contained dist/index.html.

Inlines styles + the Foundry-derived subsystem rules + the Foundry-derived
condition/action reference + the app's own config + the engine into the
template, so the result is one file you can open offline (file://), text to a
co-GM, or host. Run from the project root:

    python3 tools/build.py
"""
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def main():
    html = read("src/template.html")
    parts = {
        "/*__INJECT_STYLES__*/": read("src/styles.css"),
        "/*__INJECT_DATA__*/": read("data/subsystems.generated.js"),
        "/*__INJECT_REFERENCE__*/": read("data/reference.generated.js"),
        "/*__INJECT_CONTENT__*/": read("src/content.js"),
        "/*__INJECT_ENGINE__*/": read("src/engine.js"),
    }
    for marker, content in parts.items():
        if marker not in html:
            raise SystemExit(f"marker not found in template: {marker}")
        # str.replace (not regex) so JS/CSS content is inserted verbatim
        html = html.replace(marker, content)

    out_dir = os.path.join(ROOT, "dist")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "index.html")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(html)

    # Static PWA files (for the hosted version). Harmlessly absent when
    # index.html is opened as a downloaded standalone file.
    cache_ver = time.strftime("%Y%m%d%H%M%S")
    for name in ("icon.svg", "manifest.webmanifest", "sw.js"):
        src = os.path.join(ROOT, "src", name)
        if not os.path.exists(src):
            continue
        content = read("src/" + name)
        if name == "sw.js":
            content = content.replace("__CACHE_VERSION__", cache_ver)
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as fh:
            fh.write(content)

    kb = os.path.getsize(out_path) / 1024
    print(f"built {out_path} ({kb:.0f} KB) + PWA files (cache {cache_ver})")


if __name__ == "__main__":
    main()
