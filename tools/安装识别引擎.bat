@echo off
chcp 65001 >nul
title 安装截图识别引擎
cd /d "%~dp0.."

echo.
echo  正在为「Arwoo 财务助手」安装高精度截图识别引擎（RapidOCR）
echo  需要联网下载约 200MB，装好之后就完全离线使用了。
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo   [x] 没有找到 Python
  echo       请先到 https://www.python.org/downloads/ 安装 Python 3.10 或更高版本，
  echo       安装时记得勾选 "Add python.exe to PATH"，装好后重新运行本文件。
  echo.
  pause
  exit /b 1
)

if not exist "tools\ocr-env\Scripts\python.exe" (
  echo   正在创建独立运行环境...
  python -m venv "tools\ocr-env"
  if errorlevel 1 (
    echo   [x] 创建环境失败。
    pause
    exit /b 1
  )
)

echo   正在安装识别引擎，请耐心等几分钟...
"tools\ocr-env\Scripts\python.exe" -m pip install --upgrade pip
"tools\ocr-env\Scripts\python.exe" -m pip install rapidocr-onnxruntime
if errorlevel 1 (
  echo.
  echo   [x] 安装失败，请检查网络连接后重新运行本文件。
  echo.
  pause
  exit /b 1
)

echo.
echo   安装完成！现在双击「启动助手.bat」就能用高精度识别了。
echo.
pause
