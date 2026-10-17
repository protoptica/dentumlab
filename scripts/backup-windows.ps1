# Run this after preparing a protected wrapper that loads PG* and BACKUP_DIR and calls node backup.mjs.
param([Parameter(Mandatory=$true)][string]$WrapperPath)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -File `"$WrapperPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At '19:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'DentumProcurementBackup' -Action $action -Trigger $trigger -Settings $settings -Description 'Ежедневная копия базы закупок'
