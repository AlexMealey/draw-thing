# syntax=docker/dockerfile:1
#
# npm only ever runs inside these images; the host needs Docker and nothing else.
#
#   dev      Vite dev server, source bind-mounted by compose      (service "dev")
#   build    production build: tsc, vite, icons, service worker
#   runtime  Caddy serving the built PWA; the image you deploy     (service "app")
#   e2e      Playwright with browsers and their system libraries   (service "e2e")
#   desktop  Rust + Node + WebKitGTK: cargo test and the Linux desktop build (service "desktop")

ARG NODE_VERSION=22
# Keep in sync with @playwright/test in package.json.
ARG PLAYWRIGHT_VERSION=1.64.1
ARG CADDY_VERSION=2.11

# Node stages run on the build machine's own platform: the built app is the same static files for
# every target, so a multi-platform build only varies the Caddy runtime and never emulates npm.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
# Run as the image's "node" user (uid 1000) so files written into the bind-mounted
# source tree (package-lock.json, dist/) belong to a normal host user, not root.
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci

FROM deps AS dev
ENV VITE_HOST=0.0.0.0
EXPOSE 5173 4173
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY --chown=node:node . .
RUN npm run build

FROM caddy:${CADDY_VERSION}-alpine AS runtime
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
# 80/443: the app. 8081: LAN mode hands out the local CA certificate over plain HTTP.
EXPOSE 80 443 443/udp 8081

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS e2e
WORKDIR /app
# The image's "ubuntu" user is uid 1000, so reports land on the host with normal ownership.
RUN chown ubuntu:ubuntu /app
USER ubuntu
COPY --chown=ubuntu:ubuntu package.json package-lock.json ./
RUN --mount=type=cache,target=/home/ubuntu/.npm,uid=1000,gid=1000 npm ci
COPY --chown=ubuntu:ubuntu . .
ENV CI=true
CMD ["npx", "playwright", "test"]

# The Tauri desktop app (src-tauri/). Windows and macOS builds need their own OS (CI does them);
# this image runs the Rust tests and builds the Linux AppImage/deb from WSL or any Linux host.
FROM rust:1-bookworm AS desktop
RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev \
      libssl-dev libxdo-dev file patchelf xdg-utils \
    && rm -rf /var/lib/apt/lists/* \
    && rustup component add clippy rustfmt
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
COPY --from=deps /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
# uid 1000 again, so target/ and the lockfiles belong to the host user. Rustup stays in the
# image; the crate cache goes in a volume (compose.yaml).
# The volume mount points exist first, so Docker creates the volumes owned by builder.
RUN useradd -m -u 1000 builder \
    && mkdir -p /app/node_modules /home/builder/.cargo \
    && chown -R builder:builder /app /home/builder/.cargo
USER builder
ENV CARGO_HOME=/home/builder/.cargo PATH=/home/builder/.cargo/bin:/usr/local/cargo/bin:$PATH
WORKDIR /app
