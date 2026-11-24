import json,re,os,html,collections,sys
W=sys.argv[1]; probs=[]
def P(*a): probs.append(' '.join(str(x) for x in a))
VOID={'br','img','input','hr','meta','link','source','wbr'}
def balance(h):
    stack=[]; 
    for m in re.finditer(r'<(/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*?(/?)>',h):
        close,tag,selfc=m.group(1),m.group(2).lower(),m.group(3)
        if tag in VOID or selfc: continue
        if close:
            if not stack: return f'extra </{tag}>'
            if stack[-1]!=tag:
                # li/p/td/tr/option 자동 닫힘 허용
                if tag in stack: 
                    while stack and stack[-1]!=tag: stack.pop()
                    stack.pop(); continue
                return f'mismatch </{tag}> vs <{stack[-1]}>'
            stack.pop()
        else: stack.append(tag)
    return 'unclosed '+','.join(stack) if stack else None
def strip(s): return re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>','',s)
def text(s): return html.unescape(re.sub(r'<[^>]+>',' ',strip(s)))
for lang in ('en','jp'):
    posts=json.load(open(f'{W}/{lang}_posts.json')); urls={p['url'] for p in posts}
    adds={}
    for f in os.listdir(W+'/out'):
        if f.startswith(lang): adds.update(json.load(open(f'{W}/out/{f}')))
    for p in posts:
        slug=p['url'].split('/')[-1][:-5]; new=open(f'{W}/html/{lang}/{slug}.html').read(); old=p['html']; t=p['title'][:28]
        # 1 스크립트/스타일/이미지 동일
        if re.findall(r'(?is)<script.*?</script>',old)!=re.findall(r'(?is)<script.*?</script>',new): P(t,'SCRIPT differs')
        if re.findall(r'(?is)<style.*?</style>',old)!=re.findall(r'(?is)<style.*?</style>',new): P(t,'STYLE differs')
        if re.findall(r'<img[^>]*src="([^"]+)"',old)!=re.findall(r'<img[^>]*src="([^"]+)"',new): P(t,'IMG src differs')
        # 2 계산기 상자 동일 (첫 article 마커 전까지, alt 제외)
        mo,mn=('<!-- ===== Article ===== -->','<div class="slc-article"') if lang=='en' else ('<div class="jc-art"','<div class="jc-article"')
        if re.sub(r'alt="[^"]*"','',old[:old.index(mo)]).strip()!=re.sub(r'alt="[^"]*"','',new[:new.index(mn)]).strip(): P(t,'PREFIX (calculator box) differs')
        # 3 태그 균형
        b=balance(strip(new)); 
        if b: P(t,'TAG',b)
        if old.count('<div')-old.count('</div>')!=new.count('<div')-new.count('</div>'): P(t,'DIV balance changed')
        # 4 찌꺼기
        for bad in ['>S1<','>S2<','FAQH','>ALT<','>META<','DISC.','example.org','alt=""','TODO','lorem']:
            if bad in new: P(t,'LEFTOVER',bad)
        # 5 언어 섞임
        tx=text(new)
        if re.search(r'[가-힣]',tx): P(t,'KOREAN text')
        if lang=='en' and re.search(r'[ぁ-んァ-ン一-龥]',tx): P(t,'JAPANESE in EN')
        if lang=='jp' and re.search(r'[一-鿿]',tx) and re.search(r'[这们没办]',tx): P(t,'SIMPLIFIED CHINESE')
        if lang=='en' and '—' in text(''.join(s['html'] for s in adds[p['id']]['sections'])): P(t,'em dash in new section')
        # 6 내부 링크가 실제 글로
        for u in re.findall(r'href="(https?://(?:www\.smartlifecalc\.com|daily-glow-up\.blogspot\.com)[^"]*)"',new):
            if u.rstrip('/') not in {x.rstrip('/') for x in urls} and u.rstrip('/') not in ('https://www.smartlifecalc.com','https://daily-glow-up.blogspot.com'): P(t,'BAD internal link',u)
        if lang=='en' and 'daily-glow-up' in new or lang=='jp' and 'smartlifecalc' in new: P(t,'CROSS-BLOG link')
        # 7 제목 중복 / FAQ 1개
        hs=[html.unescape(re.sub('<[^>]+>','',h)).strip() for h in re.findall(r'(?is)<h[23][^>]*>(.*?)</h[23]>',strip(new))]
        d=[h for h,n in collections.Counter(hs).items() if n>1]
        if d: P(t,'DUP heading',d)
        a=adds[p['id']]
        if hs.count(a['faq_heading'])!=1: P(t,'FAQ heading count',hs.count(a['faq_heading']))
        if any(h in ('Frequently asked questions','よくある質問','よくある質問（追加）','もっと知りたい Q&A') for h in hs): P(t,'OLD FAQ heading left')
        qa=len(re.findall(r'<p><b>[^<]*</b><br',strip(new)))
        if qa<2: P(t,'few Q&A',qa)
        if len(a['meta'])>150: P(t,'META too long',len(a['meta']))
        if not (5<len(a['alt'])<140): P(t,'ALT length',len(a['alt']))
        if len(a['sources'])<1: P(t,'NO sources')
        # 9 빈 섹션/빈 p
        if re.search(r'<p>\s*</p>|<ul>\s*</ul>|<h3[^>]*>\s*</h3>',new): P(t,'EMPTY element')
        # 10 외부 링크 target 포함, 미완 엔티티
        if re.search(r'&(?!amp;|lt;|gt;|quot;|nbsp;|#\d+;|[a-z]+;)',strip(new)): P(t,'BARE &')
print('\n'.join(probs) if probs else 'ALL CLEAN'); print(len(probs),'problems')
