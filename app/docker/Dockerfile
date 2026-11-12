FROM node:24.22.3-alpine3.23 AS panel
WORKDIR /opt/caddy-panel
COPY panel/ ./
RUN node --test test/*.test.js

FROM caddy:2.11.9-alpine
COPY --from=panel /usr/local/bin/node /usr/local/bin/node
COPY --from=panel /usr/local/lib/libstdc++.so.6 /usr/local/lib/libstdc++.so.6
COPY --from=panel /usr/local/lib/libgcc_s.so.1 /usr/local/lib/libgcc_s.so.1
COPY --from=panel /opt/caddy-panel /opt/caddy-panel
COPY defaults/panel-start.sh /usr/local/bin/caddy-fpk-panel
COPY panel/cli.js /usr/local/bin/caddy-fpk-init
RUN chmod +x /usr/local/bin/caddy-fpk-panel && node --version
