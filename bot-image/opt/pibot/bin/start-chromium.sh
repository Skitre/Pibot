#!/bin/bash
set -e
export HOME=/config
export DISPLAY=:1
while [ ! -S /tmp/.X11-unix/X1 ]; do sleep 0.2; done
PROFILE=/config/.config/chromium
mkdir -p "$PROFILE"
rm -f "$PROFILE"/SingletonCookie "$PROFILE"/SingletonLock "$PROFILE"/SingletonSocket
exec chromium \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --no-first-run \
  --no-sandbox \
  --test-type \
  --disable-infobars \
  --disable-dev-shm-usage \
  --disable-session-crashed-bubble \
  --password-store=basic
