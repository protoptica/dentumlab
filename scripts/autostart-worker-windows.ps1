param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$linkPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Dentum procurement worker.lnk'
if ($Remove) {
    Remove-Item $linkPath -ErrorAction SilentlyContinue
    Write-Host 'Autostart disabled. Close the worker window to stop the current run.'
} else {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = Join-Path $root 'START-WORKER.cmd'
    $link.WorkingDirectory = $root
    $link.WindowStyle = 7
    $link.Description = 'Dentum invoice processing'
    $link.Save()
    Write-Host 'Autostart enabled for this Windows user. Do not move the application folder.'
}
