#!/usr/bin/env python3
# 생활계산기 보관함에 "승인 전 새 글" 칸을 넣고, 영어·일본어 계산기(E36~, J23~)를 승인 후로 미뤄요. 여러 번 돌려도 같은 결과(멱등).
import sys, re, json, html, datetime
SRC, NEWDIR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(SRC, encoding='utf-8').read()
posts = {}
for f in ('en_a', 'en_b', 'jp_a', 'jp_b'):
    for p in json.load(open(f'{NEWDIR}/out/{f}.json', encoding='utf-8')):
        posts[p['id']] = p
SCHED = [('N01','2026-11-26'),('N02','2026-11-30'),('N03','2026-12-03'),('N04','2026-12-07'),('N05','2026-12-10'),('N06','2026-12-14'),('N07','2026-12-17'),('N08','2026-12-21'),
         ('M01','2026-11-27'),('M05','2026-12-01'),('M02','2026-12-04'),('M04','2026-12-08'),('M03','2026-12-11'),('M06','2026-12-15'),('M07','2026-12-18'),('M08','2026-12-22')]
DOW = '월화수목금토일'
def dlabel(d):
    x = datetime.date.fromisoformat(d); return f'{x.month}/{x.day} ({DOW[x.weekday()]})'
E = lambda t: html.escape(t, quote=True)
KO = json.load(open(f'{NEWDIR}/ko_titles.json', encoding='utf-8'))
import base64
IMG = {k: 'data:image/jpeg;base64,' + base64.b64encode(open(f'{NEWDIR}/covers/{k}.jpg', 'rb').read()).decode() for k in KO}
uid = [0]
def cp(label, text, key):
    i = f'nw_{key}'; return f'<button type="button" class="cp" data-t="{i}" data-l="{label}">{label}</button><textarea id="{i}" readonly hidden>{E(text)}</textarea>'
