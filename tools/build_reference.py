#!/usr/bin/env python3
"""
build_reference.py — convert the Foundry VTT `pf2e` system condition & action
JSON into the compact reference data bundled by the party tracker.

Source data: https://github.com/foundryvtt/pf2e  (game content under OGL/ORC).
Get it with a sparse, shallow clone (only the two packs we need):

    git clone --depth 1 --filter=blob:none --sparse \\
        https://github.com/foundryvtt/pf2e.git pf2e-data
    cd pf2e-data && git sparse-checkout set packs/pf2e/conditions packs/pf2e/actions

Then:

    python3 tools/build_reference.py --src /path/to/pf2e-data/packs/pf2e \\
        --out data/reference.generated.js

Output declares:
    const GENERATED_REF_META  = {generated, source, sourceCommit, conditions, actions, sources[]}
    const GENERATED_CONDITIONS = [{slug, name, description, valued, group}, ...]
    const GENERATED_ACTIONS    = [{slug, name, category, traits, exploration, actionType, actions, description}, ...]
Descriptions are cleaned plain text; newlines are meaningful (rendered as <br>).
"""
import argparse
import datetime
import glob
import html
import json
import os
import re
import subprocess


def src_commit(path):
    """Best-effort short git commit of the Foundry data clone, for the stamp."""
    try:
        out = subprocess.check_output(
            ["git", "-C", path, "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL)
        return out.decode().strip()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Inline Foundry markup -> readable text  (mirrors tools/build_spells.py)
# ---------------------------------------------------------------------------
GLYPH = {"1": "◆", "2": "◆◆", "3": "◆◆◆", "r": "⤳ reaction", "f": "◇ free"}


def _glyph(content):
    c = content.strip().lower()
    return GLYPH.get(c, content)


def _template(inner):
    parts = inner.split("|")
    ttype = parts[0]
    dist = width = None
    for p in parts[1:]:
        if p.startswith("distance:"):
            dist = p.split(":", 1)[1]
        elif p.startswith("width:"):
            width = p.split(":", 1)[1]
    if dist and ttype == "line" and width:
        return f"{dist}-foot line ({width} ft wide)"
    if dist:
        return f"{dist}-foot {ttype}"
    return ttype


def _damage(inner):
    inner = inner.split(",")[0]
    mtype = re.search(r"\[([^\]]+)\]", inner)
    dtype = mtype.group(1).split(",")[0].strip() if mtype else ""
    formula = inner[:mtype.start()] if mtype else inner
    formula = formula.split("|")[0]
    return f"{formula.strip()} {dtype}".strip()


def _check(inner):
    stat = inner.split("|")[0].split(":")[-1]
    return f"{stat.capitalize()} check"


def _uuid_label(inner):
    seg = inner.split(".")[-1]
    seg = re.sub(r"^(spell|feat|item|action|condition)s?[-_]?", "", seg, flags=re.I)
    return seg.replace("-", " ").replace("_", " ").strip()


def clean_html(raw):
    if not raw:
        return ""
    s = raw
    s = re.sub(r'<span class="action-glyph">(.*?)</span>',
               lambda m: _glyph(m.group(1)), s, flags=re.S)
    s = re.sub(r"@Template\[([^\]]+)\]", lambda m: _template(m.group(1)), s)
    dmg = r"@Damage\[((?:[^\[\]]|\[[^\]]*\])*)\](?:\{([^}]+)\})?"
    s = re.sub(dmg, lambda m: m.group(2) or _damage(m.group(1)), s)
    s = re.sub(r"@Check\[([^\]]*)\]\{([^}]+)\}", r"\2", s)
    s = re.sub(r"@Check\[([^\]]*)\]", lambda m: _check(m.group(1)), s)
    s = re.sub(r"@UUID\[[^\]]+\]\{([^}]+)\}", r"\1", s)
    s = re.sub(r"@UUID\[([^\]]+)\]", lambda m: _uuid_label(m.group(1)), s)
    s = re.sub(r"@[A-Za-z]+\[[^\]]*\]\{([^}]+)\}", r"\1", s)
    s = re.sub(r"@[A-Za-z]+\[[^\]]*\]", "", s)
    s = re.sub(r"<hr\s*/?>", "\n", s)
    s = re.sub(r"<li[^>]*>", "\n• ", s)
    s = re.sub(r"</li>", "", s)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<p[^>]*>", "\n\n", s)
    s = re.sub(r"</(p|ul|ol|div|table|tr)>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    # drop any remaining Foundry variable interpolation
    s = re.sub(r"@[a-z]+\.[\w.]+(?:\*\d+)?", "", s, flags=re.I)
    s = html.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


# ---------------------------------------------------------------------------
def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def transform_condition(doc):
    sysd = doc.get("system", {})
    value = sysd.get("value") or {}
    pub = sysd.get("publication") or sysd.get("source") or {}
    return {
        "slug": doc.get("system", {}).get("slug") or slug_from(doc),
        "name": doc.get("name", ""),
        "description": clean_html((sysd.get("description") or {}).get("value", "")),
        "valued": bool(value.get("isValued")),
        "group": sysd.get("group") or None,
        "_license": pub.get("license") or "",
        "_source": pub.get("title") or "",
    }


def transform_action(doc):
    sysd = doc.get("system", {})
    traits = (sysd.get("traits") or {}).get("value", []) or []
    pub = sysd.get("publication") or sysd.get("source") or {}
    return {
        "slug": sysd.get("slug") or slug_from(doc),
        "name": doc.get("name", ""),
        "category": sysd.get("category") or "",
        "traits": traits,
        "exploration": "exploration" in traits,
        "actionType": (sysd.get("actionType") or {}).get("value", ""),
        "actions": (sysd.get("actions") or {}).get("value"),
        "description": clean_html((sysd.get("description") or {}).get("value", "")),
        "_license": pub.get("license") or "",
        "_source": pub.get("title") or "",
    }


def slug_from(doc):
    name = doc.get("name", "item")
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def collect(pattern):
    out = []
    for path in sorted(glob.glob(pattern, recursive=True)):
        try:
            doc = load_json(path)
        except Exception:
            continue
        yield_doc = doc if isinstance(doc, dict) else None
        if yield_doc:
            out.append(yield_doc)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="path to <clone>/packs/pf2e")
    ap.add_argument("--out", required=True, help="output .js path")
    args = ap.parse_args()

    cond_docs = collect(os.path.join(args.src, "conditions", "**", "*.json"))
    # Only the GM-facing general actions (not every class/ancestry/archetype feat)
    # — this keeps the reference relevant to play and the bundle small.
    # Seek/Sense Motive are in basic/; Track/Cover Tracks/Recall Knowledge/Treat
    # Wounds in skill/ & downtime/. subsystems/ is what the GM Core subsystem
    # pages point at: Influence and Discover carry the whole substance of the
    # Influence page, and the six infiltration preparation activities are only
    # named there, so without this folder those pages render as bare headings.
    act_docs = []
    for sub in ("exploration", "skill", "basic", "downtime", "subsystems"):
        act_docs.extend(collect(os.path.join(args.src, "actions", sub, "**", "*.json")))

    conditions, actions = [], []
    src_counts = {}

    for doc in cond_docs:
        if doc.get("type") != "condition":
            continue
        c = transform_condition(doc)
        _tally(src_counts, c)
        conditions.append(_strip_private(c))

    for doc in act_docs:
        if doc.get("type") != "action":
            continue
        a = transform_action(doc)
        _tally(src_counts, a)
        actions.append(_strip_private(a))

    conditions.sort(key=lambda x: x["name"])
    actions.sort(key=lambda x: x["name"])

    commit = src_commit(args.src)
    meta = {
        "generated": datetime.date.today().isoformat(),
        "source": "foundryvtt/pf2e",
        "sourceCommit": commit,
        "conditions": len(conditions),
        "actions": len(actions),
        "sources": [{"title": t, "license": lic, "count": n}
                    for (t, lic), n in sorted(src_counts.items(), key=lambda kv: -kv[1])],
    }

    header = ("/* data/reference.generated.js — AUTO-GENERATED. Do not hand-edit.\n"
              "   Rebuild with:  npm run build:ref\n"
              "   Source: foundryvtt/pf2e condition + action data (Paizo content, OGL/ORC). */\n")
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(header)
        fh.write("const GENERATED_REF_META = " + json.dumps(meta, ensure_ascii=False) + ";\n")
        fh.write("const GENERATED_CONDITIONS = " + json.dumps(conditions, ensure_ascii=False) + ";\n")
        fh.write("const GENERATED_ACTIONS = " + json.dumps(actions, ensure_ascii=False) + ";\n")

    print(f"wrote {args.out}: {len(conditions)} conditions, {len(actions)} actions"
          + (f" (commit {commit})" if commit else ""))


def _tally(counts, item):
    key = (item.get("_source") or "Unknown", item.get("_license") or "")
    counts[key] = counts.get(key, 0) + 1


def _strip_private(item):
    return {k: v for k, v in item.items() if not k.startswith("_")}


if __name__ == "__main__":
    main()
