#!/bin/bash
set -e
export HOME=/config
rm -f /tmp/.X11-unix/X1 /tmp/.X1-lock
mkdir -p /tmp/.X11-unix
exec /usr/bin/Xtigervnc :1 \
  -geometry 1600x900 \
  -depth 24 \
  -SecurityTypes None \
  -localhost yes \
  -AlwaysShared \
  -AcceptSetDesktopSize \
  -rfbport 5901
