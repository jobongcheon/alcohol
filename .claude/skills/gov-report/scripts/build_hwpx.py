#!/usr/bin/env python3
"""보고서 마크업(.txt) → 한글 HWPX 변환기.

    python build_hwpx.py 입력.txt -o 결과.hwpx

마크업 문법은 ../SKILL.md 의 '마크업 문법' 절을 참고한다.
필요 패키지: lxml  (pip install lxml)
"""

from __future__ import annotations

import argparse
import copy
import math
import re
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

try:
    from lxml import etree
except ImportError:
    sys.exit("lxml 패키지가 필요합니다:  pip install lxml")

SKELETON = Path(__file__).resolve().parent.parent / "assets" / "Skeleton.hwpx"

HH = "http://www.hancom.co.kr/hwpml/2011/head"
HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
HC = "http://www.hancom.co.kr/hwpml/2011/core"
OPF = "http://www.idpf.org/2007/opf/"

FONT_HEAD = "HY헤드라인M"
FONT_BODY = "휴먼명조"
FONT_GOTHIC = "중고딕"
FONT_TYPES = {FONT_HEAD: "TTF", FONT_BODY: "HFT", FONT_GOTHIC: "HFT"}

MM = 283.465  # HWPUNIT / mm  (1pt = 100 HWPUNIT)
PAGE_W = 59528
MARGIN_LR = round(20 * MM)
MARGIN_TB = round(15 * MM)
MARGIN_HF = round(10 * MM)
TEXT_W = PAGE_W - 2 * MARGIN_LR

LINE_SPACING = 160
TABLE_FONT_SIZE = 13
LEVEL_STEP = 1000  # 한 단계 들여쓰기 (≈ 휴먼명조 15p 기준 한 칸 반)

ROMANS = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ"
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"

META_KEYS = ("제목", "날짜", "부서", "개요", "표지", "표지장소", "표지일시", "표지일자", "표지기관")


def q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def text_width(s: str, size: float, half: float = 0.5) -> int:
    """글자 폭 근사치(HWPUNIT). 한글·전각 = 1em, 영문·숫자·공백 = half em."""
    em = size * 100
    return int(sum(em if ord(ch) > 0x2000 else em * half for ch in s))


# ─────────────────────────────── header.xml ────────────────────────────────


