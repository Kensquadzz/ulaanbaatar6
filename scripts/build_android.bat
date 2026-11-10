@echo off
rem Android APK + AAB build on Windows. set UE_ROOT=C:\Program Files\Epic Games\UE_5.5
rem NOT yet run: this script has never produced a build.
if "%UE_ROOT%"=="" (echo Set UE_ROOT to your Unreal Engine folder & exit /b 1)
set CONFIG=%1
if "%CONFIG%"=="" set CONFIG=Development
set ROOT=%~dp0..
if not exist "%ROOT%\data\tiles\manifest.json" (echo Run the pipeline first & exit /b 1)
rmdir /s /q "%ROOT%\unreal\Ulaanbaatar6\Content\UB6Data\tiles" 2>nul
xcopy /e /i /q "%ROOT%\data\tiles" "%ROOT%\unreal\Ulaanbaatar6\Content\UB6Data\tiles" >nul
call "%UE_ROOT%\Engine\Build\BatchFiles\RunUAT.bat" BuildCookRun -project="%ROOT%\unreal\Ulaanbaatar6\Ulaanbaatar6.uproject" -platform=Android -cookflavor=ASTC -clientconfig=%CONFIG% -build -cook -stage -pak -iostore -package -archive -archivedirectory="%ROOT%\build\Android\%CONFIG%" -nop4 -utf8output
