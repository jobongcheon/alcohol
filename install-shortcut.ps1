$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

Write-Host ''
Write-Host '  ==============================================='
Write-Host '   나스닥발굴 - 바탕화면 바로 가기 만들기'
Write-Host '  ==============================================='
Write-Host ''

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src  = Join-Path $here '나스닥발굴.html'
if (-not (Test-Path -LiteralPath $src)) {
  $cand = Get-ChildItem -LiteralPath $here -Filter *.html -File | Select-Object -First 1
  if ($cand) { $src = $cand.FullName }
}
if (-not (Test-Path -LiteralPath $src)) {
  Write-Host '  [오류] 이 파일과 같은 폴더에 "나스닥발굴.html" 이 없습니다.' -ForegroundColor Red
  Write-Host '         세 파일을 같은 폴더에 둔 뒤 다시 실행하십시오.'
  Write-Host ''
  Read-Host '  엔터를 누르면 닫힙니다'
  exit 1
}

$desk = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrEmpty($desk)) { $desk = Join-Path $env:USERPROFILE 'Desktop' }

$appDir = Join-Path $env:LOCALAPPDATA '나스닥발굴'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
$target = Join-Path $appDir '나스닥발굴.html'
Copy-Item -LiteralPath $src -Destination $target -Force

$lnk = Join-Path $desk '나스닥발굴.lnk'
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath        = $target
$sc.WorkingDirectory  = $appDir
$sc.Description       = '나스닥발굴 - 글로벌 성장주 발굴 앱'
$sc.Save()

if (Test-Path -LiteralPath $lnk) {
  Write-Host '  완료!  바탕화면에 [나스닥발굴] 바로 가기를 만들었습니다.' -ForegroundColor Green
  Write-Host ''
  Write-Host "   앱 파일   : $target"
  Write-Host "   바로 가기 : $lnk"
  Write-Host ''
  Write-Host '  바탕화면 아이콘을 더블클릭하면 기본 브라우저에서 열립니다.'
  Write-Host '  ※ 입력한 데이터는 브라우저에 저장되므로, 앱 안의'
  Write-Host '     [설정] - [전체 데이터 내보내기]로 가끔 백업하십시오.'
} else {
  Write-Host '  [오류] 바로 가기 생성에 실패했습니다.' -ForegroundColor Red
  Write-Host "         아래 파일을 직접 열어 사용하십시오: $target"
}
Write-Host ''
Read-Host '  엔터를 누르면 닫힙니다'
