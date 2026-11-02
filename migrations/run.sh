#!/bin/sh
# ─── Crypteo Migration Service ───────────────────────────────────────────
# Runs Prisma migrations on startup, then exits.
# Used as a Docker Compose init service that app and worker depend on.
# ───────────────────────────────────────────────────────────────────────────────

set -e

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "[$TIMESTAMP] Migration service starting..."
echo "[$TIMESTAMP] Database: ${DATABASE_URL%@*}@***"

# Wait for database to be truly ready (not just accepting connections)
MAX_RETRIES=30
RETRY=0
until echo "SELECT 1" | npx prisma db execute --stdin > /dev/null 2>&1; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "[$TIMESTAMP] ERROR: Database not ready after $MAX_RETRIES attempts. Aborting."
    exit 1
  fi
  echo "[$TIMESTAMP] Waiting for database... (attempt $RETRY/$MAX_RETRIES)"
  sleep 2
done

echo "[$TIMESTAMP] Database is ready. Running migrations..."

# Run Prisma migrations
npx prisma migrate deploy

EXIT_CODE=$?
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [ $EXIT_CODE -eq 0 ]; then
  echo "[$TIMESTAMP] Migrations completed successfully."
else
  echo "[$TIMESTAMP] ERROR: Migration failed with exit code $EXIT_CODE"
  exit $EXIT_CODE
fi

# Generate Prisma Client (ensures runtime client matches schema)
npx prisma generate

echo "[$TIMESTAMP] Migration service complete. Exiting."