def card(pid, d):
    p = posts[pid]; en = pid.startswith('N'); aid = ('ne' if en else 'nj') + pid[1:]
    blog = ('https://www.blogger.com/blog/posts/6575699470728676694', 'Smart Life Calc', 'smartlifecalc.com', 'https://www.smartlifecalc.com') if en else \
           ('https://www.blogger.com/blog/posts/965551885121880221', 'くらしの計算ツール', 'daily-glow-up.blogspot.com', 'https://daily-glow-up.blogspot.com')
    url = f"{blog[3]}/{d[:4]}/{d[5:7]}/{p['slug']}.html"
    sc_prop = blog[3] + '/'
    steps = [
        f'<li class="step"><span class="sn">1</span><div class="sb"><b>새로 쓰는 글이에요 → 글 목록에서 찾지 말고 왼쪽 위 주황색 「+ 새 글」 누르기</b><a class="go" href="{blog[0]}" target="_blank" rel="noopener">{blog[1]} 열기 ↗</a><span class="sd">열린 화면 왼쪽 위 블로그 이름이 <b>{blog[1]}</b>인지 확인 → 그 아래 <b>「+ 새 글」</b>. 빈 새 글 화면이 열리면 2번으로</span></div></li>',
        f'<li class="step"><span class="sn">2</span><div class="sb"><b>제목 복사 → "제목" 칸에 붙여넣기</b><span class="pv">{E(p["title"])}</span></div>{cp("복사", p["title"], aid+"_t")}</li>',
        f'<li class="step"><span class="sn">3</span><div class="sb"><b>본문 칸 클릭 → 사진 복사 → Ctrl+V → 사진 클릭 → "중간" 크기 선택</b><span class="sd">사진을 먼저 넣고 글은 다음 단계에서 넣어요. 붙여넣기가 안 되면 그림 오른쪽 클릭 → "이미지를 다른 이름으로 저장" 후, 위쪽 사진 아이콘 → "컴퓨터에서 업로드"</span>'
        f'<div class="imgbox"><img src="{IMG[pid]}" alt="{E(p["title"])} 대표이미지"><div class="imside"><div class="imbtn"><button type="button" class="cp imgcp" data-l="사진 복사">사진 복사</button>{cp("이름 복사", pid+"."+p["slug"], aid+"_n")}</div><span class="imnm">📄 {E(pid+"."+p["slug"])}</span></div></div></div></li>',
        f'<li class="step"><span class="sn">4</span><div class="sb"><b>왼쪽 위 연필 ✏️ → "HTML 보기" → 맨 아래 빈 줄 클릭 → 본문 복사 → Ctrl+V</b><span class="sd">맨 위 사진 코드 몇 줄은 지우지 마세요. 그 아래에 붙여 넣으면 됩니다</span></div>{cp("본문 복사", p["html"], aid+"_h")}</li>',
        f'<li class="step"><span class="sn">5</span><div class="sb"><b>라벨 복사 → 오른쪽 "라벨" 칸에 붙여넣기</b><span class="pv">{E(", ".join(p["labels"]))}</span></div>{cp("복사", ", ".join(p["labels"]), aid+"_l")}</li>',
        f'<li class="step"><span class="sn">6</span><div class="sb"><b>검색 설명 복사 → 오른쪽 "검색 설명" 칸에 붙여넣기</b><span class="pv">{E(p["meta"])}</span></div>{cp("복사", p["meta"], aid+"_m")}</li>',
        f'<li class="step"><span class="sn">7</span><div class="sb"><b>오른쪽 "퍼머링크" → "맞춤 퍼머링크" → 주소 복사해서 붙여넣기</b><span class="pv">{E(p["slug"])}</span></div>{cp("복사", p["slug"], aid+"_s")}</li>',
        f'<li class="step"><span class="sn">8</span><div class="sb"><b>오른쪽 위 주황색 "게시" 누르기</b><span class="sd">게시 날짜·위치·옵션은 그대로 두세요</span></div></li>',
        f'<li class="step"><span class="sn">9</span><div class="sb"><b>서치 콘솔에서 색인 요청</b><span class="sd">왼쪽 위 속성이 <b>{E(sc_prop)}</b>인지 확인 → 맨 위 검색창에 주소 붙여넣기 → Enter → "색인 생성 요청". {dlabel(d)}이 아닌 다른 달에 올렸다면 주소의 {d[:4]}/{d[5:7]} 부분이 바뀌니, 올린 글을 열어 주소창 주소를 쓰세요</span><span class="pv">{E(url)}</span><a class="go" href="https://search.google.com/search-console" target="_blank" rel="noopener">서치 콘솔 열기 ↗</a></div>{cp("주소 복사", url, aid+"_u")}</li>',
    ]
    return (f'<article class="calc" id="{aid}" data-{"en" if en else "jp"}="{d}"><header><span class="no">{pid}</span><h3>{E(p["title"])}</h3>'
            f'<span class="made">{E(KO[pid])} · {dlabel(d)} 올리기</span></header>'
            f'<div class="tabs" role="tablist" style="grid-template-columns:1fr"><button type="button" role="tab" class="tab wait" aria-selected="true" aria-controls="p{aid}">'
            f'<span class="tn">{"영어" if en else "일본어"} 구글 블로그 · 새 글</span><span class="tu">{blog[1]} · {blog[2]}</span><span class="ts">아직</span></button></div>'
            f'<div class="panel" id="p{aid}" role="tabpanel"><p class="nonote">{"🇺🇸" if en else "🇯🇵"} {pid} · {E(KO[pid])}<br><span style="color:#b42318">기존 글을 고치는 게 아니라 「+ 새 글」로 새로 올리는 글입니다.</span> 계산기 없는 설명 글이고, 기존 계산기 글 2개로 링크가 걸려 있어요.</p>'
            f'<ol class="steps">{"".join(steps)}</ol></div></article>')
en_ids = [x for x in SCHED if x[0].startswith('N')]; jp_ids = [x for x in SCHED if x[0].startswith('M')]
def planlist(ids):
    return '<ol class="plan" style="list-style:none;margin:6px 0 0">' + ''.join(
        f'<li data-d="{d}"><span class="pd">{dlabel(d)}</span><a href="#{("ne" if pid[0]=="N" else "nj")+pid[1:]}">{pid} {E(KO[pid])}</a></li>' for pid, d in ids) + '</ol>'