class Header:
    """글꼴·글자모양·문단모양·테두리를 필요할 때마다 등록하고 ID를 돌려준다."""

    def __init__(self, root):
        self.root = root
        ref = root.find(q(HH, "refList"))
        self.fontfaces = ref.find(q(HH, "fontfaces"))
        self.char_props = ref.find(q(HH, "charProperties"))
        self.para_props = ref.find(q(HH, "paraProperties"))
        self.border_fills = ref.find(q(HH, "borderFills"))
        self._char_tpl = copy.deepcopy(self.char_props[0])
        self._para_tpl = copy.deepcopy(self.para_props[0])
        self._cache: dict[tuple, int] = {}
        self.font_ids = {face: self._add_font(face) for face in FONT_TYPES}

    def _add_font(self, face: str) -> int:
        fid = 0
        for fontface in self.fontfaces:
            fonts = fontface.findall(q(HH, "font"))
            fid = len(fonts)
            font = copy.deepcopy(fonts[0])
            font.set("id", str(fid))
            font.set("face", face)
            font.set("type", FONT_TYPES[face])
            fonts[-1].addnext(font)
            fontface.set("fontCnt", str(fid + 1))
        return fid

    def char(self, font: str, size: float, bold: bool = False,
             color: str = "#000000", shade: str = "none") -> int:
        key = ("char", font, size, bold, color, shade)
        if key in self._cache:
            return self._cache[key]
        cp = copy.deepcopy(self._char_tpl)
        cid = len(self.char_props)
        cp.set("id", str(cid))
        cp.set("height", str(int(size * 100)))
        cp.set("textColor", color)
        cp.set("shadeColor", shade)
        font_ref = cp.find(q(HH, "fontRef"))
        for attr in list(font_ref.attrib):
            font_ref.set(attr, str(self.font_ids[font]))
        for tag in ("italic", "bold"):
            for el in cp.findall(q(HH, tag)):
                cp.remove(el)
        if bold:
            cp.find(q(HH, "offset")).addnext(etree.Element(q(HH, "bold"), nsmap=self.root.nsmap))
        self.char_props.append(cp)
        self._cache[key] = cid
        return cid

    def para(self, align: str = "JUSTIFY", left: int = 0, indent: int = 0, prev: int = 0,
             next_: int = 0, line: int = LINE_SPACING, border: int | None = None,
             keep_next: bool = False) -> int:
        key = ("para", align, left, indent, prev, next_, line, border, keep_next)
        if key in self._cache:
            return self._cache[key]
        pp = copy.deepcopy(self._para_tpl)
        pid = len(self.para_props)
        pp.set("id", str(pid))
        pp.find(q(HH, "align")).set("horizontal", align)
        if keep_next:
            pp.find(q(HH, "breakSetting")).set("keepWithNext", "1")
        switch = pp.find(q(HP, "switch"))
        # case(HwpUnitChar) 는 실제 값, default 는 구버전 호환용으로 2배 값을 쓴다.
        for block, mul in ((switch.find(q(HP, "case")), 1), (switch.find(q(HP, "default")), 2)):
            margin = block.find(q(HH, "margin"))
            for name, value in (("intent", indent), ("left", left), ("right", 0),
                                ("prev", prev), ("next", next_)):
                margin.find(q(HC, name)).set("value", str(int(value * mul)))
            block.find(q(HH, "lineSpacing")).set("value", str(line))
        if border is not None:
            pp.find(q(HH, "border")).set("borderFillIDRef", str(border))
        self.para_props.append(pp)
        self._cache[key] = pid
        return pid

    def border(self, left=("NONE", "0.1 mm", "#000000"), right=("NONE", "0.1 mm", "#000000"),
               top=("NONE", "0.1 mm", "#000000"), bottom=("NONE", "0.1 mm", "#000000"),
               fill: str = "none") -> int:
        key = ("border", left, right, top, bottom, fill)
        if key in self._cache:
            return self._cache[key]
        bid = len(self.border_fills) + 1
        bf = etree.SubElement(self.border_fills, q(HH, "borderFill"), id=str(bid), threeD="0",
                              shadow="0", centerLine="NONE", breakCellSeparateLine="0")
        etree.SubElement(bf, q(HH, "slash"), type="NONE", Crooked="0", isCounter="0")
        etree.SubElement(bf, q(HH, "backSlash"), type="NONE", Crooked="0", isCounter="0")
        for name, (kind, width, color) in (("leftBorder", left), ("rightBorder", right),
                                           ("topBorder", top), ("bottomBorder", bottom)):
            etree.SubElement(bf, q(HH, name), type=kind, width=width, color=color)
        etree.SubElement(bf, q(HH, "diagonal"), type="SOLID", width="0.1 mm", color="#000000")
        if fill != "none":
            brush = etree.SubElement(bf, q(HC, "fillBrush"))
            etree.SubElement(brush, q(HC, "winBrush"), faceColor=fill, hatchColor="#999999", alpha="0")
        self._cache[key] = bid
        return bid

    def finalize(self):
        for lst in (self.char_props, self.para_props, self.border_fills):
            lst.set("itemCnt", str(len(lst)))


# ─────────────────────────────── section0.xml ──────────────────────────────


@dataclass
class Cell:
    text: str
    row: int
    col: int
    rowspan: int = 1
    colspan: int = 1


