# 새 글 16개 대표 사진: 기존 카드와 같은 600x600 모양(흰 바탕·파란 테두리·위 작은 글·큰 제목·파란 띠)
import sys
from PIL import Image, ImageDraw, ImageFont
OUT = sys.argv[1]
BLUE = (26, 86, 219); INK = (17, 17, 17)
EN_B = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'; EN_S = '/usr/share/fonts/opentype/inter/Inter-Bold.otf'
JP = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'
C = {
 'N01': ('Moving mid-month?', ['PRORATED', 'RENT'], '3 ways to split the month'),
 'N02': ('Pay off your home sooner', ['BIWEEKLY', 'MORTGAGE'], 'Savings on a $300,000 loan'),
 'N03': ('Build your safety net', ['SAVE', '$10,000'], 'How many months it takes'),
 'N04': ('Baking conversions', ['OVEN', 'TEMPS'], '°C · °F · gas mark chart'),
 'N05': ('Plan PTO and payroll', ['2027', 'WORKDAYS'], 'Month-by-month table'),
 'N06': ('What interest really costs', ['$1,000 CARD', 'BALANCE'], 'At 20%, 25% and 30% APR'),
 'N07': ('4 days x 10 hours', ['4x10', 'OVERTIME'], 'How the 40-hour rule works'),
 'N08': ('Mortgage payment went up?', ['ESCROW', 'INCREASE'], 'How to check the numbers'),
 'M01': ('月の途中で入居・退去', ['家賃の', '日割り計算'], '3つの計算方法を比較'),
 'M02': ('生まれ年でわかる', ['入学・卒業', '早見表'], '小学校から大学まで'),
 'M03': ('生まれ年別', ['七五三・', '成人式'], '何年にお祝い？早見表'),
 'M04': ('家電ごとにわかる', ['電気代の', '計算方法'], '消費電力×時間×単価'),
 'M05': ('連休の計画に', ['2027年の', '祝日'], '三連休の一覧つき'),
 'M06': ('60歳〜75歳', ['年金は', 'いつから'], '繰上げ・繰下げの増減率'),
 'M07': ('BMIだけでは不十分', ['腹囲と', '体脂肪率'], 'メタボ基準の見方'),
 'M08': ('歩数からわかる', ['1万歩で', '何kcal？'], '体重別の早見表'),
}
def font(path, size): return ImageFont.truetype(path, size)
def fit(draw, text, path, maxw, start, stroke=0):
    s = start
    while s > 30:
        f = font(path, s); w = draw.textbbox((0, 0), text, font=f, stroke_width=stroke)[2]
        if w <= maxw: return f
        s -= 2
    return font(path, s)
for k, (top, lines, pill) in C.items():
    jp = k[0] == 'M'
    im = Image.new('RGB', (600, 600), 'white'); d = ImageDraw.Draw(im)
    d.rectangle([18, 18, 581, 581], outline=BLUE, width=8)
    st = 1 if jp else 0
    ft = fit(d, top, JP if jp else EN_S, 470, 34, st)
    d.text((300, 98), top, font=ft, fill=BLUE, anchor='mm', stroke_width=st, stroke_fill=BLUE)
    sw = 2 if jp else 0
    size = min(fit(d, ln, JP if jp else EN_B, 490, 100 if jp else 112, sw).size for ln in lines)
    fb = font(JP if jp else EN_B, size)
    lh = int(size * (1.22 if jp else 1.08)); ys = [288 - lh // 2, 288 + lh - lh // 2] if len(lines) == 2 else [288]
    for ln, y in zip(lines, ys):
        d.text((300, y), ln, font=fb, fill=INK, anchor='mm', stroke_width=sw, stroke_fill=INK)
    d.rounded_rectangle([55, 452, 545, 526], radius=14, fill=BLUE)
    fp = fit(d, pill, JP if jp else EN_S, 450, 32, st)
    d.text((300, 489), pill, font=fp, fill='white', anchor='mm', stroke_width=st, stroke_fill='white')
    im.save(f'{OUT}/{k}.jpg', quality=88)
# 미리보기 한 장에 16개
sheet = Image.new('RGB', (4 * 300, 4 * 300), 'white')
for i, k in enumerate(C):
    sheet.paste(Image.open(f'{OUT}/{k}.jpg').resize((300, 300)), ((i % 4) * 300, (i // 4) * 300))
sheet.save(f'{OUT}/_sheet.jpg', quality=85); print('ok')
