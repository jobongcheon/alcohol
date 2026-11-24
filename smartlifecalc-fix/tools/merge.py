#!/usr/bin/env python3
# 기존 글(짧은 블록 + 긴 가이드)을 하나로 합치고, 작가 에이전트가 쓴 고유 섹션·출처·alt·관련글을 끼워 넣어요.
import sys, re, json, html as _html, os, hashlib
class html:
    escape=staticmethod(lambda s,quote=False:_html.escape(s,quote=quote))
    unescape=staticmethod(_html.unescape)
WORK=sys.argv[1]; OUT=sys.argv[2]; DRY='--dry' in sys.argv
os.makedirs(OUT+'/en',exist_ok=True); os.makedirs(OUT+'/jp',exist_ok=True)
H=re.compile(r'(<h([23])[^>]*>(.*?)</h\2>)',re.S)
def sections(inner):
    parts=H.split(inner); intro=parts[0]; secs=[]
    for i in range(1,len(parts),4):
        tag,lvl,title,body=parts[i],parts[i+1],parts[i+2],parts[i+3]
        secs.append(dict(lvl=int(lvl),h=re.sub(r'<[^>]+>','',title).strip(),tag=tag,body=body))
    return intro,secs
def txt(s): return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',s))).strip()
def words(s): return set(re.findall(r'[a-z0-9]+',txt(s).lower()))
def jaccard(a,b): return len(a&b)/max(1,len(a|b))
def qas(body):
    # <p><b>Q</b><br>A</p> 묶음과 그 밖의 p(면책 등)를 분리
    out=[]; rest=[]
    for p in re.findall(r'<p[^>]*>.*?</p>',body,re.S):
        if re.search(r'<b>',p) and '<br' in p: out.append(p)
        else: rest.append(p)
    return out,rest
def qkey(p):
    m=re.search(r'<b>(.*?)</b>',p,re.S); return re.sub(r'[^a-z0-9ぁ-んァ-ン一-龥]','',txt(m.group(1)).lower())[:24] if m else txt(p)[:24]
def dedupe_qas(lists):
    seen=set(); out=[]
    for L in lists:
        for p in L:
            k=qkey(p)
            if k in seen: continue
            seen.add(k); out.append(p)
    return out
def wrap_tables(h):
    h=re.sub(r'<table','<div style="overflow-x:auto"><table',h); return re.sub(r'</table>','</table></div>',h)
def h3(t): return f'<h3 style="font-size:22px;margin-top:28px">{t}</h3>'
def srcs(items,lang):
    li=''.join(f'<li><a href="{s["url"]}" rel="noopener" target="_blank">{html.escape(s["name"])}</a></li>' for s in items)
    return h3('Sources and further reading' if lang=='en' else '参考にした資料')+f'<ul>{li}</ul>'
def pick(lst,key): return lst[int(hashlib.md5(key.encode()).hexdigest(),16)%len(lst)]
def short_title(t): return re.split(r'\s[-–]\s',t)[0].strip()

