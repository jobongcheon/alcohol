import sys, re, json, html, collections
import xml.etree.ElementTree as ET
A='{http://www.w3.org/2005/Atom}'; B='{http://schemas.google.com/blogger/2018}'
root=ET.parse(sys.argv[1]).getroot()
rows=[]
for e in root.findall(A+'entry'):
    g=lambda t,ns=A: (e.findtext(ns+t) or '').strip()
    typ=g('type',B); st=g('status',B); title=g('title'); c=g('content')
    pub=g('published')[:10]; upd=g('updated')[:10]
    url=''
    for l in e.findall(A+'link'):
        if l.get('rel')=='alternate': url=l.get('href')
    filename=g('filename',B)
    # strip scripts/styles then tags
    body=re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>','',c)
    nscript=len(re.findall(r'(?i)<script',c)); nstyle=len(re.findall(r'(?i)<style',c))
    nimg=len(re.findall(r'(?i)<img',c)); nh2=len(re.findall(r'(?i)<h[23]',c))
    nlinks=len(re.findall(r'(?i)<a ',body)); ntable=len(re.findall(r'(?i)<table',body))
    text=html.unescape(re.sub(r'<[^>]+>',' ',body)); text=re.sub(r'\s+',' ',text).strip()
    words=len(text.split()); chars=len(text)
    kor=len(re.findall(r'[가-힣]',text)); jp=len(re.findall(r'[ぁ-んァ-ン]',text))
    labels=[cat.get('term') for cat in e.findall(A+'category')]
    rows.append(dict(type=typ,status=st,title=title,pub=pub,upd=upd,url=url,filename=filename,words=words,chars=chars,kor=kor,jp=jp,img=nimg,h=nh2,links=nlinks,script=nscript,style=nstyle,table=ntable,labels=labels,text=text))
json.dump(rows,open(sys.argv[2],'w'),ensure_ascii=False)
print(f"{'TYPE':5}{'ST':6}{'PUB':11}{'WORDS':>6}{'IMG':>4}{'H2':>4}{'SCR':>4}  TITLE")
for r in sorted(rows,key=lambda r:(r['type'],r['pub'])):
    print(f"{r['type'][:4]:5}{r['status'][:5]:6}{r['pub']:11}{r['words']:6}{r['img']:4}{r['h']:4}{r['script']:4}  {r['title'][:80]}")
print('\nTOTAL',len(rows), collections.Counter((r['type'],r['status']) for r in rows))
print('by month', sorted(collections.Counter(r['pub'][:7] for r in rows if r['type']=='POST').items()))
print('labels', collections.Counter(l for r in rows for l in r['labels']).most_common(20))