class Body:
    def __init__(self, header: Header, nsmap: dict):
        self.h = header
        self.nsmap = nsmap
        self.paras: list = []
        self._next_id = 1_000_000
        self._page_break = False
        self.plain_text: list[str] = []

    def _id(self) -> str:
        self._next_id += 1
        return str(self._next_id)

    def _el(self, tag: str, parent=None, **attrs):
        if parent is None:
            return etree.Element(tag, {k: str(v) for k, v in attrs.items()}, nsmap=self.nsmap)
        return etree.SubElement(parent, tag, {k: str(v) for k, v in attrs.items()})

    def runs(self, text: str, font: str, size: float, bold: bool = False, **style):
        """'**굵게**' 표기를 굵은 글자 run 으로 분리한다."""
        out = []
        for i, chunk in enumerate(text.split("**")):
            if chunk:
                out.append((self.h.char(font, size, bold or i % 2 == 1, **style), chunk))
        return out or [(self.h.char(font, size, bold, **style), "")]

    def _paragraph(self, para_id: int, runs, parent=None, page_break: bool = False):
        p = self._el(q(HP, "p"), parent, id=self._id(), paraPrIDRef=para_id, styleIDRef=0,
                     pageBreak=int(page_break), columnBreak=0, merged=0)
        for char_id, text in runs:
            run = self._el(q(HP, "run"), p, charPrIDRef=char_id)
            self._el(q(HP, "t"), run).text = text
        return p

    def add(self, para_id: int, runs):
        p = self._paragraph(para_id, runs, page_break=self._page_break)
        self._page_break = False
        self.paras.append(p)
        self.plain_text.append("".join(t for _, t in runs))
        return p

    def page_break(self):
        self._page_break = True

    def blank(self, count: int = 1, size: float = 15):
        for _ in range(count):
            self.add(self.h.para(line=100), [(self.h.char(FONT_BODY, size), "")])

    # ── 표 ──

    def table(self, rows: list[list[str]], *, widths: list[int] | None = None,
              cell_border=None, header_rows: int = 1, header_fill: str = "#D9D9D9",
              font: str = FONT_BODY, size: float = TABLE_FONT_SIZE, header_font: str | None = None,
              align: str | None = None, para_align: str = "CENTER", prev: int = 300,
              next_: int = 300, cell_margin: tuple[int, int] = (300, 141), line: int = 130,
              min_row_h: int | None = None):
        ncols = max(len(r) for r in rows)
        rows = [r + [""] * (ncols - len(r)) for r in rows]
        cells = self._merge(rows)
        if widths is None:
            widths = self._auto_widths(rows, cells, size)
        if cell_border is None:
            thin = ("SOLID", "0.12 mm", "#000000")
            cell_border = {"body": self.h.border(thin, thin, thin, thin),
                           "head": self.h.border(thin, thin, thin, thin, fill=header_fill)}
        elif isinstance(cell_border, int):
            cell_border = {"body": cell_border, "head": cell_border}

        mx, my = cell_margin
        base_h = min_row_h or int(size * 100 * line / 100 + 2 * my + 200)
        row_heights = []
        for r, row in enumerate(rows):
            h = base_h
            for cell in cells:
                if cell.row == r and cell.rowspan == 1:
                    w = sum(widths[cell.col:cell.col + cell.colspan]) - 2 * mx
                    lines = sum(max(1, math.ceil(text_width(part.replace("**", ""), size) / max(w, 1)))
                                for part in cell.text.split("<br>"))
                    h = max(h, int(lines * size * 100 * line / 100 + 2 * my + 200))
            row_heights.append(h)

        holder = self.add(self.h.para(align=para_align, prev=prev, next_=next_, line=100), [])
        run = self._el(q(HP, "run"), holder, charPrIDRef=self.h.char(font, size))
        tbl = self._el(q(HP, "tbl"), run, id=self._id(), zOrder=0, numberingType="TABLE",
                       textWrap="TOP_AND_BOTTOM", textFlow="BOTH_SIDES", lock=0, dropcapstyle="None",
                       pageBreak="CELL", repeatHeader=1 if header_rows else 0, rowCnt=len(rows),
                       colCnt=ncols, cellSpacing=0, borderFillIDRef=cell_border["body"], noAdjust=0)
        self._el(q(HP, "sz"), tbl, width=sum(widths), widthRelTo="ABSOLUTE",
                 height=sum(row_heights), heightRelTo="ABSOLUTE", protect=0)
        self._el(q(HP, "pos"), tbl, treatAsChar=1, affectLSpacing=0, flowWithText=1, allowOverlap=0,
                 holdAnchorAndSO=0, vertRelTo="PARA", horzRelTo="COLUMN", vertAlign="TOP",
                 horzAlign="LEFT", vertOffset=0, horzOffset=0)
        self._el(q(HP, "outMargin"), tbl, left=0, right=0, top=0, bottom=0)
        self._el(q(HP, "inMargin"), tbl, left=mx, right=mx, top=my, bottom=my)

        for r in range(len(rows)):
            tr = self._el(q(HP, "tr"), tbl)
            for cell in (c for c in cells if c.row == r):
                is_head = r < header_rows
                tc = self._el(q(HP, "tc"), tr, name="", header=int(is_head), hasMargin=0, protect=0,
                              editable=0, dirty=0,
                              borderFillIDRef=cell_border["head" if is_head else "body"])
                sub = self._el(q(HP, "subList"), tc, id="", textDirection="HORIZONTAL", lineWrap="BREAK",
                               vertAlign="CENTER", linkListIDRef=0, linkListNextIDRef=0, textWidth=0,
                               textHeight=0, hasTextRef=0, hasNumRef=0)
                text = cell.text.strip()
                cell_align = align or ("CENTER" if is_head or text_width(text, size) < 9000 else "JUSTIFY")
                pid = self.h.para(align=cell_align, line=line)
                cfont = (header_font or font) if is_head else font
                for part in text.split("<br>"):
                    self._paragraph(pid, self.runs(part.strip(), cfont, size, bold=is_head and header_rows > 0
                                                   and header_fill != "none"), parent=sub)
                self._el(q(HP, "cellAddr"), tc, colAddr=cell.col, rowAddr=cell.row)
                self._el(q(HP, "cellSpan"), tc, colSpan=cell.colspan, rowSpan=cell.rowspan)
                self._el(q(HP, "cellSz"), tc, width=sum(widths[cell.col:cell.col + cell.colspan]),
                         height=sum(row_heights[cell.row:cell.row + cell.rowspan]))
                self._el(q(HP, "cellMargin"), tc, left=mx, right=mx, top=my, bottom=my)
        self.plain_text.extend(" | ".join(r) for r in rows)
        return holder

    @staticmethod
    def _merge(rows: list[list[str]]) -> list[Cell]:
        """셀 내용이 '<' 이면 왼쪽 셀과, '^' 이면 위쪽 셀과 병합한다."""
        owner: dict[tuple[int, int], tuple[int, int]] = {}
        for r, row in enumerate(rows):
            for c, text in enumerate(row):
                t = text.strip()
                if t == "<" and c > 0:
                    owner[(r, c)] = owner[(r, c - 1)]
                elif t == "^" and r > 0:
                    owner[(r, c)] = owner[(r - 1, c)]
                else:
                    owner[(r, c)] = (r, c)
        cells = []
        for (r, c), o in owner.items():
            if o != (r, c):
                continue
            covered = [k for k, v in owner.items() if v == o]
            cells.append(Cell(rows[r][c], r, c,
                              rowspan=max(k[0] for k in covered) - r + 1,
                              colspan=max(k[1] for k in covered) - c + 1))
        return sorted(cells, key=lambda x: (x.row, x.col))

    @staticmethod
    def _auto_widths(rows, cells, size) -> list[int]:
        ncols = len(rows[0])
        natural = [text_width("가가가", size)] * ncols
        for cell in cells:
            if cell.colspan == 1:
                longest = max(text_width(p.replace("**", "").strip(), size, half=0.6)
                              for p in cell.text.split("<br>"))
                natural[cell.col] = max(natural[cell.col], longest + 1600)
        cap = TEXT_W * 0.6
        natural = [min(w, cap) for w in natural]
        scale = TEXT_W / sum(natural)
        widths = [int(w * scale) for w in natural]
        widths[-1] += TEXT_W - sum(widths)
        return widths

    def box(self, lines: list[str], border: int, *, font: str, size: float, align: str = "JUSTIFY",
            bold: bool = False, width: int = TEXT_W, margin: tuple[int, int] = (700, 400),
            para_align: str = "CENTER", prev: int = 0, next_: int = 0, **style):
        """글상자(1×1 표). 제목 상자·개요 상자·표지에 사용."""
        holder = self.table([["<br>".join(lines)]], widths=[width], cell_border=border, header_rows=0,
                            font=font, size=size, align=align, para_align=para_align, prev=prev,
                            next_=next_, cell_margin=margin, line=LINE_SPACING if size < 20 else 130)
        if bold or style:
            for run in holder.iter(q(HP, "run")):
                if run.find(q(HP, "t")) is not None:
                    run.set("charPrIDRef", str(self.h.char(font, size, bold, **style)))
        return holder


