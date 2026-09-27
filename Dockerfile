# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Manifests first so `npm ci` is cached until a dependency changes.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:24-slim

WORKDIR /app

# Reinstall prod-only deps here so better-sqlite3's native binary is built for
# this (glibc/Debian) image rather than copied from the Alpine builder.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/.npmrc ./.npmrc
RUN npm ci --omit=dev && npm cache clean --force

# The startup migration (drizzle-orm migrator) resolves `./drizzle` relative to
# the working directory, so both folders sit directly under /app.
COPY --from=builder /app/build ./build
COPY --from=builder /app/drizzle ./drizzle

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# @sveltejs/adapter-node reads the public origin from $ORIGIN. We expose it
# externally as $BASE_URL (single source for origin/CSRF and magic-link URLs)
# and map it back to $ORIGIN here.
ENTRYPOINT ["/bin/sh", "-c", "if [ -n \"$BASE_URL\" ]; then export ORIGIN=\"$BASE_URL\"; fi; exec \"$@\"", "--"]
CMD ["node", "build/index.js"]
