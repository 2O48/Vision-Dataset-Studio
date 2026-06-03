@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "BASE_DIR=%CD%"
set "REQ_DIR=%BASE_DIR%\requirements"
set "PYTHON_INSTALLER_DIR=%REQ_DIR%\python"
set "WHL_DIR=%REQ_DIR%\whl"
set "BASE_REQ=%REQ_DIR%\base.txt"
set "OFFLINE_BASE_REQ=%REQ_DIR%\offline-base.txt"
set "QWEN_REQ=%REQ_DIR%\qwen-offline-cu124-py312-win64.txt"
set "VENV_DIR=%BASE_DIR%\.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "BOOTSTRAP_PY="

echo.
echo [offline] Vision Dataset Studio offline installer
echo [offline] Project: %BASE_DIR%
echo.

if not exist "%REQ_DIR%" (
  echo [offline:error] requirements directory not found: %REQ_DIR%
  exit /b 1
)

if not exist "%WHL_DIR%" (
  echo [offline:error] wheel directory not found: %WHL_DIR%
  exit /b 1
)

if not exist "%BASE_REQ%" (
  echo [offline:error] base requirements not found: %BASE_REQ%
  exit /b 1
)

if not exist "%OFFLINE_BASE_REQ%" (
  echo [offline:error] offline base requirements not found: %OFFLINE_BASE_REQ%
  exit /b 1
)

if not exist "%QWEN_REQ%" (
  echo [offline:error] Qwen offline requirements not found: %QWEN_REQ%
  exit /b 1
)

if exist "%VENV_PY%" (
  call :check_python "%VENV_PY%"
  if errorlevel 1 (
    echo [offline:error] Existing .venv is not Python 3.12 or is missing venv/ensurepip support.
    echo [offline:error] Please rename or remove "%VENV_DIR%" and run this script again.
    exit /b 1
  )
  set "BOOTSTRAP_PY=%VENV_PY%"
) else (
  call :find_python
  if errorlevel 1 (
    call :install_python
    if errorlevel 1 exit /b 1
    call :find_python
    if errorlevel 1 (
      echo [offline:error] Python 3.12 still was not found after running the offline installer.
      echo [offline:error] Try opening a new Command Prompt, or install requirements\python\python-3.12.x-amd64.exe manually.
      exit /b 1
    )
  )

  echo [offline] Creating virtual environment: %VENV_DIR%
  !BOOTSTRAP_PY! -m venv "%VENV_DIR%"
  if errorlevel 1 (
    echo [offline:warn] python -m venv failed. Trying virtualenv from local wheels.
    !BOOTSTRAP_PY! -m pip install --no-index --find-links "%WHL_DIR%" virtualenv
    if errorlevel 1 (
      echo [offline:error] Failed to install virtualenv from local wheels.
      exit /b 1
    )
    !BOOTSTRAP_PY! -m virtualenv "%VENV_DIR%"
    if errorlevel 1 (
      echo [offline:error] Failed to create .venv with virtualenv.
      exit /b 1
    )
  )

  if not exist "%VENV_PY%" (
    echo [offline:error] Virtual environment Python was not created: %VENV_PY%
    exit /b 1
  )
)

:venv_ready
echo [offline] Using virtual environment Python: %VENV_PY%

"%VENV_PY%" -m ensurepip --upgrade >nul 2>nul

echo [offline] Installing offline bootstrap tools...
"%VENV_PY%" -m pip install --no-index --find-links "%WHL_DIR%" --upgrade pip setuptools wheel
if errorlevel 1 (
  echo [offline:error] Failed to install pip/setuptools/wheel from local wheels.
  exit /b 1
)

echo [offline] Installing base requirements from local wheels...
"%VENV_PY%" -m pip install --no-index --find-links "%WHL_DIR%" -r "%OFFLINE_BASE_REQ%"
if errorlevel 1 (
  echo [offline:error] Failed to install offline base requirements.
  exit /b 1
)

"%VENV_PY%" -m pip install --no-index --find-links "%WHL_DIR%" -r "%BASE_REQ%"
if errorlevel 1 (
  echo [offline:error] Failed to install project base requirements.
  exit /b 1
)