def merge_en(p,a,titles):
    b=p['html']
    i_art=b.index('<!-- ===== Article ===== -->'); i_guide=b.index('<div class="slc-guide"')
    i_more=b.index('<div style="margin-top:30px;border:2px solid')
    prefix,short,guide,tail=b[:i_art],b[i_art:i_guide],b[i_guide:i_more],b[i_more:]
    s_inner=re.search(r'<!-- ===== Article ===== -->\s*<div[^>]*>(.*)</div>\s*$',short,re.S).group(1)
    g_inner=re.search(r'<div class="slc-guide"[^>]*>(.*)</div>\s*$',guide,re.S).group(1)
    s_intro,S=sections(s_inner); g_intro,G=sections(g_inner)
    g_h2=[s for s in G if s['lvl']==2]; g_h3=[s for s in G if s['lvl']==3]
    # 가이드 h2 뒤의 서문 = 첫 h3 전까지의 h2 body
    g_lead=g_h2[0]['body'] if g_h2 else ''
    g_title=g_h2[0]['h'] if g_h2 else a['article_h2']
    if a.get('article_h2') and not g_h2: g_title=a['article_h2']
    g_has_table='<table' in guide
    def find(L,pred): return next((s for s in L if pred(s['h'].lower())),None)
    howto=find(S,lambda h:h.startswith('how to use')); formula=find(S,lambda h:'formula' in h)
    tips=find(S,lambda h:h=='tips'); sfaq=find(S,lambda h:'frequently' in h or 'question' in h)
    gfaq=find(g_h3,lambda h:'frequently' in h or 'question' in h); grel=find(g_h3,lambda h:'related' in h)
    used={(howto['h'] if howto else '').lower(),(formula['h'] if formula else '').lower()}
    body_secs=[s for s in g_h3 if s not in (gfaq,grel) and s['h'].lower() not in used]  # 짧은 블록과 같은 제목(예: The formula)은 가이드 쪽을 버려요
    out=[]
    out.append(f'<div class="slc-article" style="margin-top:36px;font-size:18px;line-height:1.75">')
    out.append(s_intro.strip())
    out.append(f'<h2 style="font-size:26px;margin-top:10px">{html.escape(g_title) if g_title==a.get("article_h2") else g_title}</h2>')
    out.append(g_lead.strip())
    if howto: out.append(h3(howto['h']) + howto['body'])
    if formula:
        fb=formula['body']
        fb=re.sub(r'<p><b>Example:</b>.*?</p>','',fb,flags=re.S)
        if g_has_table: fb=re.sub(r'<table.*?</table>','',fb,flags=re.S)
        out.append(h3(formula['h'])+fb)
    # 가이드 본문 섹션 + 고유 섹션 끼워 넣기
    sec=a['sections']
    for i,s in enumerate(body_secs):
        out.append(h3(s['h'])+s['body'])
        if i==0: out.append(h3(html.escape(sec[0]['h']))+wrap_tables(sec[0]['html']))
    if len(body_secs)==0: out.append(h3(html.escape(sec[0]['h']))+wrap_tables(sec[0]['html']))
    # 남는 팁(가이드에 없는 것만)
    if tips:
        STOP={'the','a','an','and','or','of','to','in','on','for','is','are','be','it','that','this','with','your','you','as','at','by','if','not','so','do','can','will','than','from','its','use','many','people','before','after'}
        gw=words(''.join(s['body'] for s in body_secs)+g_lead+(gfaq['body'] if gfaq else ''))
        def covered(li):
            cw={w for w in words(li) if len(w)>=4 and w not in STOP}
            return len(cw&gw)/max(1,len(cw))
        keep=[li for li in re.findall(r'<li>.*?</li>',tips['body'],re.S) if covered(li)<0.6]
        if keep: out.append(h3(pick(['Small details that change the result','Before you rely on the number','Two things to double-check','Worth knowing'],p['id']))+'<ul>'+''.join(keep)+'</ul>')
    out.append(h3(html.escape(sec[1]['h']))+wrap_tables(sec[1]['html']))
    gq,grest=qas(gfaq['body'] if gfaq else ''); sq,srest=qas(sfaq['body'] if sfaq else '')
    out.append(h3(html.escape(a['faq_heading']))+''.join(dedupe_qas([gq,sq])))
    if grel: out.append(h3(grel['h'])+re.sub(r'<p style="font-size:15px;color:#555">.*?</p>','',grel['body'],flags=re.S))
    out.append(srcs(a['sources'],'en'))
    chk=re.search(r'<p style="font-size:15px;color:#555"><b>How we checked this page:</b>(.*?)</p>',guide,re.S)
    chk_txt=chk.group(1) if chk else ' example amounts recalculated independently. Last reviewed November 2026.'
    chk_txt=re.sub(r'General information only, not professional advice\.?','',chk_txt).strip()
    out.append(f'<p style="font-size:15px;color:#555;margin-top:24px"><b>How we checked this page:</b> {chk_txt} {html.escape(a["disclaimer"])}</p>')
    out.append('</div>')
    # 하단 상자: 관련 글 3개
    rel=[(t,titles[t]) for t in a['related'] if t in titles][:3]
    links=' · '.join(f'<a href="{u}" style="color:#1a56db">{html.escape(short_title(t))}</a>' for t,u in rel)
    box=(f'<div style="margin-top:30px;border:2px solid #1a56db;border-radius:10px;padding:16px;text-align:center"><b style="font-size:21px">You may also need</b><br>'
         f'<span style="font-size:17px">{links}</span><br><a href="https://www.smartlifecalc.com/" style="display:inline-block;margin-top:10px;font-size:17px;font-weight:bold;color:#1a56db">▶ All free calculators</a></div>')
    tail=re.sub(r'<div style="margin-top:30px;border:2px solid.*?</div>',lambda m:box,tail,count=1,flags=re.S)
    prefix=prefix.replace('alt=""',f'alt="{html.escape(a["alt"],quote=True)}"',1)
    art=re.sub(r'&(?!amp;|lt;|gt;|quot;|nbsp;|#\\d+;|[a-zA-Z]+;)','&amp;','\n'.join(out))
    return prefix+art+'\n'+tail

