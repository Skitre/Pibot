#!/bin/bash
set -e
export HOME=/config
export DISPLAY=:1
export LANG=C.UTF-8
while [ ! -S /tmp/.X11-unix/X1 ]; do sleep 0.2; done
exec dbus-launch --exit-with-session startxfce4
