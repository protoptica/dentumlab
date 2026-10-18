$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
try {
    $python = Join-Path $root 'worker\.venv\Scripts\python.exe'
    if (-not (Test-Path $python)) { throw 'Run SETUP-WINDOWS.cmd first.' }
    $env:Path = "$env:ProgramFiles\Tesseract-OCR;$env:LOCALAPPDATA\Programs\Ollama;" + $env:Path
    $env:TESSDATA_PREFIX = Join-Path $root '.local\tessdata'
    $env:PYTHONUNBUFFERED = '1'
    New-Item -ItemType Directory -Force '.local' | Out-Null
    try { $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5 }
    catch {
        $ollama = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
        if (Test-Path $ollama) { Start-Process $ollama -ArgumentList 'serve' -WindowStyle Minimized }
    }
    Set-Location (Join-Path $root 'worker')
    # Python logging uses stderr; Windows PowerShell must not treat it as a terminating error.
    $ErrorActionPreference = 'Continue'
    & $python -u main.py 2>&1 | Tee-Object -FilePath (Join-Path $root '.local\worker-windows.log') -Append
    $workerExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($workerExitCode -ne 0) { throw 'Worker stopped. Check .local\worker-windows.log.' }
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
