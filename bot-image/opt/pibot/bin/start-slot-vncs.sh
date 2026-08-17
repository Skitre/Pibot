#!/bin/bash
# 每个槽一路裁切 VNC + noVNC。整张宽桌面仍在 5901/3000，给总览用。
set -e
# shellcheck source=/opt/pibot/desktop/screens.env
. /opt/pibot/desktop/screens.env
export HOME=/config
export DISPLAY=:1
while [ ! -S /tmp/.X11-unix/X1 ]; do sleep 0.2; done
sleep 0.4

pids=""
i=0
while [ "$i" -lt "$PIBOT_SLOT_COUNT" ]; do
  x=$((i * PIBOT_SLOT_W))
  rfb=$((5902 + i))
  http=$((3001 + i))
  x11vnc \
    -display :1 \
    -clip "${PIBOT_SLOT_W}x${PIBOT_SLOT_H}+${x}+0" \
    -rfbport "$rfb" \
    -localhost \
    -forever \
    -shared \
    -nopw \
    -noxdamage \
    -noshm \
    -noxrandr \
    -o "/tmp/x11vnc-${i}.log" \
    >/dev/null 2>&1 &
  pids="$pids $!"
  /usr/bin/websockify --web=/usr/share/novnc "$http" "127.0.0.1:${rfb}" \
    >>"/tmp/slot-novnc-${i}.log" 2>&1 &
  pids="$pids $!"
  i=$((i + 1))
done

term() {
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
}
trap term EXIT INT TERM
wait
