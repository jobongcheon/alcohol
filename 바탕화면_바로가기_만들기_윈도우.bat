@echo off
rem NASDAQ-GULBAL : create desktop shortcut (Windows)
rem Run this file by double-click. It calls the PowerShell installer next to it.
setlocal
if not exist "%~dp0install-shortcut.ps1" (
  echo [ERROR] install-shortcut.ps1 not found in this folder.
  echo Keep all three files together, then run again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-shortcut.ps1"
if errorlevel 1 pause
