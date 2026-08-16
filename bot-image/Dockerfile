# Bot 的"电脑"：Debian XFCE 网页桌面 + Chromium + pi agent
FROM lscr.io/linuxserver/webtop:debian-xfce

# 系统依赖：Chromium（真实 deb 包）、桌面截图工具、Node.js 22
RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium scrot curl git ca-certificates gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# pi coding agent（全局 CLI，含 SDK/RPC 模式）
RUN npm install -g @earendil-works/pi-coding-agent && pi --version || true

# 桥接服务与扩展（含 playwright-core / ws / typebox 依赖）
COPY opt/pibot /opt/pibot
RUN cd /opt/pibot && npm install --omit=dev

# linuxserver 自定义 init 脚本与服务
# 去 CRLF：仓库可能在 Windows 上检出，带 \r 的脚本在容器里会直接报错
COPY root/ /
RUN sed -i 's/\r$//' /custom-cont-init.d/* /custom-services.d/* && \
    chmod +x /custom-cont-init.d/* /custom-services.d/*

# 3000: KasmVNC 网页桌面  8791: pi RPC WebSocket 桥
EXPOSE 3000 8791
