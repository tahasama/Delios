# syntax=docker/dockerfile:1
# Pinned to a release carrying the Brotli fix (CVE-2026-111497); raise it on purpose, never back to a bare 22.
FROM node:22.23.4-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Read when the screens are built: the bot check's public site key (empty: no check).
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
RUN npm run build

# Only what `next start` needs (the standalone output), run as a non-root user.
FROM node:22.23.4-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
