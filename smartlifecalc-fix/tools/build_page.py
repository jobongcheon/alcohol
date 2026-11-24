#!/usr/bin/env python3
# 복사용 페이지(아티팩트)와 posts.json을 만들어요
import sys,os,re,json,html
WORK,HTMLDIR,PUB=sys.argv[1],sys.argv[2],sys.argv[3]
man=json.load(open(HTMLDIR+'/manifest.json'))
adds={}
for f in os.listdir(WORK+'/out'):
    if f.endswith('.json'): adds.update(json.load(open(f'{WORK}/out/{f}')))
pages=json.load(open(WORK+'/pages.json'))
items=[]
for m in man:
    a=adds.get(m['id'],{})
    body=open(f"{HTMLDIR}/{m['lang']}/{m['slug']}.html").read()
    items.append(dict(kind='post',lang=m['lang'],id=m['id'],title=m['title'],url=m['url'],html=body,meta=m['meta'],alt=m['alt'],
        new_sections=[s['h'] for s in a.get('sections',[])],faq=a.get('faq_heading',''),sources=[s['name'] for s in a.get('sources',[])],
        old_chars=m['old_chars'],new_chars=m['new_chars'],ext=m['ext']))
# 페이지: 프라이버시에서 Amazon 문단 제거
for k,v in pages.items():
    new=re.sub(r'(?is)<h[23][^>]*>\s*(Affiliate links|アフィリエイトについて)\s*</h[23]>\s*<p>.*?</p>\s*','',v['html'])
    if new!=v['html']:
        base='https://www.smartlifecalc.com' if v['lang']=='en' else 'https://daily-glow-up.blogspot.com'
        items.append(dict(kind='page',lang=v['lang'],id=k,title=v['title'],url=base+v['fn'],html=new,meta='',alt='',new_sections=[],faq='',sources=[],
            note='Amazon 제휴 문단 삭제 (실제 Amazon 링크가 없는데 적혀 있어서 신뢰도만 깎여요)',old_chars=0,new_chars=0,ext=0))
json.dump(items,open(PUB+'/posts.json','w'),ensure_ascii=False)
print(len(items),'items', sum(len(i['html']) for i in items)//1024,'KB')
