#!/bin/bash
# 每次开机把每块独立屏收成镜像配方：壁纸 + 底栏正中三图标。不启动浏览器。
set -e
export HOME=/config
WALL_SRC=/opt/pibot/desktop/wallpaper.png
WALL_DST=/config/.pibot/wallpaper-user.png
# shellcheck source=/opt/pibot/desktop/screens.env
. /opt/pibot/desktop/screens.env

mkdir -p /config/.pibot/wallpapers /config/.config

if [ -f "$WALL_SRC" ]; then
  cp -f "$WALL_SRC" "$WALL_DST"
fi

seed_slot() {
  local i="$1"
  local conf="/config/.pibot/s${i}/config"
  local panel="$conf/xfce4/panel"
  local xfconf="$conf/xfce4/xfconf/xfce-perchannel-xml"
  mkdir -p "$panel/launcher-10" "$panel/launcher-20" "$panel/launcher-30" \
    "$xfconf" "$conf/gtk-3.0" "$conf/xfce4/desktop" \
    "/config/.pibot/s${i}/cache" "/config/.pibot/s${i}/data"
  cp -f /opt/pibot/desktop/chromium.desktop "$panel/launcher-10/chromium.desktop"
  cp -f /opt/pibot/desktop/thunar.desktop "$panel/launcher-20/thunar.desktop"
  cp -f /opt/pibot/desktop/terminal.desktop "$panel/launcher-30/terminal.desktop"
  cp -f /opt/pibot/desktop/xfce4-panel.xml "$xfconf/xfce4-panel.xml"
  cp -f /opt/pibot/desktop/xfce4-desktop.xml "$xfconf/xfce4-desktop.xml"
  cp -f /opt/pibot/desktop/xsettings.xml "$xfconf/xsettings.xml"
  cp -f /opt/pibot/desktop/gtk-settings.ini "$conf/gtk-3.0/settings.ini"
  sed -i "s#name=\"last-image\" type=\"string\" value=\"[^\"]*\"#name=\"last-image\" type=\"string\" value=\"/config/.pibot/wallpapers/slot-${i}.png\"#" \
    "$xfconf/xfce4-desktop.xml"
  cat > "$conf/xfce4/desktop/icons.screen0.yaml" <<'EOF'
#
EOF
}

i=0
while [ "$i" -lt "$PIBOT_SLOT_COUNT" ]; do
  seed_slot "$i"
  i=$((i + 1))
done

/opt/pibot/bin/compose-wallpapers.sh || true

rm -f /config/.config/autostart/plank.desktop \
  /config/.config/autostart/xfce4-panel.desktop
rm -rf /config/.config/plank /config/.cache/sessions

echo 5 > /config/.pibot/desktop-theme
chown -R abc:abc /config/.pibot /config/.config/gtk-3.0 2>/dev/null || true