# ─────────────────────────────── 마크업 해석 ───────────────────────────────

ANNOTATION = re.compile(
    r"\s*\((?=[^()]*(?:HY헤드라인|휴먼명조|중고딕|\d+\s*p\b|볼드|굵게|핵심))[^()]*\)\s*$")

LEVELS = {
    # kind: (글꼴, 크기, 기본 들여쓰기, 문단 위, 문단 아래)
    "roman": (FONT_HEAD, 16, 0, 2500, 500),
    "box":   (FONT_HEAD, 16, 0, 2000, 500),
    "L2":    (FONT_BODY, 15, LEVEL_STEP, 800, 0),
    "L3":    (FONT_BODY, 15, LEVEL_STEP * 2, 500, 0),
    "L4":    (FONT_BODY, 15, LEVEL_STEP * 3, 300, 0),
    "L5":    (FONT_BODY, 15, LEVEL_STEP * 4, 300, 0),
    "body":  (FONT_BODY, 15, 0, 500, 0),
}

PATTERNS = [
    ("shaded", re.compile(rf"^\[([{ROMANS}])\]\s*(.*)$")),
    ("roman", re.compile(rf"^([{ROMANS}]\s*[.．])\s*(.*)$")),
    ("box", re.compile(r"^(□)\s*(.*)$")),
    ("L2", re.compile(r"^([○ㅇ◦◈]|o(?=\s))\s*(.*)$")),
    ("L2", re.compile(r"^(\d{1,2}\.)(?!\d)\s*(.*)$")),
    ("L3", re.compile(r"^(\d{1,2}\))\s*(.*)$")),
    ("L3", re.compile(r"^([-―–]|☞|⇒|→)\s*(.*)$")),
    ("L4", re.compile(rf"^([{CIRCLED}]|[·∙•ㆍ])\s*(.*)$")),
    ("L5", re.compile(r"^((?:i|ii|iii|iv|v|vi|vii|viii|ix|x)\))\s*(.*)$")),
    ("note", re.compile(r"^(※|\*(?!\*))\s*(.*)$")),
]


