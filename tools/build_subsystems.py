#!/usr/bin/env python3
"""
build_subsystems.py — Foundry GM Screen journal -> data/subsystems.generated.js

The GM Core subsystems chapter ships inside the open-source Foundry VTT pf2e
system as one journal, `packs/pf2e/journals/gm-screen.json`. Every subsystem is
a page of that journal, carrying its own Paizo page citation, so the rules text
in this app is generated rather than transcribed and cannot drift from the book.

Get it with a sparse, shallow clone (only the packs we need). The subsystem
pages are present on the v14-dev branch:

    git clone --depth 1 --filter=blob:none --sparse -b v14-dev \\
        https://github.com/foundryvtt/pf2e.git pf2e-data
    cd pf2e-data && git sparse-checkout set packs/pf2e/journals \\
        packs/pf2e/conditions packs/pf2e/actions && cd ..

    python3 tools/build_subsystems.py \\
        --src pf2e-data/packs/pf2e/journals/gm-screen.json \\
        --out data/subsystems.generated.js

Emits three consts:

    GENERATED_SUB_META         {generated, source, sourceBranch, sourceCommit,
                                pages, sources[]}
    GENERATED_SUBSYSTEMS       [{slug, name, html, section, book, pages}, ...]
    GENERATED_CHASE_OBSTACLES  [{table, name, level, options:[{skill,dc,how}]}, ...]
    GENERATED_VP_SCALES        [{duration, endPoint, thresholds:[int]}, ...]

The three @-markups Foundry uses inline are rewritten, not dropped:
  @Check[skill|dc:N]                    -> <span class="chk" data-skill data-dc>
  @UUID[Compendium...Item.Name]         -> <span class="actref" data-action=slug>
  @Embed[Compendium...Item.id inline]   -> removed; the engine inlines the
                                           action's own text from the reference
                                           data next to the actref marker.
"""
import argparse
import datetime
import html as htmllib
import json
import os
import re
import subprocess

# The subsystem pages, in the order GM Core presents them. The first five have
# runners in the app; the rest ship as reference text only.
PAGES = [
    "Victory Points", "Influence", "Research", "Chases", "Infiltration",
    "Reputation", "Duels", "Leadership", "Hexploration",
]

# Tags worth keeping. Everything else is unwrapped (content kept, tag dropped).
KEEP_TAGS = {
    "p", "strong", "em", "h1", "h2", "h3", "h4", "ul", "li", "hr",
    "table", "thead", "tbody", "tr", "th", "td", "caption", "span",
}
# `span` survives only to carry the markers rewrite_checks/rewrite_refs make;
# Foundry's own styled spans keep none of these attributes and are unwrapped.
KEEP_ATTRS = {"colspan", "rowspan", "class", "data-skill", "data-dc",
              "data-action"}

CITATION_RE = re.compile(
    r"<p>\s*<em>Section:\s*(?P<section>[^<]*?)\s*</em>\s*"
    r"<span[^>]*>\s*<em>\s*(?P<book>.*?)\s+pg\.\s*(?P<pages>[\d\-–,\s]+?)\s*</em>\s*</span>\s*</p>",
    re.S,
)


