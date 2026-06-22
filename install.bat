@echo off
node "%~dp0install.js" %*
if %ERRORLEVEL% neq 0 (
  echo.
  echo ERROR: Installation failed.
  echo Make sure Node.js ^(https://nodejs.org^) is installed and in PATH.
)
pause
