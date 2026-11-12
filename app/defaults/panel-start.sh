#!/bin/sh
set -eu
export CADDY_DATA_ROOT=/mnt/caddy
exec node /opt/caddy-panel/server.js
