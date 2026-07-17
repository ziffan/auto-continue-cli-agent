# scripts/install-windows.ps1 - pasang daemon acca sbg Task Scheduler autostart per-user @logon
# (M5.5, ADR-026). Jalan SEBAGAI user login -> acca.db & kredensial CC/agy milik user (tak kena I-33),
# analog `systemd --user` di Linux. Hak admin TIDAK wajib (task per-user).
#
# Idempoten: -Force menimpa task lama bila sudah ada (aman dijalankan ulang).
# Prasyarat: node di PATH, dan `npm run build` sudah jalan (dist\cli\index.js ada).
#
# ASCII-only WAJIB (G-44: PS 5.1 baca UTF-8-tanpa-BOM sbg CP1252 -> em-dash/smart-quote merusak parse).
#
# Pakai:
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
#   (opsi) -InstallDir <repo> -NodePath <node.exe> -TaskName <nama>
#
# Verifikasi: Get-ScheduledTask -TaskName 'acca-daemon' | Get-ScheduledTaskInfo
# Cabut    : powershell -ExecutionPolicy Bypass -File scripts\uninstall-windows.ps1

param(
    [string]$InstallDir,
    [string]$NodePath,
    [string]$TaskName = 'acca-daemon'
)

$ErrorActionPreference = 'Stop'

# InstallDir default = root repo (parent dari folder script ini).
if (-not $InstallDir) {
    $InstallDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$InstallDir = $InstallDir.TrimEnd('\')

# NodePath default = node di PATH (absolut - jangan andalkan PATH task, kelas G-12).
if (-not $NodePath) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "node tidak ditemukan di PATH. Beri -NodePath <path ke node.exe>." }
    $NodePath = $cmd.Source
}

$entrypoint = Join-Path $InstallDir 'dist\cli\index.js'
if (-not (Test-Path $entrypoint)) {
    throw "$entrypoint tidak ada - jalankan 'npm run build' dulu."
}

$templatePath = Join-Path $InstallDir 'deploy\windows\acca-daemon.task.xml'
if (-not (Test-Path $templatePath)) {
    throw "template $templatePath tidak ada."
}

$userId = "$env:USERDOMAIN\$env:USERNAME"

# XML-escape nilai substitusi (path/username jarang punya, tapi & < > wajib aman di XML).
function ConvertTo-XmlText([string]$s) {
    return $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;')
}

$xml = Get-Content -Path $templatePath -Raw
$xml = $xml.Replace('{{NODE}}',       (ConvertTo-XmlText $NodePath))
$xml = $xml.Replace('{{ENTRYPOINT}}', (ConvertTo-XmlText $entrypoint))
$xml = $xml.Replace('{{WORKDIR}}',    (ConvertTo-XmlText $InstallDir))
$xml = $xml.Replace('{{USERID}}',     (ConvertTo-XmlText $userId))

if ($xml -match '\{\{[A-Z_]+\}\}') {
    throw "placeholder belum tersubstitusi tersisa di XML: $($Matches[0])"
}

# Register-ScheduledTask -Xml (string): encoding-agnostic, tak butuh UTF-16-BOM spt `schtasks /xml`.
# LogonType InteractiveToken -> TIDAK butuh password. -Force = idempoten (timpa task lama).
Register-ScheduledTask -Xml $xml -TaskName $TaskName -User $userId -Force | Out-Null

Write-Host "acca-daemon terpasang (Task Scheduler autostart @logon, user $userId)."
Write-Host "  node      : $NodePath"
Write-Host "  entrypoint: $entrypoint"
Write-Host "  status    : Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "  jalan skrg: Start-ScheduledTask -TaskName '$TaskName'   (tak perlu tunggu logon)"
Write-Host "  cabut     : powershell -ExecutionPolicy Bypass -File scripts\uninstall-windows.ps1"
