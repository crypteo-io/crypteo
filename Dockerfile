FROM node:20-alpine

WORKDIR /app

# Install OpenSSL for Prisma and other alpine dependencies
RUN apk add --no-cache openssl libc6-compat curl

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm config set fetch-retry-maxtimeout 600000 && \
    npm ci --legacy-peer-deps

# Copy raw source files
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build Next.js app
ENV NEXT_TELEMETRY_DISABLED=1
ENV AUTH_TRUST_HOST=true
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
# Baked into the build as Next's deploymentId (skew protection). Bump per release.
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION
RUN npm run build
# Runtime is production for every service, including `docker compose exec`
# commands (e.g. the seed, which refuses production unless explicitly allowed).
# Set after the build step: npm ci above must still install devDependencies.
ENV NODE_ENV=production

# Drop root for every service built from this image (app, worker, monitor,
# migrate). The code and dependencies stay root-owned, so a compromised process
# cannot rewrite what it runs; only the paths something writes at runtime are
# handed to `node`:
#   .next                               — next start's image/fetch/ISR cache
#   node_modules/.prisma, @prisma       — the migrate service runs `prisma generate`
# Everything read at runtime from volumes (the nginx access log, the backup
# status file) is written world-readable by its producer, so uid 1000 can read it.
RUN mkdir -p .next/cache node_modules/.prisma && \
    chown -R node:node .next node_modules/.prisma node_modules/@prisma
USER node

# Expose Next.js port
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Default command for the 'app' service
CMD ["npm", "start"]
