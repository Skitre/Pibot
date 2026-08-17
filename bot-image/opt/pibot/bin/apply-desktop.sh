#!/bin/bash
# 把共享电脑桌面收成：深色壁纸 + 底栏正中三个图标（浏览器 / 文件 / 终端）
set -e
export HOME=/config
WALL_SRC=/opt/pibot/desktop/wallpaper.png
WALL_DST=/config/.pibot/wallpaper-user.png
CONF=/config/.config
PANEL=$CONF/xfce4/panel
XFCONF=$CONF/xfce4/xfconf/xfce-perchannel-xml

mkdir -p /config/.pibot \
  "$PANEL/launcher-10" "$PANEL/launcher-20" "$PANEL/launcher-30" \
  "$XFCONF" \
  "$CONF/gtk-3.0" \
  "$CONF/xfce4/desktop"

if [ -f "$WALL_SRC" ]; then
  cp -f "$WALL_SRC" "$WALL_DST"
fi

cp -f /opt/pibot/desktop/chromium.desktop "$PANEL/launcher-10/chromium.desktop"
cp -f /opt/pibot/desktop/thunar.desktop "$PANEL/launcher-20/thunar.desktop"
cp -f /opt/pibot/desktop/terminal.desktop "$PANEL/launcher-30/terminal.desktop"
cp -f /opt/pibot/desktop/xfce4-panel.xml "$XFCONF/xfce4-panel.xml"
cp -f /opt/pibot/desktop/xfce4-desktop.xml "$XFCONF/xfce4-desktop.xml"
cp -f /opt/pibot/desktop/xsettings.xml "$XFCONF/xsettings.xml"
cp -f /opt/pibot/desktop/xfce4-session.xml "$XFCONF/xfce4-session.xml"
cp -f /opt/pibot/desktop/gtk-settings.ini "$CONF/gtk-3.0/settings.ini"

# Plank：底栏正中三个图标
PLANK=$CONF/plank/dock1
mkdir -p "$PLANK/launchers"
cp -f /opt/pibot/desktop/plank-settings "$PLANK/settings"
cp -f /opt/pibot/desktop/chromium.dockitem "$PLANK/launchers/chromium.dockitem"
cp -f /opt/pibot/desktop/thunar.dockitem "$PLANK/launchers/thunar.dockitem"
cp -f /opt/pibot/desktop/terminal.dockitem "$PLANK/launchers/terminal.dockitem"

# 不要桌面图标
cat > "$CONF/xfce4/desktop/icons.screen0.yaml" <<'EOF'
#
EOF

chown -R abc:abc /config/.pibot /config/.config/xfce4 /config/.config/gtk-3.0 /config/.config/plank 2>/dev/null || true
