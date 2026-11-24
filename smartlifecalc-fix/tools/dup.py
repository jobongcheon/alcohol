import sys,re,html,collections,urllib.parse
c=open(sys.argv[1]).read()
for e in re.findall(r'<entry>(.*?)</entry>',c,re.S):
    if '<blogger:type>POST' not in e or 'LIVE' not in e: continue
    title=html.unescape(re.search(r'<title>(.*?)</title>',e,re.S).group(1))
    body=html.unescape(re.search(r"<content type='html'>(.*?)</content>",e,re.S).group(1))
    hs=[re.sub(r'<[^>]+>','',h).strip() for h in re.findall(r'(?is)<h[23][^>]*>(.*?)</h[23]>',body)]
    faq=sum(1 for h in hs if 'frequently' in h.lower() or 'よくある' in h)
    tables=len(re.findall(r'(?i)<table',body)); forms=len(re.findall(r'(?i)<button',body))
    imgs=re.findall(r'(?is)<img[^>]*src="([^"]+)"',body)
    imgname=urllib.parse.unquote(imgs[0].split('/')[-1]) if imgs else '-'
    alt=re.findall(r'(?is)<img[^>]*alt="([^"]*)"',body)
    print(f"FAQ x{faq} | table {tables} | h2/h3 {len(hs):2} | alt='{alt[0] if alt else '?'}' | img {imgname[:45]:45} | {title[:40]}")
