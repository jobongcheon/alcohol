"""Daily live-post check: compare today's posts on the 3 Blogger blogs with the vault sources.
usage: python3 -I daily_check.py <vault.html> <date YYYY-MM-DD> <source json/dir>...
Sources: vault textareas + any JSON (list/dict) that carries title/slug/html|blogger fields."""
import sys, re, json, html, os, subprocess
vault, day, extra = sys.argv[1], sys.argv[2], sys.argv[3:]
BLOGS = {'KR': 'https://mylifedoo.blogspot.com', 'EN': 'https://www.smartlifecalc.com', 'JP': 'https://daily-glow-up.blogspot.com'}
def norm(x):
    x = re.sub(r'<div class="separator".*?</div>', '', x, flags=re.S)
    return re.sub(r'\s+', '', html.unescape(re.sub(r'<[^>]+>', '', x)))
titles, bodies, slugs = set(), {}, set()
s = open(vault, encoding='utf8').read()
for t in re.findall(r'<textarea id="\w+" readonly hidden>(.*?)</textarea>', s, re.S):
    t = html.unescape(t).strip()
    if len(t) < 200: titles.add(t); slugs.add(t)
    else: bodies[norm(t)] = t[:40]
def walk(o):
    if isinstance(o, list): [walk(x) for x in o]
    elif isinstance(o, dict):
        if 'title' in o: titles.add(str(o['title']).strip())
        if 'slug' in o: slugs.add(str(o['slug']).strip())
        for k in ('html', 'blogger', 'body'):
            if isinstance(o.get(k), str) and len(o[k]) > 200: bodies[norm(o[k])] = o.get('id', '?')
        [walk(v) for v in o.values() if isinstance(v, (list, dict))]
for p in extra:
    fs = [os.path.join(r, f) for r, _, fl in os.walk(p) for f in fl if f.endswith(('.json', '.html'))] if os.path.isdir(p) else [p]
    for f in fs:
        if f.endswith('.html'): bodies[norm(open(f, encoding='utf8').read())] = f; continue
        try: walk(json.load(open(f, encoding='utf8')))
        except Exception: pass
bad = 0
for k, base in BLOGS.items():
    raw = subprocess.run(['curl', '-s', '-m', '40', base + '/feeds/posts/default?alt=json&max-results=25'], capture_output=True, text=True).stdout
    try: entries = json.loads(raw)['feed'].get('entry', [])
    except Exception: print(k, 'FEED ERROR'); bad += 1; continue
    allt = {}
    for e in entries: allt.setdefault(e['title']['$t'], []).append(e)
    for e in entries:
        if not (e['published']['$t'][:10] == day or e['updated']['$t'][:10] == day): continue
        url = [l['href'] for l in e['link'] if l['rel'] == 'alternate'][0]
        c = e['content']['$t']; t = e['title']['$t']; slug = url.rsplit('/', 1)[-1].replace('.html', '')
        p = []
        if t not in titles: p.append('제목이 카드와 다름')
        if re.fullmatch(r'blog-post(_\d+)?', slug) or slug not in slugs: p.append('주소(퍼머링크)가 카드와 다름: ' + slug)
        if c.count('class="separator"') != 1: p.append('사진 %d장' % c.count('class="separator"'))
        if norm(c) not in bodies: p.append('본문이 카드와 다름')
        if len(allt[t]) > 1: p.append('같은 제목 글이 %d개(중복)' % len(allt[t]))
        if not e.get('category'): p.append('라벨 없음')
        if t not in titles and norm(c) not in bodies and slug not in slugs:
            print(k, '⚠ 원본 카드를 못 찾음(유튜브 채널 글 등) — 직접 확인', t[:40], url); continue
        bad += bool(p)
        print(k, '✅' if not p else '❌', t[:40], url, '; '.join(p))
print('문제', bad)
