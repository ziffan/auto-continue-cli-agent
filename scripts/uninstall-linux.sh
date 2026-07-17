#!/bin/sh
# scripts/uninstall-linux.sh - cabut daemon acca dari systemd --user (M5.4). Idempoten (aman
# dijalankan walau belum terpasang). TIDAK menyentuh acca.db / backups / linger:
#   - data (acca.db) & backups dibiarkan (no-hard-delete, CONVENTIONS) - untuk hapus total:
#       rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/acca"   (HATI-HATI, ireversibel)
#   - linger dibiarkan (backup timer mungkin memakainya) - cabut manual bila mau:
#       loginctl disable-linger "$(id -un)"
set -eu

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/acca-daemon.service"

# disable --now = stop + hapus symlink wants; || true agar idempoten (unit tak ada = tak fatal).
systemctl --user disable --now acca-daemon.service 2>/dev/null || true
rm -f "$UNIT"
systemctl --user daemon-reload

echo "acca-daemon dicabut (service disabled + unit dihapus). acca.db & backups TIDAK disentuh."
echo "Pasang lagi: sh scripts/install-linux.sh"
