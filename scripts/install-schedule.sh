#!/bin/zsh
# Instala la actualización diaria automática como LaunchAgent del usuario (macOS).
# Desinstalar: launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.local.intelligence.update.plist
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/LaunchAgents/com.local.intelligence.update.plist"
mkdir -p "$ROOT/data" "$HOME/Library/LaunchAgents"
sed "s#__ROOT__#$ROOT#g" "$ROOT/scripts/launchd/com.local.intelligence.update.plist" > "$DEST"
launchctl bootout "gui/$(id -u)" "$DEST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "Actualización programada instalada: $DEST (bitácora en $ROOT/data/update.log)"
