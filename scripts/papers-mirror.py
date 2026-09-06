#!/usr/bin/env python3
"""papers-mirror: a second copy of every filed document, in his iCloud Drive.

Runs on his Mac (cron, daily). Reads the papers table and the private bucket
with the local service-role key, and writes each document into
  ~/Library/Mobile Documents/com~apple~CloudDocs/Papers/<Category>/
with a readable filename and a sidecar .txt holding the gist and the extracted
text, so every doc is also findable in the Files app and Spotlight. Idempotent:
adds and refreshes, never deletes (a backup keeps what the app removes).
No secrets on the command line; nothing printed but a summary.
"""
import json, os, re, sys, urllib.request, urllib.parse
from pathlib import Path

PROJECT = "dsjnvwhyevjzsmuawkcs"
ENV = Path.home() / ".env.local"
ROOT = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/Papers"
LABEL = {"house": "House", "money": "Money and Tax", "legal": "Legal", "maddy": "Maddy",
         "health": "Health", "work": "Work", "cooper": "Cooper", "personal": "Personal"}

def load_env():
    env = {}
    if not ENV.exists():
        sys.exit("papers-mirror: ~/.env.local not found")
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    url, key = env.get("SUPABASE_URL", ""), env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if PROJECT not in url or not key:
        sys.exit("papers-mirror: refusing to run: SUPABASE_URL is not the estate project or key missing")
    return url.rstrip("/"), key

def get(url, key, path, raw=False):
    req = urllib.request.Request(url + path, headers={"apikey": key, "Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    return data if raw else json.loads(data.decode("utf-8"))

def slug(s, n=60):
    s = re.sub(r"[^\w\s-]", "", s or "", flags=re.U).strip()
    s = re.sub(r"\s+", " ", s)
    return s[:n].strip() or "document"

def main():
    url, key = load_env()
    if not ROOT.parent.exists():
        sys.exit("papers-mirror: iCloud Drive folder not found on this Mac")
    ROOT.mkdir(parents=True, exist_ok=True)
    rows = get(url, key, "/rest/v1/papers?select=id,category,title,doc_date,storage_path,mime,summary,ocr_text,created_at&archived=eq.false&order=doc_date.desc.nullslast")
    added = refreshed = kept = 0
    index = []
    for r in rows:
        cat = LABEL.get(r.get("category") or "personal", "Personal")
        d = (r.get("doc_date") or (r.get("created_at") or "")[:10] or "undated")
        title = r.get("title") or r.get("summary") or "document"
        ext = (r.get("storage_path") or "").rsplit(".", 1)[-1].lower() or "jpg"
        base = f"{d} {slug(title)} [{r['id'][:8]}]"
        folder = ROOT / cat
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / f"{base}.{ext}"
        side = folder / f"{base}.txt"
        if not target.exists():
            data = get(url, key, "/storage/v1/object/authenticated/papers/" + urllib.parse.quote(r["storage_path"]), raw=True)
            target.write_bytes(data)
            added += 1
        else:
            kept += 1
        text = (r.get("summary") or "").strip()
        if r.get("ocr_text"):
            text = (text + "\n\n" if text else "") + r["ocr_text"]
        if text:
            if not side.exists() or side.read_text(errors="ignore") != text:
                side.write_text(text)
                refreshed += 1
        index.append(f"- {d} · {cat} · {title} · `{target.name}`")
    (ROOT / "INDEX.md").write_text("# Papers (mirror of the Harbor shelf)\n\nKept in sync daily from your own backend. Deleting here deletes only the copy; deleting in the app never deletes here.\n\n" + "\n".join(index) + "\n")
    print(f"papers-mirror: {len(rows)} on the shelf, {added} added, {refreshed} text refreshed, {kept} already here -> {ROOT}")

if __name__ == "__main__":
    main()
