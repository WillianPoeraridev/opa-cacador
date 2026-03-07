@echo off
start chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\chrome-opa
timeout /t 3
node "C:\Users\HP\Music\Nova pasta\opa-cacador\cacador.js"