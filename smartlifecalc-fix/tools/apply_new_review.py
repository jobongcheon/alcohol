# 검수 결과(review/*.json)를 새 글(out/*.json)에 적용해요. 이미 적용된 건 건너뛰어요.
import json,glob,sys
N=sys.argv[1]; patches={}
for f in glob.glob(N+'/review/*.json'):
    for pid,L in json.load(open(f)).items(): patches.setdefault(pid,[]).extend(L)
ap=sk=already=0
for f in sorted(glob.glob(N+'/out/*.json')):
    arr=json.load(open(f)); ch=False
    for p in arr:
        for pt in patches.get(p['id'],[]):
            fld=pt['where']; v=p[fld]
            if v.count(pt['old'])==1: p[fld]=v.replace(pt['old'],pt['new']); ap+=1; ch=True
            elif pt['new'] in v: already+=1
            else: sk+=1; print('SKIP',p['id'],fld,pt['severity'],'|',pt['old'][:70])
        assert len(p['meta'])<=(150 if p['id'][0]=='N' else 110),(p['id'],len(p['meta']))
    if ch: json.dump(arr,open(f,'w'),ensure_ascii=False,indent=1)
print('applied',ap,'already',already,'skipped',sk)
