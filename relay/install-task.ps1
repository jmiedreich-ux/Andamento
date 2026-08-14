$ErrorActionPreference = 'Stop'

$taskName = 'VennuSign Workbench Relay'
$relayRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $relayRoot 'launch-relay.vbs'
$arguments = '//B //Nologo "' + $launcher + '"'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Runs the private VennuSign Workbench Google Sheets to Codex relay.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed and started scheduled task: $taskName"
