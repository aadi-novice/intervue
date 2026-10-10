# syntax=docker/dockerfile:1
# Keep the playwright image tag in lockstep with the "playwright" version in package.json (1.64.0).
ARG PLAYWRIGHT_TAG=v1.64.0-noble

# ---- builder: compile TypeScript ----
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_TAG} AS builder
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_TAG}
ENV NODE_ENV=production \
    DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb pulseaudio pulseaudio-utils ffmpeg dumb-init dbus-x11 procps \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Non-root user (the base image ships "pwuser"). It needs audio + a writable home/runtime dir.
RUN usermod -aG audio,pulse,pulse-access pwuser 2>/dev/null || usermod -aG audio pwuser; \
    mkdir -p /tmp/intervue-bot /tmp/runtime && chown -R pwuser:pwuser /tmp/intervue-bot /tmp/runtime /app
USER pwuser
ENV HOME=/home/pwuser \
    XDG_RUNTIME_DIR=/tmp/runtime \
    BOT_MODE=single \
    PULSE_SINK=intervue_sink

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