def clean(line: str) -> str:
    line = line.rstrip()
    while True:
        stripped = ANNOTATION.sub("", line)
        if stripped == line:
            return line
        line = stripped


def parse(text: str):
    meta: dict[str, str] = {}
    body: list[str] = []
    in_header = True
    for raw in text.splitlines():
        line = clean(raw)
        s = line.strip()
        if s.startswith("(※ 표 내부 글꼴"):
            continue
        if in_header:
            m = re.match(rf"^({'|'.join(META_KEYS)})\s*[:：]\s*(.*)$", s)
            if m:
                meta[m.group(1)] = m.group(2).strip()
                continue
            m = re.match(r"^\[\s*문서\s*제목\s*[:：]\s*(.*?)\s*\]$", s)
            if m:
                meta["제목"] = m.group(1)
                continue
            if re.match(r"^<\s*'?\d{2,4}\s*\..*>$", s):
                meta["날짜줄"] = s
                continue
            if not s or s == "---":
                continue
            in_header = False
        body.append(line)
    return meta, body


def render(meta: dict[str, str], body_lines: list[str], doc: Body):
    h = doc.h
    has_cover = any(k in meta for k in ("표지", "표지장소", "표지일시", "표지일자", "표지기관"))
    thick = ("SOLID", "0.4 mm", "#000000")
    none = ("NONE", "0.1 mm", "#000000")

    if has_cover:
        info = [x for x in (meta.get("표지장소"), meta.get("표지일시")) if x]
        if info:
            doc.table([[x] for x in info], widths=[18000], cell_border=h.border(thick, thick, thick, thick),
                      header_rows=0, font=FONT_GOTHIC, size=12, align="LEFT", para_align="LEFT", prev=0)
            for run in doc.paras[-1].iter(q(HP, "run")):
                if run.find(q(HP, "t")) is not None:
                    run.set("charPrIDRef", str(h.char(FONT_GOTHIC, 12, True)))
        doc.blank(7)
        band = ("SOLID", "3.0 mm", "#7F7F7F")
        doc.box([meta.get("제목", "")], h.border(none, none, band, band), font=FONT_HEAD, size=26,
                align="CENTER", margin=(500, 1800))
        doc.blank(8)
        cover_date = meta.get("표지일자") or meta.get("날짜", "")
        doc.add(h.para(align="CENTER"), doc.runs(cover_date, FONT_BODY, 20, bold=True))
        doc.blank(6)
        doc.add(h.para(align="CENTER"), doc.runs(meta.get("표지기관") or meta.get("부서", ""), FONT_HEAD, 18))
        doc.page_break()
    elif meta.get("제목"):
        bar = ("SOLID", "1.0 mm", "#7F7F7F")
        doc.box([meta["제목"]], h.border(thick, thick, bar, thick), font=FONT_HEAD, size=22,
                align="CENTER", margin=(700, 700), next_=200)
        dateline = meta.get("날짜줄")
        if not dateline and (meta.get("날짜") or meta.get("부서")):
            dateline = "< " + ", ".join(x for x in (meta.get("날짜"), meta.get("부서")) if x) + " >"
        if dateline:
            doc.add(h.para(align="RIGHT", prev=200, next_=600), doc.runs(dateline, FONT_GOTHIC, 13))

    if meta.get("개요"):
        dash = ("DASH", "0.12 mm", "#000000")
        doc.box(meta["개요"].split("<br>"), h.border(dash, dash, dash, dash, fill="#F2F2F2"),
                font=FONT_GOTHIC, size=15, margin=(700, 400), prev=200, next_=400)

    last_text_left = LEVEL_STEP * 2
    table_buf: list[list[str]] = []

    def flush_table():
        if not table_buf:
            return
        rows = [r for r in table_buf if not all(re.fullmatch(r"\s*:?-{2,}:?\s*", c) for c in r)]
        if len(rows) == 1:
            doc.table(rows, header_rows=0, align="CENTER")
        elif rows:
            doc.table(rows)
        table_buf.clear()

    for line in body_lines:
        s = line.strip()
        if s.startswith("|"):
            table_buf.append([c.strip() for c in s.strip("|").split("|")])
            continue
        flush_table()
        if not s:
            continue
        if s in ("===", "[쪽나눔]"):
            doc.page_break()
            continue

        if re.match(r"^[《\[<].*[》\]>]$", s) and not re.match(rf"^\[[{ROMANS}]\]", s):
            doc.add(h.para(align="CENTER", prev=600, next_=0, keep_next=True),
                    doc.runs(s, FONT_BODY, 14, bold=True))
            continue
        if s.startswith("(단위"):
            doc.add(h.para(align="RIGHT", prev=300, keep_next=True), doc.runs(s, FONT_BODY, 12))
            continue

        kind, symbol, content = "body", "", s
        for name, pat in PATTERNS:
            m = pat.match(s)
            if m:
                kind, symbol, content = name, m.group(1), m.group(2)
                break

        if kind == "shaded":
            doc.add(h.para(prev=2500, next_=500, keep_next=True),
                    [(h.char(FONT_HEAD, 16, color="#FFFFFF", shade="#404040"), f" {symbol} ")]
                    + doc.runs("  " + content, FONT_HEAD, 16))
            last_text_left = LEVEL_STEP
            continue

        if kind == "note":
            prefix = "※ "
            hang = text_width(prefix, 13)
            left = last_text_left
            doc.add(h.para(left=left + hang, indent=-hang, prev=300),
                    doc.runs(prefix + content, FONT_GOTHIC, 13))
            continue

        font, size, base, prev, nxt = LEVELS[kind]
        prefix = f"{symbol} " if symbol else ""
        hang = text_width(prefix, size)
        border = None
        if kind == "roman":
            border = h.border(bottom=("SOLID", "0.5 mm", "#000000"))
        doc.add(h.para(left=base + hang, indent=-hang, prev=prev, next_=nxt, border=border,
                       keep_next=kind in ("roman", "box")),
                doc.runs(prefix + content, font, size))
        last_text_left = base + hang
    flush_table()


