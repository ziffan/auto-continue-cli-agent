# register-backup-task.ps1 — daftarkan Windows Task Scheduler untuk backup one-shot acca.db
# (ADR-022/024). CATATAN PENTING (supaya tak dikira kontradiksi ADR-021): ADR-021 menolak Task
# Scheduler untuk DAEMON acca (long-running, butuh auto-restart on-crash — kelemahan Task
# Scheduler ONSTART yang gagal-senyap tanpa auto-restart). Backup di sini BUKAN daemon — one-shot
# yang exit begitu selesai; trigger repetition jam-jaman Task Scheduler pas untuk pola ini, jadi
# dipakai di sini (bukan Windows Service seperti daemon utama).
#
# Pasang (jalankan di PowerShell, cukup sekali; hak admin TIDAK wajib untuk task per-user):
#   .\register-backup-task.ps1 -InstallDir "C:\path\ke\auto-continue-cli-agent" -NodePath "C:\Program Files\nodejs\node.exe"
#
# Retensi tiered (ADR-024) dibaca dari env proses task — set lewat parameter -RetentionHourly/
# -RetentionDaily di bawah (ditulis sebagai env var pada action, bukan hardcode di kode).
#
# Verifikasi: Get-ScheduledTask -TaskName "acca-backup" | Get-ScheduledTaskInfo
# Cabut: Unregister-ScheduledTask -TaskName "acca-backup" -Confirm:$false

param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir,

    [Parameter(Mandatory = $true)]
    [string]$NodePath,

    [int]$RetentionHourly = 24,
    [int]$RetentionDaily = 30,

    [string]$TaskName = "acca-backup"
)

$scriptPath = Join-Path $InstallDir "scripts\backup.js"

# Env retensi diteruskan lewat cmd /c "set X=Y && ..." karena ScheduledTaskAction tak punya
# field env langsung — tetap config-over-hardcode (nilai datang dari parameter, bukan literal
# di backup.js/backup.ts).
$envPrefix = "set ACCA_BACKUP_RETENTION_HOURLY=$RetentionHourly&& set ACCA_BACKUP_RETENTION_DAILY=$RetentionDaily&&"
$action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c `"$envPrefix `"$NodePath`" `"$scriptPath`"`"" `
    -WorkingDirectory $InstallDir

# Repetition setiap 1 jam, tanpa batas waktu (ADR-024: interval hourly).
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Hours 1) `
    -RepetitionDuration ([TimeSpan]::MaxValue)

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "acca — backup snapshot acca.db (one-shot hourly, ADR-024)" -Force

Write-Host "Task '$TaskName' terdaftar. Verifikasi: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
