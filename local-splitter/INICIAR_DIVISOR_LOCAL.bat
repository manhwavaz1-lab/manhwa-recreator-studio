@echo off
title Manhwa Studio - Divisor local
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python 3 nao encontrado. Instale Python 3.11 ou superior.
  pause
  exit /b 1
)
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo FFmpeg nao encontrado no PATH. Instale FFmpeg e reinicie o Windows.
  pause
  exit /b 1
)
py -m pip install --user fastapi "uvicorn[standard]" python-multipart
if errorlevel 1 (
  echo Falha ao instalar dependencias.
  pause
  exit /b 1
)
echo.
echo Divisor local ativo em http://127.0.0.1:8765
echo Mantenha esta janela aberta enquanto usa o Manhwa Studio.
py -m uvicorn local_video_splitter:app --host 127.0.0.1 --port 8765
pause
