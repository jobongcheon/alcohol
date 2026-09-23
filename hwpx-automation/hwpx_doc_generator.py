#!/usr/bin/env python3
"""한글(HWPX) 템플릿 기반 문서 자동 생성기.

사용법
------
1. 한글(HWP) 프로그램에서 {{이름}}, {{날짜}} 처럼 플레이스홀더가 들어간
   양식을 작성한 뒤 '다른 이름으로 저장 > HWPX' 로 저장합니다.
2. 이 스크립트에 템플릿 파일과 채워 넣을 값을 전달하면, 플레이스홀더가
   실제 값으로 치환된 새 HWPX 파일이 생성됩니다.

예시
----
    # 값을 커맨드라인에서 바로 지정
    python hwpx_doc_generator.py \\
        --template 양식.hwpx --output 결과.hwpx \\
        --set 이름=홍길동 --set 날짜=2026-09-23

    # 값을 JSON 파일로 지정 (예: data.json -> {"이름": "홍길동", "날짜": "2026-09-23"})
    python hwpx_doc_generator.py \\
        --template 양식.hwpx --output 결과.hwpx --data data.json

    # 여러 건을 한 번에 생성 (JSON 배열, 예: rows.json -> [{"이름": "..."}, {"이름": "..."}])
    # --output 결과.hwpx 를 넘기면 결과_1.hwpx, 결과_2.hwpx ... 로 생성됩니다.
    python hwpx_doc_generator.py \\
        --template 양식.hwpx --output 결과.hwpx --data-list rows.json

주의
----
플레이스홀더는 서식(굵게/색상 등)이 중간에 끼지 않도록 한 번에 이어서
입력해야 합니다. 한글 편집기가 텍스트를 여러 조각으로 나눠 저장하면
({{ 와 이름 과 }} 가 서로 다른 조각) 치환이 되지 않을 수 있습니다.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape

PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")
SECTION_FILE_PATTERN = re.compile(r"^Contents/section\d+\.xml$")


def find_section_names(names: Iterable[str]) -> list[str]:
    sections = [n for n in names if SECTION_FILE_PATTERN.match(n)]
    if not sections:
        raise ValueError(
            "템플릿 안에서 Contents/section*.xml 을 찾지 못했습니다. "
            "올바른 HWPX 파일인지 확인하세요."
        )
    return sorted(sections)


def substitute(xml_text: str, data: dict[str, str]) -> tuple[str, set[str], set[str]]:
    """xml_text 안의 {{키}} 를 data[키] 값(XML 이스케이프 처리)으로 치환한다.

    반환값: (치환된 텍스트, 실제로 치환에 사용된 키 집합, 값이 없어 남은 키 집합)
    """
    used: set[str] = set()
    missing: set[str] = set()

    def replace(match: re.Match) -> str:
        key = match.group(1)
        if key in data:
            used.add(key)
            return escape(str(data[key]))
        missing.add(key)
        return match.group(0)

    return PLACEHOLDER_PATTERN.sub(replace, xml_text), used, missing


def render(template_path: Path, output_path: Path, data: dict[str, str]) -> None:
    with zipfile.ZipFile(template_path, "r") as src:
        names = src.namelist()
        section_names = find_section_names(names)

        used_keys: set[str] = set()
        missing_keys: set[str] = set()

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output_path, "w") as dst:
            for item in src.infolist():
                raw = src.read(item.filename)
                if item.filename in section_names:
                    text = raw.decode("utf-8")
                    text, used, missing = substitute(text, data)
                    used_keys |= used
                    missing_keys |= missing
                    raw = text.encode("utf-8")
                dst.writestr(item, raw)

    unused_keys = set(data.keys()) - used_keys
    if missing_keys:
        print(
            f"[경고] 값이 없어 치환되지 않은 플레이스홀더: {sorted(missing_keys)}",
            file=sys.stderr,
        )
    if unused_keys:
        print(
            f"[경고] 템플릿에서 사용되지 않은 값(오타 확인): {sorted(unused_keys)}",
            file=sys.stderr,
        )
    print(f"생성 완료: {output_path}")


def numbered_output(output_path: Path, index: int) -> Path:
    return output_path.with_name(f"{output_path.stem}_{index}{output_path.suffix}")


def parse_set_args(pairs: list[str]) -> dict[str, str]:
    data = {}
    for pair in pairs:
        if "=" not in pair:
            raise ValueError(f"--set 값은 KEY=VALUE 형식이어야 합니다: {pair!r}")
        key, value = pair.split("=", 1)
        data[key.strip()] = value
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--template", required=True, type=Path, help="플레이스홀더가 포함된 원본 .hwpx 템플릿")
    parser.add_argument("--output", required=True, type=Path, help="생성할 .hwpx 파일 경로")
    parser.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="플레이스홀더 값 직접 지정 (여러 번 사용 가능)")
    parser.add_argument("--data", type=Path, help="플레이스홀더 값을 담은 JSON 객체 파일")
    parser.add_argument("--data-list", type=Path, help="여러 건을 한 번에 생성할 JSON 배열 파일")
    args = parser.parse_args()

    if not args.template.exists():
        parser.error(f"템플릿 파일을 찾을 수 없습니다: {args.template}")
    if args.data and args.data_list:
        parser.error("--data 와 --data-list 는 동시에 사용할 수 없습니다.")

    cli_data = parse_set_args(args.set)

    if args.data_list:
        rows = json.loads(args.data_list.read_text(encoding="utf-8"))
        if not isinstance(rows, list):
            parser.error("--data-list 파일은 JSON 배열이어야 합니다.")
        for i, row in enumerate(rows, start=1):
            merged = {**cli_data, **row}
            render(args.template, numbered_output(args.output, i), merged)
        return 0

    file_data = {}
    if args.data:
        file_data = json.loads(args.data.read_text(encoding="utf-8"))
        if not isinstance(file_data, dict):
            parser.error("--data 파일은 JSON 객체여야 합니다.")

    merged = {**file_data, **cli_data}
    if not merged:
        parser.error("--set, --data, --data-list 중 하나로 값을 지정해야 합니다.")

    render(args.template, args.output, merged)
    return 0


if __name__ == "__main__":
    sys.exit(main())