def src_commit(path):
    """Short HEAD of the clone `path` lives in, or None outside a checkout."""
    try:
        return subprocess.check_output(
            ["git", "-C", os.path.dirname(os.path.abspath(path)),
             "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return None


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def rewrite_checks(text):
    """@Check[acrobatics|dc:13|...] -> a readable, data-carrying span."""
    def one(m):
        parts = m.group(1).split("|")
        skill = parts[0].strip().lower()
        dc = None
        for p in parts[1:]:
            d = re.match(r"\s*dc:\s*(\d+)", p)
            if d:
                dc = int(d.group(1))
        label = skill.replace("-", " ").title()
        if dc is None:
            return f'<span class="chk" data-skill="{skill}">{label}</span>'
        return (f'<span class="chk" data-skill="{skill}" data-dc="{dc}">'
                f'{label} DC {dc}</span>')
    return re.sub(r"@Check\[([^\]]+)\]", one, text)


def rewrite_refs(text):
    """@UUID[...Item.Name] -> an action marker; @Embed[...] -> removed."""
    def one(m):
        target = m.group(1).rsplit(".Item.", 1)[-1] if ".Item." in m.group(1) \
            else m.group(1).lstrip(".")
        # Bare Foundry ids (no readable name) carry nothing a reader can use.
        if not re.search(r"[a-z]", target) or not re.search(r"[A-Z]", target) \
                or re.fullmatch(r"[A-Za-z0-9]{16}", target):
            return ""
        return f'<span class="actref" data-action="{slugify(target)}">{target}</span>'
    text = re.sub(r"@UUID\[([^\]]+)\]", one, text)
    text = re.sub(r"@Embed\[[^\]]+\]", "", text)
    return text


def _balance_spans(text):
    """Drop </span> closers left behind when an opening <span> was unwrapped."""
    out, depth, pos = [], 0, 0
    for m in re.finditer(r"<(/?)span[^>]*>", text):
        out.append(text[pos:m.start()])
        if m.group(1):
            if depth:
                depth -= 1
                out.append(m.group(0))
        else:
            depth += 1
            out.append(m.group(0))
        pos = m.end()
    out.append(text[pos:])
    return "".join(out)


def clean_html(text):
    """Whitelist tags and attributes; Foundry's inline styles go."""
    def tag(m):
        closing, name, attrs = m.group(1), m.group(2).lower(), m.group(3) or ""
        if name not in KEEP_TAGS:
            return ""
        if closing:
            return f"</{name}>"
        kept = " ".join(
            f'{a.lower()}="{v}"'
            for a, v in re.findall(r'([a-zA-Z-]+)\s*=\s*"([^"]*)"', attrs)
            if a.lower() in KEEP_ATTRS
        )
        if name == "span" and not kept:
            return ""
        return f"<{name}{' ' + kept if kept else ''}>"
    text = re.sub(r"<(/?)([a-zA-Z0-9]+)([^>]*)>", tag, text)
    # Unwrapping an opening <span> would strand its </span>; drop any closer
    # that no longer has an opener.
    text = _balance_spans(text)
    text = re.sub(r"<p>\s*</p>", "", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_level(s):
    m = re.search(r"\((\d+)(?:st|nd|rd|th)\)", s)
    return int(m.group(1)) if m else None


def parse_options(fragment):
    """Pull (skill, dc, how) triples out of one obstacle cell."""
    out = []
    for m in re.finditer(
            r'<span class="chk" data-skill="([^"]+)" data-dc="(\d+)">[^<]*</span>'
            r'(?P<tail>[^<;]*)', fragment):
        how = m.group("tail").strip(" ,;.")
        how = re.sub(r"^to\s+", "", how)
        out.append({"skill": m.group(1), "dc": int(m.group(2)),
                    "how": how or None})
    return out


def parse_chase_obstacles(page_html):
    """Each table row is a low-level obstacle and its high-level variant."""
    obstacles = []
    for table in re.findall(r"<table.*?</table>", page_html, re.S):
        rows = re.findall(r"<tr>(.*?)</tr>", table, re.S)
        if not rows:
            continue
        group = re.sub(r"<[^>]+>", "", rows[0]).replace("Obstacles", "").strip()
        for row in rows[1:]:
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            if len(cells) != 2:
                continue
            name_cell, detail = cells
            # The low-level obstacle: name from cell one, checks from the
            # first paragraph of cell two.
            paras = re.findall(r"<p>(.*?)</p>", detail, re.S) or [detail]
            base_name = re.sub(r"<[^>]+>", "", name_cell).strip()
            entry = {"table": group,
                     "name": re.sub(r"\s*\(\d+\w*\)\s*$", "", base_name).strip(),
                     "level": parse_level(base_name),
                     "options": parse_options(paras[0])}
            if entry["options"]:
                obstacles.append(entry)
            # The high-level variant: bolded name, then its own checks.
            for para in paras[1:]:
                v = re.match(r"\s*<strong>(.*?)</strong>(.*)", para, re.S)
                if not v:
                    continue
                vname = re.sub(r"<[^>]+>", "", v.group(1)).strip()
                ventry = {"table": group,
                          "name": re.sub(r"\s*\(\d+\w*\)\s*$", "", vname).strip(),
                          "level": parse_level(vname),
                          "options": parse_options(v.group(2))}
                if ventry["options"]:
                    obstacles.append(ventry)
    return obstacles


def parse_vp_scales(page_html):
    """The Victory Point Scales table: duration -> end point -> thresholds."""
    scales = []
    for table in re.findall(r"<table.*?</table>", page_html, re.S):
        if "VP End Point" not in re.sub(r"<[^>]+>", " ", table):
            continue
        for row in re.findall(r"<tr>(.*?)</tr>", table, re.S):
            cells = [re.sub(r"<[^>]+>", "", c).strip()
                     for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if len(cells) != 3:
                continue
            scales.append({
                "duration": cells[0],
                "endPoint": cells[1],
                "thresholds": [int(n) for n in re.findall(r"\d+", cells[2])],
            })
    return scales


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True,
                    help="path to Foundry packs/pf2e/journals/gm-screen.json")
    ap.add_argument("--out", required=True, help="path to write")
    ap.add_argument("--branch", default="v14-dev",
                    help="the branch --src was cloned from (recorded in the stamp)")
    args = ap.parse_args()

    with open(args.src, encoding="utf-8") as fh:
        journal = json.load(fh)
    by_name = {p["name"]: p for p in journal.get("pages", [])}

    missing = [n for n in PAGES if n not in by_name]
    if missing:
        raise SystemExit(
            "gm-screen.json is missing these subsystem pages: "
            + ", ".join(missing)
            + "\nIs the clone on the right branch? (see the docstring)")

    subsystems, obstacles, scales, books = [], [], [], {}
    for name in PAGES:
        raw = by_name[name]["text"]["content"]

        cite = CITATION_RE.search(raw)
        if not cite:
            raise SystemExit(f"no Paizo citation found on the {name!r} page — "
                             "refusing to ship rules text with no attribution")
        raw = CITATION_RE.sub("", raw)

        body = clean_html(rewrite_refs(rewrite_checks(raw)))
        book = htmllib.unescape(cite.group("book")).strip()
        books[book] = books.get(book, 0) + 1

        subsystems.append({
            "slug": slugify(name),
            "name": name,
            "section": htmllib.unescape(cite.group("section")).strip(),
            "book": book,
            "pages": cite.group("pages").strip(),
            "html": body,
        })
        if name == "Chases":
            obstacles = parse_chase_obstacles(body)
        if name == "Victory Points":
            scales = parse_vp_scales(body)

    if not obstacles:
        raise SystemExit("no chase obstacles parsed — the tables moved")
    if not scales:
        raise SystemExit("no VP scales parsed — the table moved")

    meta = {
        "generated": datetime.date.today().isoformat(),
        "source": "foundryvtt/pf2e",
        "sourceBranch": args.branch,
        "sourceCommit": src_commit(args.src),
        "pages": len(subsystems),
        "obstacles": len(obstacles),
        "sources": [{"title": t, "license": "ORC", "count": n}
                    for t, n in sorted(books.items(), key=lambda kv: -kv[1])],
    }

    def const(name, value):
        return f"const {name} = {json.dumps(value, ensure_ascii=False)};\n"

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(
            "/* data/subsystems.generated.js — AUTO-GENERATED. Do not hand-edit.\n"
            "   Rebuild with:  npm run build:sub\n"
            "   Source: foundryvtt/pf2e GM Screen journal (Paizo content, ORC). */\n")
        fh.write(const("GENERATED_SUB_META", meta))
        fh.write(const("GENERATED_SUBSYSTEMS", subsystems))
        fh.write(const("GENERATED_CHASE_OBSTACLES", obstacles))
        fh.write(const("GENERATED_VP_SCALES", scales))

    print(f"wrote {args.out}: {len(subsystems)} subsystems, "
          f"{len(obstacles)} chase obstacles, {len(scales)} VP scales "
          f"(source {meta['sourceCommit'] or 'unknown'}@{args.branch})")


if __name__ == "__main__":
    main()
