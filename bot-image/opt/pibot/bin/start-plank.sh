#!/bin/bash
set -e
export HOME=/config
export DISPLAY=:1
while [ ! -S /tmp/.X11-unix/X1 ]; do sleep 0.2; done
# 等会话 DBus，否则坞里的图标对不上
for i in $(seq 1 50); do
  if pgrep -u abc xfce4-session >/dev/null; then break; fi
  sleep 0.2
done
sleep 0.8
exec plank
