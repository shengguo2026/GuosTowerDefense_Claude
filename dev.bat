@echo off
rem Guo's Tower Defense: developer mode with hot reload.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed. Install the LTS version from https://nodejs.org and start again.
  pause
  exit /b 1
)
if not exist node_modules call npm install
node tools\dev.mjs
