#!/bin/bash
# 나스닥발굴 - 바탕화면 바로 가기 만들기 (macOS / Linux)
# 사용법: 나스닥발굴.html 과 같은 폴더에 두고 더블클릭 (또는 bash 이 파일)

cd "$(dirname "$0")" || exit 1
SRC="나스닥발굴.html"

echo
echo "  ==============================================="
echo "   나스닥발굴 - 바탕화면 바로 가기 만들기"
echo "  ==============================================="
echo

if [ ! -f "$SRC" ]; then
  echo "  [오류] 이 파일과 같은 폴더에 \"$SRC\" 이 없습니다."
  echo "         두 파일을 같은 폴더에 둔 뒤 다시 실행하십시오."
  echo; read -r -p "  엔터를 누르면 닫힙니다..." _; exit 1
fi

# 바탕화면 폴더 찾기 (영문 Desktop / 한글 바탕화면 / XDG 설정)
DESK=""
for d in "$HOME/Desktop" "$HOME/바탕화면" "$HOME/데스크톱"; do
  [ -d "$d" ] && DESK="$d" && break
done
if [ -z "$DESK" ] && command -v xdg-user-dir >/dev/null 2>&1; then
  DESK="$(xdg-user-dir DESKTOP 2>/dev/null)"
fi
if [ -z "$DESK" ] || [ ! -d "$DESK" ]; then
  DESK="$HOME/Desktop"; mkdir -p "$DESK"
fi

APP_DIR="$HOME/.나스닥발굴"
mkdir -p "$APP_DIR"
cp -f "$SRC" "$APP_DIR/나스닥발굴.html" || { echo "  [오류] 파일 복사 실패"; read -r _; exit 1; }
TARGET="$APP_DIR/나스닥발굴.html"

case "$(uname -s)" in
  Darwin)
    # macOS: 심볼릭 링크 (더블클릭 시 기본 브라우저로 열림)
    ln -sfn "$TARGET" "$DESK/나스닥발굴.html"
    LINK="$DESK/나스닥발굴.html"
    ;;
  *)
    # Linux: .desktop 실행기
    LINK="$DESK/나스닥발굴.desktop"
    cat > "$LINK" <<DESKTOP
[Desktop Entry]
Type=Application
Name=나스닥발굴
Comment=글로벌 성장주 발굴 앱
Exec=xdg-open "$TARGET"
Icon=text-html
Terminal=false
Categories=Office;Finance;
DESKTOP
    chmod +x "$LINK"
    command -v gio >/dev/null 2>&1 && gio set "$LINK" metadata::trusted true 2>/dev/null
    ;;
esac

if [ -e "$LINK" ]; then
  echo "  완료!  바탕화면에 [나스닥발굴] 바로 가기를 만들었습니다."
  echo
  echo "   앱 파일   : $TARGET"
  echo "   바로 가기 : $LINK"
  echo
  echo "  바탕화면 아이콘을 더블클릭하면 기본 브라우저에서 열립니다."
  echo "  ※ 입력한 데이터는 브라우저에 저장되므로, 앱 안의"
  echo "     [설정] - [전체 데이터 내보내기]로 가끔 백업하십시오."
else
  echo "  [오류] 바로 가기 생성에 실패했습니다."
  echo "         아래 파일을 직접 열어 사용하십시오."
  echo "         $TARGET"
fi
echo
read -r -p "  엔터를 누르면 닫힙니다..." _