echo [offline] Installing Qwen CUDA 12.4 requirements from local wheels...
"%VENV_PY%" -m pip install --no-index --find-links "%WHL_DIR%" -r "%QWEN_REQ%"
if errorlevel 1 (
  echo [offline:error] Failed to install Qwen offline requirements.
  exit /b 1
)

echo [offline] Verifying base environment...
"%VENV_PY%" tools\bootstrap_env.py --is-base-ready
if errorlevel 1 (
  echo [offline:error] Base environment verification failed.
  exit /b 1
)

echo [offline] Verifying Qwen imports...
"%VENV_PY%" -c "import torch, torchvision, accelerate, huggingface_hub, safetensors; from transformers import AutoProcessor, Qwen3_5ForConditionalGeneration; print('torch', torch.__version__, 'cuda', torch.version.cuda); print('qwen imports ok')"
if errorlevel 1 (
  echo [offline:error] Qwen dependency import verification failed.
  exit /b 1
)

echo.
echo [offline] Offline environment ready.
echo [offline] Project Python: %VENV_PY%
echo [offline] Next step: run.bat
exit /b 0

:find_python
set "BOOTSTRAP_PY="

if not "%PYTHON%"=="" (
  call :check_python "%PYTHON%"
  if not errorlevel 1 (
    set "BOOTSTRAP_PY="%PYTHON%""
    echo [offline] Found Python 3.12 from PYTHON: %PYTHON%
    exit /b 0
  )
)

if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
  call :check_python "%LocalAppData%\Programs\Python\Python312\python.exe"
  if not errorlevel 1 (
    set "BOOTSTRAP_PY="%LocalAppData%\Programs\Python\Python312\python.exe""
    echo [offline] Found Python 3.12: %LocalAppData%\Programs\Python\Python312\python.exe
    exit /b 0
  )
)

if exist "%ProgramFiles%\Python312\python.exe" (
  call :check_python "%ProgramFiles%\Python312\python.exe"
  if not errorlevel 1 (
    set "BOOTSTRAP_PY="%ProgramFiles%\Python312\python.exe""
    echo [offline] Found Python 3.12: %ProgramFiles%\Python312\python.exe
    exit /b 0
  )
)

py -3.12 -c "import sys, importlib.util; ok=sys.version_info[:2] == (3, 12) and importlib.util.find_spec('venv') and importlib.util.find_spec('ensurepip'); raise SystemExit(0 if ok else 1)" >nul 2>nul
if not errorlevel 1 (
  set "BOOTSTRAP_PY=py -3.12"
  echo [offline] Found Python 3.12 from py launcher.
  exit /b 0
)

python -c "import sys, importlib.util; ok=sys.version_info[:2] == (3, 12) and importlib.util.find_spec('venv') and importlib.util.find_spec('ensurepip'); raise SystemExit(0 if ok else 1)" >nul 2>nul
if not errorlevel 1 (
  set "BOOTSTRAP_PY=python"
  echo [offline] Found Python 3.12 from PATH.
  exit /b 0
)

exit /b 1

:check_python
"%~1" -c "import sys, importlib.util; ok=sys.version_info[:2] == (3, 12) and importlib.util.find_spec('venv') and importlib.util.find_spec('ensurepip'); raise SystemExit(0 if ok else 1)" >nul 2>nul
exit /b %errorlevel%

:install_python
set "PYTHON_INSTALLER="
for /f "delims=" %%I in ('dir /b /a-d "%PYTHON_INSTALLER_DIR%\python-3.12*-amd64.exe" 2^>nul') do (
  if not defined PYTHON_INSTALLER set "PYTHON_INSTALLER=%PYTHON_INSTALLER_DIR%\%%I"
)

if not defined PYTHON_INSTALLER (
  echo [offline:error] No Python 3.12 x64 installer found in: %PYTHON_INSTALLER_DIR%
  echo [offline:error] Expected a file like python-3.12.x-amd64.exe
  exit /b 1
)

echo [offline] Installing Python 3.12 from: %PYTHON_INSTALLER%
echo [offline] This may take a minute.
start /wait "" "%PYTHON_INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_launcher=1 Include_test=0
if errorlevel 1 (
  echo [offline:error] Python installer failed with exit code %errorlevel%.
  exit /b 1
)

exit /b 0
