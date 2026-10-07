@echo off
chcp 65001 >nul
title 开启手机访问
cd /d "%~dp0.."

net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo   需要用管理员权限放行防火墙，正在申请...
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo   正在放行 8787 端口（仅限家里的局域网，公网访问不到）...
netsh advfirewall firewall delete rule name="Arwoo 财务助手" >nul 2>nul
netsh advfirewall firewall add rule name="Arwoo 财务助手" dir=in action=allow protocol=TCP localport=8787 profile=private
if errorlevel 1 (
  echo.
  echo   [x] 放行失败。你可以手动在 Windows 防火墙里允许 Node.js 访问专用网络。
  echo.
  pause
  exit /b 1
)

echo.
echo   搞定了！以后手机连同一个 WiFi，用浏览器打开电脑的地址就行。
echo   具体网址和配对码在「设置 - 手机访问」里看。
echo.
pause
