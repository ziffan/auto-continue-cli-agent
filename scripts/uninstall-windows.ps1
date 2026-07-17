# scripts/uninstall-windows.ps1 - cabut daemon acca dari Task Scheduler (M5.5, ADR-026). Idempoten
# (aman walau task belum terpasang). TIDAK menyentuh acca.db / backups (no-hard-delete, CONVENTIONS):
#   - hapus total data (HATI-HATI, ireversibel):
#       Remove-Item -Recurse -Force "$env:LOCALAPPDATA\acca"
#
# ASCII-only WAJIB (G-44). Pakai:
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall-windows.ps1  [-TaskName <nama>]

param(
    [string]$TaskName = 'acca-daemon'
)

$ErrorActionPreference = 'Stop'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    # Stop dulu bila sedang jalan (Unregister tak menghentikan proses yang sudah spawn).
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "acca-daemon dicabut (task '$TaskName' dihapus). acca.db & backups TIDAK disentuh."
} else {
    Write-Host "task '$TaskName' tidak terpasang - tidak ada yang dicabut."
}
Write-Host "Pasang lagi: powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1"