# ─────────────────────────────── 패키징 ────────────────────────────────────


def build(markup: str, output: Path) -> Path:
    meta, body_lines = parse(markup)
    with zipfile.ZipFile(SKELETON) as src:
        entries = [(info, src.read(info.filename)) for info in src.infolist()]
    files = {info.filename: data for info, data in entries}

    header_root = etree.fromstring(files["Contents/header.xml"])
    section_root = etree.fromstring(files["Contents/section0.xml"])
    header = Header(header_root)
    doc = Body(header, section_root.nsmap)
    render(meta, body_lines, doc)
    if not doc.paras:
        raise ValueError("본문이 비어 있습니다.")

    first_skeleton_p = section_root.find(q(HP, "p"))
    sec_runs = [r for r in first_skeleton_p.findall(q(HP, "run"))
                if r.find(q(HP, "secPr")) is not None or r.find(q(HP, "ctrl")) is not None]
    sec_run = sec_runs[0]
    margin = sec_run.find(f".//{q(HP, 'margin')}")
    for name, value in (("header", MARGIN_HF), ("footer", MARGIN_HF), ("left", MARGIN_LR),
                        ("right", MARGIN_LR), ("top", MARGIN_TB), ("bottom", MARGIN_TB)):
        margin.set(name, str(value))
    page_ctrl = etree.SubElement(sec_run, q(HP, "ctrl"))
    etree.SubElement(page_ctrl, q(HP, "pageNum"), pos="BOTTOM_CENTER", formatType="DIGIT", sideChar="-")

    for child in list(section_root):
        section_root.remove(child)
    first = doc.paras[0]
    first.insert(0, sec_run)
    for p in doc.paras:
        section_root.append(p)

    header.finalize()

    def dump(root) -> bytes:
        return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

    files["Contents/header.xml"] = dump(header_root)
    files["Contents/section0.xml"] = dump(section_root)

    hpf = etree.fromstring(files["Contents/content.hpf"])
    title_el = hpf.find(f".//{q(OPF, 'title')}")
    if title_el is not None:
        title_el.text = meta.get("제목", "")
    files["Contents/content.hpf"] = dump(hpf)
    files["Preview/PrvText.txt"] = "\r\n".join(doc.plain_text)[:1024].encode("utf-8")

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w") as dst:
        dst.writestr(zipfile.ZipInfo("mimetype"), files["mimetype"], compress_type=zipfile.ZIP_STORED)
        for info, _ in entries:
            if info.filename != "mimetype":
                dst.writestr(info.filename, files[info.filename], compress_type=zipfile.ZIP_DEFLATED)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="보고서 마크업 → HWPX 변환")
    parser.add_argument("input", help="마크업 텍스트 파일 (- 이면 표준입력)")
    parser.add_argument("-o", "--output", help="출력 .hwpx 경로 (기본: 입력파일명.hwpx)")
    args = parser.parse_args()

    if args.input == "-":
        markup = sys.stdin.read()
        output = Path(args.output or "보고서.hwpx")
    else:
        src = Path(args.input)
        markup = src.read_text(encoding="utf-8-sig")
        output = Path(args.output) if args.output else src.with_suffix(".hwpx")
    print(f"생성 완료: {build(markup, output)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
