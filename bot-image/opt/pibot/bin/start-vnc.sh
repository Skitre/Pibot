#!/bin/bash
set -e
export HOME=/config
# shellcheck source=/opt/pibot/desktop/screens.env
. /opt/pibot/desktop/screens.env
W=$((PIBOT_SLOT_W * PIBOT_SLOT_COUNT))
H=$PIBOT_SLOT_H
# noVNC resize=scale 会发 SetDesktopSize；绝不能让整张宽桌面被压成一个槽。
rm -f /tmp/.X11-unix/X1 /tmp/.X1-lock
mkdir -p /tmp/.X11-unix
exec /usr/bin/Xtigervnc :1 \
  -geometry "${W}x${H}" \
  -depth 24 \
  -SecurityTypes None \
  -localhost yes \
  -AlwaysShared \
  -AcceptSetDesktopSize=0 \
  -rfbport 5901