def merge_jp(p,a,titles):
    b=p['html']
    i_art=b.index('<div class="jc-art"'); i_guide=b.index('<div class="jc-guide"')
    i_more=b.rfind('<div',0,b.index('ほかの無料計算ツール'))
    prefix,short,guide,tail=b[:i_art],b[i_art:i_guide],b[i_guide:i_more],b[i_more:]
    s_inner=re.search(r'<div class="jc-art"[^>]*>(.*)</div>\s*$',short,re.S).group(1)
    g_inner=re.search(r'<div class="jc-guide"[^>]*>(.*)</div>\s*$',guide,re.S).group(1)
    s_intro,S=sections(s_inner); g_intro,G=sections(g_inner)
    def find(L,pred): return next((s for s in L if pred(s['h'])),None)
    howto=find(S,lambda h:h.startswith('使い方')); sfaq=find(S,lambda h:'よくある質問' in h)
    isfaq=lambda h:'質問' in h or 'Q&' in h or 'Q＆' in h
    gfaqs=[s for s in G if isfaq(s['h'])]; grel=find(G,lambda h:'あわせて' in h or '計算ツール' in h and 'あわせ' in h)
    if not grel: grel=find(G,lambda h:'関連' in h)
    body_secs=[s for s in G if s not in gfaqs and s is not grel]
    sec=a['sections']
    out=[f'<div class="jc-article" style="margin-top:32px;font-size:17px;line-height:1.85">']
    out.append(s_intro.strip()); out.append(g_intro.strip())
    out.append(f'<h2 style="font-size:24px;margin-top:10px">{html.escape(a["article_h2"])}</h2>')
    # 짧은 블록의 모든 섹션(FAQ 빼고)을 순서대로 유지: 계산식·표·용어 설명이 여기에만 있어요
    for s in S:
        if s is sfaq: continue
        body=re.sub(r'<p[^>]*>※\s*この計算ツールの結果は.*?</p>','',s['body'],flags=re.S)
        out.append(h3(s['h'])+body)
    # 계산예 섹션들 뒤에 고유 섹션1
    last_ex=max([i for i,s in enumerate(body_secs) if s['h'].startswith('計算例')],default=0)
    for i,s in enumerate(body_secs):
        out.append(h3(s['h'])+s['body'])
        if i==last_ex: out.append(h3(html.escape(sec[0]['h']))+wrap_tables(sec[0]['html']))
    if not body_secs: out.append(h3(html.escape(sec[0]['h']))+wrap_tables(sec[0]['html']))
    out.append(h3(html.escape(sec[1]['h']))+wrap_tables(sec[1]['html']))
    allq=[qas(sfaq['body'])[0] if sfaq else []]+[qas(s['body'])[0] for s in gfaqs]
    out.append(h3(html.escape(a['faq_heading']))+''.join(dedupe_qas(allq)))
    chk=re.search(r'<p[^>]*><b>このページの確認方法[：:]</b>(.*?)</p>',guide,re.S)
    if grel: out.append(h3(grel['h'])+re.sub(r'<p[^>]*><b>このページの確認方法.*?</p>','',grel['body'],flags=re.S))
    out.append(srcs(a['sources'],'jp'))
    chk_txt=chk.group(1) if chk else ' 計算例はツールと同じ式で別に計算し、一致を確かめました。最終確認：2026年11月。'
    chk_txt=re.sub(r'一般的な情報であり、専門的な助言ではありません。?','',chk_txt).strip()
    out.append(f'<p style="font-size:14px;color:#555;margin-top:24px"><b>このページの確認方法：</b>{chk_txt} {html.escape(a["disclaimer"])}</p>')
    out.append('</div>')
    rel=[(t,titles[t]) for t in a['related'] if t in titles][:3]
    links=' ・ '.join(f'<a href="{u}" style="color:#1a56db">{html.escape(short_title(t))}</a>' for t,u in rel)
    m=re.search(r'<div[^>]*>(?:(?!<div).)*?ほかの無料計算ツール.*?</div>',tail,re.S)
    box=(f'<div style="margin-top:30px;border:2px solid #1a56db;border-radius:10px;padding:16px;text-align:center"><b style="font-size:20px">こちらもどうぞ</b><br>'
         f'<span style="font-size:16px">{links}</span><br><a href="https://daily-glow-up.blogspot.com/" style="display:inline-block;margin-top:10px;font-size:16px;font-weight:bold;color:#1a56db">▶ 計算ツール一覧を見る</a></div>')
    tail=tail[:m.start()]+box+tail[m.end():] if m else tail
    prefix=prefix.replace('alt=""',f'alt="{html.escape(a["alt"],quote=True)}"',1)
    art=re.sub(r'&(?!amp;|lt;|gt;|quot;|nbsp;|#\\d+;|[a-zA-Z]+;)','&amp;','\n'.join(out))
    return prefix+art+'\n'+tail

