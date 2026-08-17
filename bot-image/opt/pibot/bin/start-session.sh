#!/bin/bash
# 一块屏上的轻量桌面：独立 D-Bus，不跟别的屏抢鼠标和窗口。
set -e
SLOT="${1:?slot}"
# shellcheck source=/opt/pibot/desktop/screens.env
. /opt/pibot/desktop/screens.env
DISP=$((SLOT + 1))
export HOME=/config
export DISPLAY=":${DISP}"
export LANG=C.UTF-8
export XDG_CONFIG_HOME="/config/.pibot/s${SLOT}/config"
export XDG_CACHE_HOME="/config/.pibot/s${SLOT}/cache"
export XDG_DATA_HOME="/config/.pibot/s${SLOT}/data"
export XDG_RUNTIME_DIR="/tmp/pibot-rt-${SLOT}"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

while [ ! -S "/tmp/.X11-unix/X${DISP}" ]; do sleep 0.2; done

eval "$(dbus-launch --sh-syntax)"
printf '%s\n' "$DBUS_SESSION_BUS_ADDRESS" > "/tmp/pibot-dbus-${SLOT}"

xfsettingsd --daemon || true
xfwm4 --compositor=off &
xfdesktop &
sleep 0.5
WALL="/config/.pibot/wallpapers/slot-${SLOT}.png"
if [ -f "$WALL" ] && command -v xfconf-query >/dev/null 2>&1; then
  for mon in monitorVNC-0 monitor0; do
    xfconf-query -c xfce4-desktop -p "/backdrop/screen0/${mon}/workspace0/last-image" \
      -n -t string -s "$WALL" 2>/dev/null || true
    xfconf-query -c xfce4-desktop -p "/backdrop/screen0/${mon}/workspace0/image-style" \
      -n -t int -s 3 2>/dev/null || true
  done
fi
exec xfce4-panel
