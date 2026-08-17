#!/bin/bash
set -e
mkdir -p /config/workspace/uploads /config/bots /config/.config /config/.pibot /config/.vnc /tmp/.X11-unix
chown abc:abc /config /config/workspace /config/bots /config/.config /config/.pibot /config/.vnc
chown abc:abc /config/workspace/uploads 2>/dev/null || true
chmod 1777 /tmp/.X11-unix
/opt/pibot/bin/apply-desktop.sh
exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
