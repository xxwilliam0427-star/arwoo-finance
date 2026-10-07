@echo off
chcp 65001 >nul
title Arwoo 财务助手
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [x] 没有找到 Node.js
  echo       请先到 https://nodejs.org 下载安装 Node.js，装好后重新双击本文件。
  echo.
  pause
  exit /b 1
)

echo.
echo  正在启动 Arwoo 财务助手，稍等一下，浏览器会自动打开...
echo.

node "%~dp0server.js"

echo.
echo  服务已停止，可以把窗口关掉了。
pause
