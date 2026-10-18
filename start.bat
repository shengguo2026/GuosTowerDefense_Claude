@echo off
rem Guo's Tower Defense: start the game.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed for this development build. Install the LTS version from https://nodejs.org and start again.
  pause
  exit /b 1
)
node tools\start.mjs
if errorlevel 1 pause
