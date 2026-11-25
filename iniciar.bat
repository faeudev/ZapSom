@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Instalando dependencias do ZapSom...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)

echo Iniciando ZapSom em http://127.0.0.1:5173 ...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:5173"
call npm run dev
