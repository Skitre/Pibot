#!/bin/bash
# 每个槽一台 TigerVNC（独立 X）+ 桌面会话 + noVNC。
set -e
# shellcheck source=/opt/pibot/desktop/screens.env
. /opt/pibot/desktop/screens.env
export HOME=/config

pids=""
term() {
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
}
trap term EXIT INT TERM

i=0
while [ "$i" -lt "$PIBOT_SLOT_COUNT" ]; do
  d=$((i + 1))
  rfb=$((5901 + i))
  http=$((3001 + i))
  rm -f "/tmp/.X11-unix/X${d}" "/tmp/.X${d}-lock"
  /usr/bin/Xtigervnc ":${d}" \
    -geometry "${PIBOT_SLOT_W}x${PIBOT_SLOT_H}" \
    -depth 24 \
    -SecurityTypes None \
    -localhost yes \
    -AlwaysShared \
    -AcceptSetDesktopSize=0 \
    -rfbport "$rfb" \
    >>"/tmp/vnc-${i}.log" 2>&1 &
  pids="$pids $!"
  i=$((i + 1))
done

i=0
while [ "$i" -lt "$PIBOT_SLOT_COUNT" ]; do
  d=$((i + 1))
  while [ ! -S "/tmp/.X11-unix/X${d}" ]; do sleep 0.1; done
  i=$((i + 1))
done

i=0
while [ "$i" -lt "$PIBOT_SLOT_COUNT" ]; do
  rfb=$((5901 + i))
  http=$((3001 + i))
  /opt/pibot/bin/start-session.sh "$i" >>"/tmp/session-${i}.log" 2>&1 &
  pids="$pids $!"
  /usr/bin/websockify --web=/usr/share/novnc "$http" "127.0.0.1:${rfb}" \
    >>"/tmp/slot-novnc-${i}.log" 2>&1 &
  pids="$pids $!"
  i=$((i + 1))
done

# 3100 仍指向第 0 屏，避免旧书签连到空白口。
/usr/bin/websockify --web=/usr/share/novnc 3000 127.0.0.1:5901 \
  >>/tmp/novnc-overview.log 2>&1 &
pids="$pids $!"

wait
