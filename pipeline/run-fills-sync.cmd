@echo off
cd /d "C:\dev\The-Ledger\pipeline"
"C:\Program Files\nodejs\node.exe" sync-fills.mjs --auto