def dummy(p,lang):
    return dict(alt='ALT',meta='META',article_h2='H2 '+p['title'][:20],faq_heading='FAQH',sections=[dict(h='S1',html='<p>s1</p>'),dict(h='S2',html='<p>s2</p>')],
                sources=[dict(name='Src',url='https://example.org/')],related=[],disclaimer='DISC.')
manifest=[]
for lang in ('en','jp'):
    posts=json.load(open(f'{WORK}/{lang}_posts.json')); titles={p['title']:p['url'] for p in posts}
    adds={}
    for f in sorted(os.listdir(WORK+'/out')):
        if f.startswith(lang) and f.endswith('.json'): adds.update(json.load(open(f'{WORK}/out/{f}')))
    for p in posts:
        a=adds.get(p['id']) or (dummy(p,lang) if DRY else None)
        if a is None: print('MISSING additions',lang,p['title']); continue
        try:
            new=(merge_en if lang=='en' else merge_jp)(p,a,titles)
        except Exception as ex:
            print('FAIL',lang,p['title'],repr(ex)); continue
        slug=p['url'].rstrip('/').split('/')[-1].replace('.html','')
        open(f'{OUT}/{lang}/{slug}.html','w').write(new)
        nf=len(re.findall(r'(?i)frequently asked|よくある質問|質問',new)); 
        manifest.append(dict(lang=lang,id=p['id'],title=p['title'],url=p['url'],slug=slug,alt=a['alt'],meta=a['meta'],old_words=len(txt(re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>','',p['html'])).split()),new_words=len(txt(re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>','',new)).split()),old_chars=len(txt(re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>','',p['html']))),new_chars=len(txt(re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>','',new))),h3=len(re.findall(r'<h3',new)),tables=len(re.findall(r'<table',new)),ext=len(re.findall(r'href="https?://(?!www\.smartlifecalc|daily-glow-up)',new))))
json.dump(manifest,open(OUT+'/manifest.json','w'),ensure_ascii=False,indent=1)
for m in manifest: print(f"{m['lang']} {m['old_chars']:6}→{m['new_chars']:6} chars  h3 {m['h3']:2} tbl {m['tables']} ext {m['ext']}  {m['title'][:50]}")
