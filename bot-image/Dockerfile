# 共享电脑：Debian 13 + XFCE + Chromium + noVNC
# 不带 webtop / Selkies / Docker-in-Docker / locales-all
FROM node:20-bookworm-slim AS deps
WORKDIR /opt/pibot
COPY opt/pibot/package.json opt/pibot/package-lock.json ./
RUN npm ci --omit=dev

FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    HOME=/config \
    DISPLAY=:1 \
    PIBOT_WORKSPACE=/config/workspace

# Node 用 Debian 自带的（trixie 是 20）。npm 不进最终镜像，依赖在上一阶段装好。
# apt 重试：一次拉 XFCE+Chromium 很容易中途断。
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\n' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
        xfce4 xfce4-terminal thunar dbus-x11 \
        tigervnc-standalone-server \
        novnc websockify \
        chromium \
        nodejs \
        scrot git \
        fonts-noto-cjk fonts-noto-color-emoji fonts-liberation \
        supervisor \
        procps \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN useradd -u 1000 -U -d /config -s /bin/bash abc \
    && mkdir -p /config /opt/pibot /opt/pibot/bin

# 深色 GTK 主题。单独一层，避免重跑上面那大包。
RUN apt-get update && apt-get install -y --no-install-recommends greybird-gtk-theme plank \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY opt/pibot /opt/pibot
COPY --from=deps /opt/pibot/node_modules /opt/pibot/node_modules
RUN sed -i 's/\r$//' /opt/pibot/bin/*.sh \
    && chmod +x /opt/pibot/bin/*.sh /opt/pibot/bin/apply-desktop.sh

COPY root/ /
RUN sed -i 's/\r$//' /opt/pibot/bin/*.sh /etc/supervisor/supervisord.conf /etc/supervisor/conf.d/*.conf \
    && chmod +x /opt/pibot/bin/*.sh

EXPOSE 3000
VOLUME /config
ENTRYPOINT ["/opt/pibot/bin/entrypoint.sh"]
