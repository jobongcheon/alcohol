# 작가 결과 후처리: 검색 설명 150자 이내로, 본문의 맨 & 이스케이프, 검수 패치 적용
import json,os,re,sys,glob
W=sys.argv[1]
META={
 "See how much house you can afford":"See how much house you can afford from income, debts, down payment and rate using the 28/36 rule, and why 2% property tax cuts the budget by $64,000.",
 "Count hours between two times":"Count hours between two times, with unpaid breaks and overnight shifts, convert minutes to decimal hours and check a 42-hour week for overtime.",
 "Add, subtract, multiply or divide two fractions":"Add, subtract, multiply or divide two fractions and get the simplified answer, mixed number and decimal, plus tape-measure sixteenths in inches.",
 "Project a balance from a deposit":"Project a balance from a deposit, monthly contribution, rate and years, and see why $300 a month from age 25 ends more than double the age-35 result.",
 "Live countdown of the weeks":"Live countdown of the weeks and days left in 2026, with today's ISO week number and day of year. 2026 has 53 ISO weeks and 53 Thursdays.",
 "Tip calculator for 15%":"Tip calculator for 15%, 18%, 20% or a custom rate, with a bill split and round-up option. Also explains the $2.13 tipped wage behind U.S. tipping.",
 "Percent change between two numbers":"Percent change between two numbers, plus difference and percent difference. See why a 20% pay cut then a 20% raise leaves you 4% short.",
 "Weighted class grade from your scores":"Weighted class grade from your scores and weights, plus the final exam score you need. Works for points-based classes too, with a 600-point example.",
 "Find the date 30, 60, 90 or 180 days":"Find the date 30, 60, 90 or 180 days from today, in calendar or business days, and see which federal consumer deadlines are counted in days.",
 "Convert an hourly wage to yearly":"Convert an hourly wage to yearly, biweekly and weekly pay, or a salary to hourly. Case study: a $62,000 salary at 45 hours a week vs $31 an hour.",
 "Convert milliliters to US or UK":"Convert milliliters to US or UK fluid ounces, cups and liters, with standard drink sizes (12 oz, 5 oz, 1.5 oz) in ml and a 64-ounce day in bottles.",
 "Convert centimeters to inches":"Convert centimeters to inches and feet-inches for height and furniture, with an A4 vs Letter paper table and a sofa-through-the-door check.",
 "Car payment with sales tax":"Car payment with sales tax, trade-in and down payment. Compare 0% financing against a $2,500 rebate and see how a 72-month loan tracks car value.",
 "Project your 401(k) and IRA balance":"Project your 401(k) and IRA balance at retirement and the income it supports under the 4% rule, with 2026 contribution limits and Social Security.",
 "See monthly savings and the break-even month":"See monthly savings and the break-even month for a mortgage refinance, plus a 15-year case that raises the payment $452 yet saves about $237,000.",
}
AMP=re.compile(r'&(?!amp;|lt;|gt;|quot;|nbsp;|#\d+;|[a-zA-Z]+;)')
patches={}
for f in glob.glob(W+'/review/*.json'):
    for pid,L in json.load(open(f)).items(): patches.setdefault(pid,[]).extend(L)
applied=skipped=0
for f in sorted(glob.glob(W+'/out/*.json')):
    d=json.load(open(f)); changed=False
    for pid,a in d.items():
        for k,v in META.items():
            if a['meta'].startswith(k) and a['meta']!=v: a['meta']=v; changed=True
        for s in a['sections']:
            n=AMP.sub('&amp;',s['html'])
            if n!=s['html']: s['html']=n; changed=True
        for k in ('article_h2','faq_heading','alt','disclaimer'):
            n=a[k].replace('&amp;','&'); 
            if n!=a[k]: a[k]=n; changed=True
        for pt in patches.get(pid,[]):
            if pt.get('applied'): continue
            m=re.match(r'sections\[(\d)\]\.html',pt['where'])
            tgt=a['sections'][int(m.group(1))] if m else a
            key='html' if m else pt['where']
            if tgt[key].count(pt['old'])==1: tgt[key]=tgt[key].replace(pt['old'],pt['new']); applied+=1; changed=True; pt['applied']=True
            else: skipped+=1; print('PATCH SKIP',pid,pt['where'],pt['severity'],'|',pt['old'][:60])
        assert len(a['meta'])<=150,(pid,len(a['meta']),a['meta'])
    if changed: json.dump(d,open(f,'w'),ensure_ascii=False,indent=1)
print('patches applied',applied,'skipped',skipped)
