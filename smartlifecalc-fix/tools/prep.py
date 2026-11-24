import sys,re,html,json
def posts(path,base):
    c=open(path).read(); out=[]
    for e in re.findall(r'<entry>(.*?)</entry>',c,re.S):
        if '<blogger:type>POST' not in e or '<blogger:status>LIVE' not in e: continue
        g=lambda t:(re.search(rf'<{t}>(.*?)</{t}>',e,re.S) or [None,''])[1]
        title=html.unescape(g('title')); fn=g('blogger:filename'); md=html.unescape(g('blogger:metaDescription'))
        raw=html.unescape(re.search(r"<content type='html'>(.*?)</content>",e,re.S).group(1))
        body=re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>','',raw)
        heads=[re.sub(r'<[^>]+>','',h).strip() for h in re.findall(r'(?is)<h[23][^>]*>(.*?)</h[23]>',body)]
        text=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',body)).strip()
        labels=re.findall(r"<category[^>]*term='([^']*)'",e)
        out.append(dict(id=re.search(r'post-(\d+)',e).group(1),title=title,url=base+fn,meta=md,labels=labels,headings=heads,text=text,html=raw,published=g('published')[:10]))
    return out
EN=posts(sys.argv[1],'https://www.smartlifecalc.com'); JP=posts(sys.argv[2],'https://daily-glow-up.blogspot.com')
json.dump(EN,open(sys.argv[3]+'/en_posts.json','w'),ensure_ascii=False); json.dump(JP,open(sys.argv[3]+'/jp_posts.json','w'),ensure_ascii=False)
def batches(lst,n):
    k=-(-len(lst)//n); return [lst[i:i+k] for i in range(0,len(lst),k)]
titles_en=[dict(title=p['title'],url=p['url']) for p in EN]; titles_jp=[dict(title=p['title'],url=p['url']) for p in JP]
for lang,L,T,n in (('en',EN,titles_en,4),('jp',JP,titles_jp,3)):
    for i,b in enumerate(batches(L,n),1):
        json.dump(dict(all_titles=T,posts=[{k:v for k,v in p.items() if k!='html'} for p in b]),open(f"{sys.argv[3]}/in/{lang}{i}.json",'w'),ensure_ascii=False,indent=1)
        print(lang,i,[p['title'][:30] for p in b])
print(EN[0]['url'],JP[0]['url'])
