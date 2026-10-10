# syntax=docker/dockerfile:1
# Requires `output: "standalone"` in next.config.ts.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are inlined at build time. Leave empty to use same-origin /api (proxied to the backend).
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# next.config.ts rewrites() are resolved at BUILD time and baked into the standalone server, so the backend
# address must be known here. Use BACKEND_INTERNAL_URL, or BACKEND_INTERNAL_HOSTPORT ("host:port", what
# Render's fromService hostport yields) which gets an http:// prefix.
ARG BACKEND_INTERNAL_URL=""
ARG BACKEND_INTERNAL_HOSTPORT=""
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN if [ -z "$BACKEND_INTERNAL_URL" ]; then       if [ -n "$BACKEND_INTERNAL_HOSTPORT" ]; then BACKEND_INTERNAL_URL="http://$BACKEND_INTERNAL_HOSTPORT";       else BACKEND_INTERNAL_URL="http://backend:8000"; fi;     fi;     export BACKEND_INTERNAL_URL; echo "backend rewrite target: $BACKEND_INTERNAL_URL";     npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    BACKEND_INTERNAL_URL=http://backend:8000
RUN addgroup -S -g 10001 nextjs && adduser -S -u 10001 -G nextjs nextjs
COPY --from=build --chown=nextjs:nextjs /app/public ./public
COPY --from=build --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "server.js"]
