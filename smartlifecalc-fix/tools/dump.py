import sys,re,html
c=open(sys.argv[1]).read(); key=sys.argv[2]
for e in re.findall(r'<entry>(.*?)</entry>',c,re.S):
    t=html.unescape(re.search(r'<title>(.*?)</title>',e,re.S).group(1))
    if not t.startswith(key) or 'LIVE' not in e: continue
    body=html.unescape(re.search(r"<content type='html'>(.*?)</content>",e,re.S).group(1))
    body=re.sub(r'(?is)<script.*?</script>','<script/>',body); body=re.sub(r'(?is)<style.*?</style>','<style/>',body)
    body=re.sub(r'src="[^"]{40,}"','src="…"',body)
    print(body); break
