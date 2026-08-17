#!/bin/bash
# 每块独立屏一张完整壁纸（不再拼宽图）。
set -e
# shellcheck source=/opt/pibot/desktop/screens.env
. /opt/pibot/desktop/screens.env
export HOME="${HOME:-/config}"

W=$PIBOT_SLOT_W
H=$PIBOT_SLOT_H
N=$PIBOT_SLOT_COUNT
DIR=/config/.pibot
WALLS=$DIR/wallpapers
DEFAULT=$DIR/wallpaper-user.png
[ -f "$DEFAULT" ] || DEFAULT=/opt/pibot/desktop/wallpaper.png

mkdir -p "$DIR" "$WALLS"

python3 - /tmp/pibot-wall-map.txt <<'PY'
import json, sys
out = sys.argv[1]
inv = {}
try:
    slots = json.load(open("/config/.pibot/screen-slots.json")).get("slots") or {}
except Exception:
    slots = {}
for bot, idx in slots.items():
    try:
        i = int(idx)
    except (TypeError, ValueError):
        continue
    inv.setdefault(i, str(bot))
with open(out, "w", encoding="utf-8") as f:
    for i, bot in sorted(inv.items()):
        f.write(f"{i} {bot}\n")
PY

bot_for_slot() {
  awk -v s="$1" '$1==s { print $2; exit }' /tmp/pibot-wall-map.txt 2>/dev/null || true
}

make_default() {
  local i="$1" dest="$2"
  if [ "$i" = 0 ] && [ -f "$DEFAULT" ]; then
    ffmpeg -y -i "$DEFAULT" \
      -vf "scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}" \
      -frames:v 1 -update 1 "$dest" >/dev/null 2>&1
    return
  fi
  local c0 c1
  case "$i" in
    1) c0=0x0f172a; c1=0x334155 ;;
    2) c0=0x1c1917; c1=0x7c2d12 ;;
    3) c0=0x052e16; c1=0x14532d ;;
    4) c0=0x2e1065; c1=0x6d28d9 ;;
    *) c0=0x111827; c1=0x4b5563 ;;
  esac
  ffmpeg -y -f lavfi -i "gradients=s=${W}x${H}:c0=${c0}:c1=${c1}:duration=1" \
    -frames:v 1 -update 1 "$dest" >/dev/null 2>&1
}

fit_image() {
  ffmpeg -y -i "$1" \
    -vf "scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}" \
    -frames:v 1 -update 1 "$2" >/dev/null 2>&1
}

i=0
while [ "$i" -lt "$N" ]; do
  dest="$WALLS/slot-${i}.png"
  bot=$(bot_for_slot "$i")
  custom=""
  if [ -n "$bot" ]; then
    if [ -f "$WALLS/${bot}.png" ]; then
      custom="$WALLS/${bot}.png"
    elif [ -f "$WALLS/${bot}.jpg" ]; then
      custom="$WALLS/${bot}.jpg"
    fi
  fi
  if [ -n "$custom" ]; then
    fit_image "$custom" "$dest"
  else
    make_default "$i" "$dest"
  fi
  xml="/config/.pibot/s${i}/config/xfce4/xfconf/xfce-perchannel-xml/xfce4-desktop.xml"
  if [ -f "$xml" ]; then
    sed -i "s#name=\"last-image\" type=\"string\" value=\"[^\"]*\"#name=\"last-image\" type=\"string\" value=\"${dest}\"#" "$xml"
    sed -i 's/name="image-style" type="int" value="[0-9]*"/name="image-style" type="int" value="3"/' "$xml"
  fi
  if [ -S "/tmp/.X11-unix/X$((i + 1))" ] && [ -r "/tmp/pibot-dbus-${i}" ]; then
    (
      export DISPLAY=":$((i + 1))"
      export HOME=/config
      export XDG_CONFIG_HOME="/config/.pibot/s${i}/config"
      export DBUS_SESSION_BUS_ADDRESS
      DBUS_SESSION_BUS_ADDRESS=$(cat "/tmp/pibot-dbus-${i}")
      if command -v xfconf-query >/dev/null 2>&1; then
        for mon in monitorVNC-0 monitor0; do
          xfconf-query -c xfce4-desktop -p "/backdrop/screen0/${mon}/workspace0/last-image" \
            -n -t string -s "$dest" 2>/dev/null || true
          xfconf-query -c xfce4-desktop -p "/backdrop/screen0/${mon}/workspace0/image-style" \
            -n -t int -s 3 2>/dev/null || true
        done
      fi
      pkill -HUP -f "xfdesktop" 2>/dev/null || true
    ) || true
  fi
  i=$((i + 1))
done

chown -R abc:abc "$WALLS" 2>/dev/null || true
echo "$WALLS"
