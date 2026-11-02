# Crypteo Migration Service

This directory contains the migration infrastructure for Crypteo.

## How It Works

The `migrate` service in `docker-compose.yml` runs **before** the app and worker services start. It:

1. Waits for PostgreSQL to be fully ready (with retry logic)
2. Runs `prisma migrate deploy` to apply any pending migrations
3. Runs `prisma generate` to ensure the runtime client matches the schema
4. Exits with code 0 on success, non-zero on failure

The `app` and `worker` services depend on `migrate` with `condition: service_completed_successfully`, so they won't start until migrations are applied.

## Files

- `run.sh` — The migration entrypoint script with retry logic and logging

## Creating New Migrations

Migrations are created locally using Prisma CLI:

```bash
# From within Docker network (or with DATABASE_URL pointing to localhost:5434)
DATABASE_URL="postgresql://user:pass@localhost:5434/Crypteo" npx prisma migrate dev --name my_migration
```

Migration files are stored in `prisma/migrations/` and mounted into the container.

## Manual Migration

To run migrations manually inside the container:

```bash
docker compose run --rm migrate
```
