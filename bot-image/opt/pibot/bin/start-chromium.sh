#!/bin/bash
set -e
export HOME=/config
# shellcheck source=/opt/pibot/desktop/screens.env
. /opt/pibot/desktop/screens.env

if [ -n "${1:-}" ]; then
  SLOT="$1"
else
  D="${DISPLAY#:}"
  D="${D%%.*}"
  SLOT=$((D - 1))
fi
if [ "$SLOT" -lt 0 ] 2>/dev/null; then SLOT=0; fi

DISP=$((SLOT + 1))
export DISPLAY=":${DISP}"
while [ ! -S "/tmp/.X11-unix/X${DISP}" ]; do sleep 0.2; done

CANON=/config/.config/chromium
PROFILE=/config/.pibot/chrome/s${SLOT}
mkdir -p "$PROFILE/Default/Network" "$CANON/Default/Network"

sync_from_shared() {
  for f in Cookies Cookies-journal "Login Data" "Login Data-journal" "Login Data For Account"; do
    if [ -f "$CANON/Default/$f" ]; then
      cp -a "$CANON/Default/$f" "$PROFILE/Default/" 2>/dev/null || true
    fi
  done
  if [ -f "$CANON/Default/Network/Cookies" ]; then
    cp -a "$CANON/Default/Network/Cookies" "$PROFILE/Default/Network/" 2>/dev/null || true
  fi
}

sync_to_shared() {
  mkdir -p "$CANON/Default/Network"
  for f in Cookies Cookies-journal "Login Data" "Login Data-journal" "Login Data For Account"; do
    if [ -f "$PROFILE/Default/$f" ]; then
      cp -a "$PROFILE/Default/$f" "$CANON/Default/" 2>/dev/null || true
    fi
  done
  if [ -f "$PROFILE/Default/Network/Cookies" ]; then
    cp -a "$PROFILE/Default/Network/Cookies" "$CANON/Default/Network/" 2>/dev/null || true
  fi
}

PORT=$((9222 + SLOT))
if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  exit 0
fi

sync_from_shared
rm -f "$PROFILE"/SingletonCookie "$PROFILE"/SingletonLock "$PROFILE"/SingletonSocket \
  "$PROFILE/Default/Last Session" "$PROFILE/Default/Last Tabs" \
  "$PROFILE/Default/Current Session" "$PROFILE/Default/Current Tabs"

WIN_H=$((PIBOT_SLOT_H - PIBOT_PANEL_H))
trap sync_to_shared EXIT

exec chromium \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --remote-debugging-address=127.0.0.1 \
  --window-position=0,0 \
  --window-size="${PIBOT_SLOT_W},${WIN_H}" \
  --no-first-run \
  --no-sandbox \
  --test-type \
  --disable-infobars \
  --disable-dev-shm-usage \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --password-store=basic
