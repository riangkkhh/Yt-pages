"""Runs inside GitHub Actions (stdlib only). Reads videos.txt, checks each video
exists/is embeddable, fetches its title and writes videos.json."""
import json
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).parent
THUMB = "https://i.ytimg.com/vi/{}/hqdefault.jpg"
OEMBED = "https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v={}"
ID_RE = re.compile(r"(?:v=|youtu\.be/|/embed/|/shorts/|/live/)([A-Za-z0-9_-]{11})|^([A-Za-z0-9_-]{11})$")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (yt-pages builder)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return None, b""


def parse_ids():
    ids, seen = [], set()
    for line in (ROOT / "videos.txt").read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        m = ID_RE.search(line) if line else None
        vid = (m.group(1) or m.group(2)) if m else None
        if vid and vid not in seen:
            seen.add(vid)
            ids.append(vid)
    return ids


def check(vid, old):
    """Returns {'id','title'} if available, None if gone, or the old entry on a transient error."""
    code, _ = fetch(THUMB.format(vid))
    if code in (404, 410):
        return None
    ocode, body = fetch(OEMBED.format(vid))
    if ocode == 200:
        try:
            return {"id": vid, "title": json.loads(body).get("title") or vid}
        except ValueError:
            pass
    elif ocode in (401, 403, 404):
        return None
    return old.get(vid)  # network hiccup: keep what we knew (or drop if new)


def main():
    out = ROOT / "videos.json"
    old = {}
    if out.exists():
        try:
            old = {v["id"]: v for v in json.loads(out.read_text(encoding="utf-8"))}
        except ValueError:
            pass
    ids = parse_ids()
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda v: check(v, old), ids))
    videos = [r for r in results if r]
    text = json.dumps(videos, ensure_ascii=False, indent=1) + "\n"
    if not out.exists() or out.read_text(encoding="utf-8") != text:
        out.write_text(text, encoding="utf-8")
    print(f"{len(videos)} available out of {len(ids)}")


if __name__ == "__main__":
    main()
