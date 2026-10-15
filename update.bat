@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Gemini Auto Image 최신 버전을 받는 중입니다...
echo.
git fetch origin claude/kind-einstein-59uhmk || goto fail
git checkout claude/kind-einstein-59uhmk || goto fail
git merge --ff-only origin/claude/kind-einstein-59uhmk || goto fail
echo.
echo 완료되었습니다.
echo 확장 프로그램 폴더: %~dp0gemini-auto-image
echo Chrome의 chrome://extensions 에서 Gemini Auto Image 카드의 새로고침 아이콘을 누르세요.
echo.
pause
exit /b 0
:fail
echo.
echo 업데이트에 실패했습니다. 이 창을 캡처해서 보내주세요.
pause
exit /b 1