sec = ('<!-- NEWPOSTS-START -->'
 '<script>window.HOLD={en:true,jp:true};/* 애드센스 승인 전: 영어·일본어는 새 설명 글만 올려요. 승인되면 false로 바꾸고 E36~·J23~ 일정을 다시 짜요 */</script>'
 '<details class="grpwrap" id="newposts"><summary>🆕 승인 전 새 글 — 영어 N01~N08 · 일본어 M01~M08 (주 2개씩)</summary>'
 '<div class="siteline" style="margin:10px 0;border:3px solid #127a3e;border-radius:12px;padding:14px 16px">'
 '<b>애드센스 승인 전에는 이 새 글만 올립니다 (2026-11-24 정함)</b>'
 '<div class="sd">영어·일본어 블로그의 기존 글 54개는 11/24에 새 내용으로 모두 바꿨으니 <b>더 손대지 않습니다</b>. 미리 만들어 둔 계산기 카드(영어 E36~E50, 일본어 J23~J50)는 <b>승인된 뒤</b>에 Claude가 다시 정리해서 올립니다. '
 '그동안은 계산기가 없는 설명 글을 영어 월·목, 일본어 화·금에 하나씩 올려요. 위 「오늘」 표의 영어·일본어 줄에 그날 글이 나옵니다.</div>'
 '<div class="sd" style="margin-top:6px">재신청: 영어 <b>12/22 이후</b>, 일본어는 영어 결과를 보고 <b>1/5 이후</b>. 승인 메일이 오면 Claude에게 "승인 났어"라고 알려 주세요.</div></div>'
 '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">'
 '<div><b>🇺🇸 영어 (Smart Life Calc)</b>' + planlist(en_ids) + '</div><div><b>🇯🇵 일본어 (くらしの計算ツール)</b>' + planlist(jp_ids) + '</div></div>'
 + ''.join(card(pid, d) for pid, d in SCHED) +
 '</details><!-- NEWPOSTS-END -->')
s = re.sub(r'<!-- NEWPOSTS-START -->.*?<!-- NEWPOSTS-END -->', '', s, flags=re.S)
anchor = '<details class="grpwrap"><summary>📝 짝꿍 정보 글'
assert s.count(anchor) == 1; s = s.replace(anchor, sec + anchor)
# 오늘 표: 승인 전에는 새 글 줄로
a1 = "  if(k===0){for(var i=1;i<=5;i++)"
if "HOLD.en" not in s:
    assert s.count(a1) == 1
    s = s.replace(a1, "  if(window.HOLD&&HOLD.en)slot('🇺🇸 영어 새 글','Smart Life Calc · <b>월·목</b>','article.calc','data-en');\n  else if(k===0){for(var i=1;i<=5;i++)")
    a2 = "(function(){var jk=Math.round("
    assert s.count(a2) == 1
    s = s.replace(a2, "if(window.HOLD&&HOLD.jp)slot('🇯🇵 일본어 새 글','くらしの計算ツール · <b>화·금</b>','article.calc','data-jp');else (function(){var jk=Math.round(")
# 계산기 묶음 제목과 안내
for old, new in [('<summary>🇺🇸 영어 계산기 카드 E01~E50 (50개)</summary>', '<summary>🇺🇸 영어 계산기 카드 E01~E50 (50개 · E36부터 승인 후)</summary>'),
                 ('<summary>🇯🇵 일본어 계산기 카드 J01~J50 (50개)</summary>', '<summary>🇯🇵 일본어 계산기 카드 J01~J50 (50개 · J23부터 승인 후)</summary>')]:
    if old in s: s = s.replace(old, new)
