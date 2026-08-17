#!/bin/bash
set -e
# 只把本机 VNC 转成网页。5901 不映射出去。
exec /usr/bin/websockify --web=/usr/share/novnc 3000 127.0.0.1:5901
