import json,re,collections,sys
rows=[r for r in json.load(open(sys.argv[1])) if r['type']=='POST' and r['status']=='LIVE']
def sents(t): return [s.strip().lower() for s in re.split(r'(?<=[.!?])\s+',t) if len(s.split())>=6]
cnt=collections.Counter()
per={}
for r in rows:
    ss=set(sents(r['text'])); per[r['title']]=ss
    for s in ss: cnt[s]+=1
print("문장이 여러 글에 똑같이 반복되는 것 (글 수, 문장):")
for s,n in cnt.most_common(25):
    if n>=3: print(n, s[:110])
print()
# per post share of sentences that appear in >=2 other posts
print("글별 '다른 글과 똑같은 문장' 비율:")
for r in rows:
    ss=sents(r['text']); dup=sum(1 for s in ss if cnt[s]>=3)
    print(f"{dup/len(ss)*100 if ss else 0:5.1f}%  {len(ss):3} sents  {r['title'][:60]}")
# headings
print()
hs=collections.Counter()
import html
for r in rows: pass