hold_note = lambda who, frm: (f'<div class="siteline holdnote" style="margin:10px 0;border:3px solid #b42318;border-radius:12px;padding:12px 16px;color:#b42318"><b>⏸ {frm}부터는 애드센스 승인 후에 올립니다</b>'
    f'<div class="sd">승인 전에는 「🆕 승인 전 새 글」 칸의 {who} 새 글만 올려요. 승인되면 Claude가 이 카드들을 다시 점검하고 날짜를 새로 잡아 드립니다.</div></div>')
s = re.sub(r'<div class="siteline holdnote".*?</div></div>', '', s, flags=re.S)
for summ, who, frm in [('<summary>🇺🇸 영어 계산기 카드 E01~E50 (50개 · E36부터 승인 후)</summary>', '영어', 'E36'), ('<summary>🇯🇵 일본어 계산기 카드 J01~J50 (50개 · J23부터 승인 후)</summary>', '일본어', 'J23')]:
    assert s.count(summ) == 1; s = s.replace(summ, summ + hold_note(who, frm))
# 규칙 칸에 한 줄
rule_add = '<p id="holdrule" style="margin:8px 0 0;font-weight:700;color:#127a3e">2026-11-24부터: 승인 전에는 계산기 카드(영어 E36~, 일본어 J23~)는 올리지 않고 「🆕 승인 전 새 글」만 올립니다. 기존 54개 글은 손대지 않습니다.</p>'
s = re.sub(r'<p id="holdrule".*?</p>', '', s, flags=re.S)
lc = s.index('<p id="longcount"'); lce = s.index('</p>', lc) + 4; s = s[:lce] + rule_add + s[lce:]
# Claude 할 일 목록 갱신
old_jp = '<li>⏳ <b>일본어 블로그 애드센스 신청 준비</b> <span class="sd">— 글이 10~15개쯤 되면: 일본어 Privacy Policy·About·Contact 페이지</span></li>'
new_jp = ('<li>✓ <b>일본어 블로그 애드센스 신청 준비</b> <span class="sd">— Privacy Policy·About·Contact 있음 (11/24 확인)</span></li>'
          '<li>✓ <b>영어 32개·일본어 22개 글 전면 교체</b> <span class="sd">— 중복 제거·출처·글마다 다른 섹션, 개인정보 페이지 Amazon 문단 삭제, 서치 콘솔 등록·사이트맵 제출·색인 요청 10개 (11/24)</span></li>')
if old_jp in s: s = s.replace(old_jp, new_jp)

# 정보 글 카드 맨 아래 안내문: 글 주제에 맞는 기관으로 (2026-11-26)
AGENCY = {'i01':'국세청(홈택스)','i02':'국세청(홈택스)','i03':'국세청·금융감독원','i04':'고용노동부(고용24)','i05':'고용노동부','i06':'국민건강보험공단·국민연금공단·고용노동부',
 'i07':'위택스·행정안전부','i08':'위택스','i09':'금융감독원·가입한 보험사','i10':'국민건강보험공단','i11':'국민연금공단','i12':'국세청·금융감독원','i13':'보건복지부·국민연금공단',
 'i14':'국민건강보험공단','i15':'한국전력','i16':'고용노동부','i17':'고용노동부','i18':'국세청(홈택스)','i19':'국세청','i20':'금융감독원','i21':'국토교통부','i22':'금융감독원·이용 중인 금융회사','i23':'금융감독원'}
starts = [(m.start(), m.group(1)) for m in re.finditer(r'<article class="calc"[^>]*id="(i\d\d)"', s)]
fixed = 0
for k in range(len(starts) - 1, -1, -1):
    st, aid = starts[k]; en = s.find('</article>', st)
    seg = s[st:en]
    new, n = re.subn(r'제도는 바뀔 수 있으니 [^<\n]{1,40}? 등 공식 안내를 함께 확인하세요', '제도는 바뀔 수 있으니 ' + AGENCY[aid] + ' 등 공식 안내를 함께 확인하세요', seg)
    if new != seg: s = s[:st] + new + s[en:]; fixed += n
print('info footers fixed', fixed)
open(OUT, 'w', encoding='utf-8').write(s)
print('ok', len(s))
