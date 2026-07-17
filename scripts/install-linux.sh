#!/bin/sh
# scripts/install-linux.sh - pasang daemon acca sbg systemd --user service (M5.4, ADR-021/007).
# Idempoten: aman dijalankan ulang (enable --now + daemon-reload = no-op bila sudah terpasang).
# Prasyarat: node di PATH, dan `npm run build` sudah jalan (dist/cli/index.js ada).
set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
TEMPLATE="$REPO_DIR/deploy/linux/acca-daemon.service"
ENTRYPOINT="$REPO_DIR/dist/cli/index.js"

NODE=$(command -v node) || { echo "ERROR: node tidak ditemukan di PATH." >&2; exit 1; }

if [ ! -f "$ENTRYPOINT" ]; then
  echo "ERROR: $ENTRYPOINT tidak ada - jalankan 'npm run build' dulu." >&2
  exit 1
fi
if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: template $TEMPLATE tidak ada." >&2
  exit 1
fi

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/acca-daemon.service"
mkdir -p "$UNIT_DIR"

# Substitusi placeholder -> path absolut (delimiter '|' krn path berisi '/'). Hindari asumsi PATH
# systemd --user yang minimal (G-12: node-pty & node butuh path absolut, bukan nama telanjang).
sed \
  -e "s|<NODE>|$NODE|g" \
  -e "s|<ENTRYPOINT>|$ENTRYPOINT|g" \
  "$TEMPLATE" > "$UNIT"

systemctl --user daemon-reload
systemctl --user enable --now acca-daemon.service

# enable-linger: daemon jalan tanpa sesi login aktif (survive logout, jalan saat boot). ADR-007.
loginctl enable-linger "$(id -un)"

echo "acca-daemon terpasang & aktif (systemd --user + linger)."
echo "  status : systemctl --user status acca-daemon"
echo "  log    : journalctl --user -u acca-daemon -f"
echo "  cabut  : systemctl --user disable --now acca-daemon && rm -f \"$UNIT\""
