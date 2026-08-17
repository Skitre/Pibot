#!/bin/bash
set -e
export HOME=/config
export DISPLAY=:1
export PIBOT_WORKSPACE=/config/workspace
mkdir -p /config/workspace /config/.pibot
exec /usr/bin/node /opt/pibot/computer-service.mjs
