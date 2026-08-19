@echo off
rem ============================================
rem  ForgeMind 语音控制 Demo - 一键启动
rem  双击运行：Ollama + BT-7274 语音 + 语音助手
rem ============================================
chcp 65001 >nul
set OLLAMA_MODELS=D:\local\ollama\models

echo [1/3] 清理并启动 Ollama 本地 LLM...
taskkill /F /IM ollama.exe >nul 2>&1
taskkill /F /IM "ollama app.exe" >nul 2>&1
start "Ollama" cmd /k ""%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve"

echo [2/3] 启动 BT-7274 语音服务...
start "BT-TTS" cmd /k "cd /d D:\local\bt7274-space && venv\Scripts\python bt_tts_server.py"

echo [3/3] 等两个服务就绪后启动语音助手（约15秒）...
ping -n 18 127.0.0.1 >nul
cd /d D:\Code\factory\voice-chat
venv\Scripts\python voice_chat.py

echo.
echo 语音助手已退出。
pause
