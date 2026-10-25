@echo off
title Muse AI Studio Desktop
cd /d "%~dp0"
echo ========================================================
echo   KHOI DONG MUSE AI STUDIO (RUST + TAURI 2.0 NATIVE)
echo ========================================================
echo.
echo Dang khoi dong ung dung...
start "" "%~dp0..\sprakcut\src-tauri\target\release\muse-desktop.exe"
exit
