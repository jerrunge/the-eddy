#!/usr/bin/env python3
"""The groups op checked line by line against a 5x7 deck (morning-api v15, RULINGS 2026-10-06).

Reads the groups answer the local harness wrote and the deck's source HTML, walks the deck's posting
cards (the first three sections: The Way of Dad, Fortify, Maddy) beside the engine's groups, and
prints one line per position: ok when the engine's step at that position is the deck's line in the
deck's state (done or open), DIFF otherwise, then every difference in plain words. Read only.

Usage:
  set -a; source ~/.env.local; set +a
  node scripts/run-edge-local.mjs morning-api '{"op":"groups","date":"2026-10-06"}' > /tmp/groups.json
  python3 scripts/groups-deck-check.py /tmp/groups.json \
      ~/GitHub/jr-os-docs/docs/days/2026-10-06/source/Today-and-Tomorrow-2026-10-06-5x7.html
"""
import html
import json
import re
import sys

# a deck line, as printed, and the words the engine step's `what` must carry (lower case) to be that line
KEY = {
    "Half Dome and the boots on X": ["half dome", "on x"],
    "The same on Bluesky": ["on bluesky"],
    "The same on the Instagram feed, frame 56": ["instagram feed"],
    "The reel: Nothing about you is broken": ["nothing about you is broken"],
    "The map on LinkedIn": ["map", "linkedin"],
    "The map on Instagram": ["map", "instagram"],
    "Part 1, the body: LinkedIn carousel": ["the body", "linkedin carousel"],
    "Part 1: Instagram carousel": ["the body", "instagram carousel"],
    "Part 2, the inner weather: LinkedIn carousel": ["inner weather", "linkedin carousel"],
    "Part 2: Instagram carousel": ["inner weather", "instagram carousel"],
    "Desire cards: LinkedIn carousel": ["desire", "linkedin"],
    "Desire cards: Instagram carousel": ["desire", "instagram"],
    "Part 1 reel on Instagram": ["the body", "instagram reel"],
    "Part 1 as a YouTube Short": ["the body", "youtube"],
    "Part 2 reel on Instagram": ["inner weather", "instagram reel"],
    "Part 2 as a YouTube Short": ["inner weather", "youtube"],
    "1.1 carousel on Instagram @mymaddyapp": ["carousel", "instagram"],
    "1.1 carousel on the Facebook Page": ["carousel", "facebook"],
    "1.1 carousel on TikTok, photo mode": ["carousel", "tiktok"],
    "1.1 carousel on Threads": ["carousel", "threads"],
    "r/AuDHD: the 1.1 update": ["update from maddy"],
}


def deck_cards(path, n=3):
    text = open(path, encoding="utf-8").read()
    out = []
    for card in re.findall(r'<section class="card">(.*?)</section>', text, re.S)[:n]:
        title = html.unescape(re.search(r"<h1>(.*?)</h1>", card).group(1))
        lines = []
        for li in re.findall(r"<li[^>]*>.*?</li>", card, re.S):
            t = html.unescape(re.search(r'<div class="t">(.*?)</div>', li).group(1))
            done = 'class="done"' in li
            if t.startswith("Three texts"):   # one deck line, three steps on the engine
                for who in ("Ro", "Michele", "Emma"):
                    lines.append(("Text to " + who, done))
            else:
                lines.append((t, done))
        out.append((title, lines))
    return out


def main(groups_path, deck_path):
    d = json.load(open(groups_path, encoding="utf-8"))
    if "error" in d:
        print("the engine answered an error:", d["error"])
        return 2
    cards = deck_cards(deck_path)
    agree = total = 0
    notes = []
    for (title, lines), g in zip(cards, d["groups"]):
        print(f"\n== DECK: {title}  vs  ENGINE: {g['name']} ({g['count']['done']} of {g['count']['total']} done)")
        steps = g["steps"]
        for i in range(max(len(lines), len(steps))):
            dl = lines[i] if i < len(lines) else ("(no deck line)", False)
            st = steps[i] if i < len(steps) else None
            want_state = "done" if dl[1] else "open"
            keys = KEY.get(dl[0]) or [dl[0].lower()]
            ok = st is not None and all(k in st["what"].lower() for k in keys) and st["status"] == want_state
            total += 1
            agree += ok
            s_what = st["what"] if st else "(no engine step)"
            s_state = st["status"] if st else ""
            s_n = st["n"] if st else "-"
            print(f"  {'  ok ' if ok else 'DIFF '} deck {i + 1:>2}: {dl[0][:44]:<44} [{want_state}]   engine {s_n}: {s_what[:50]:<50} [{s_state}]")
            if not ok:
                notes.append(f"{g['name']} line {i + 1}: the deck says {dl[0]!r} ({want_state}); the engine's step {s_n} is {s_what!r} ({s_state})")
    print(f"\n{agree} of {total} lines agree; {total - agree} differ")
    for n in notes:
        print(" -", n)
    return 0 if agree == total else 1


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
