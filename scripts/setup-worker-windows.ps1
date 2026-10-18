$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}
function Install-Package([string]$id) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install App Installer from Microsoft Store, then run setup again.' }
    & winget install --exact --id $id --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { throw "Installation failed: $id. Install it manually and run setup again." }
    Refresh-Path
}
try {
    $python = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (-not (Test-Path $python)) { Install-Package 'Python.Python.3.12' }
    if (-not (Test-Path $python)) {
        $candidate = & py -3.12 -c 'import sys; print(sys.executable)'
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 not found. Restart setup after installing Python.' }
        $python = $candidate.Trim()
    }
    $ollama = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (-not (Test-Path $ollama)) { Install-Package 'Ollama.Ollama' }
    if (-not (Test-Path $ollama)) { $ollama = (Get-Command ollama -ErrorAction Stop).Source }
    $tesseract = Join-Path $env:ProgramFiles 'Tesseract-OCR\tesseract.exe'
    if (-not (Test-Path $tesseract)) { Install-Package 'UB-Mannheim.TesseractOCR' }
    if (-not (Test-Path $tesseract)) { $tesseract = (Get-Command tesseract -ErrorAction Stop).Source }
    $env:Path = (Split-Path $tesseract) + ';' + $env:Path
    New-Item -ItemType Directory -Force '.local\tessdata' | Out-Null
    foreach ($lang in @('rus','eng')) {
        $target = Join-Path $root ".local\tessdata\$lang.traineddata"
        if (-not (Test-Path $target)) {
            Invoke-WebRequest "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/$lang.traineddata" -OutFile $target -UseBasicParsing
        }
    }
    if (-not (Test-Path 'worker\.venv\Scripts\python.exe')) {
        & $python -m venv worker\.venv
        if ($LASTEXITCODE -ne 0) { throw 'Could not create Python environment.' }
    }
    & '.\worker\.venv\Scripts\python.exe' -m pip install -r worker\requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    if (Test-Path 'worker-config.env') { Copy-Item 'worker-config.env' 'worker\.env' -Force }
    if (-not (Test-Path 'worker\.env')) { throw 'Put the private worker-config.env file next to WINDOWS.md and run setup again.' }
    try { $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5 }
    catch { Start-Process $ollama -ArgumentList 'serve' -WindowStyle Minimized; Start-Sleep -Seconds 5 }
    & $ollama pull qwen3:14b
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Check internet and run setup again.' }
    $env:TESSDATA_PREFIX = Join-Path $root '.local\tessdata'
    & $tesseract --list-langs
    & '.\worker\.venv\Scripts\python.exe' scripts\check-worker.py
    if ($LASTEXITCODE -ne 0) { throw 'Worker check failed. See the message above.' }
    Write-Host 'Ready. Run START-WORKER.cmd. Keep Ollama running.' -ForegroundColor Green
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
