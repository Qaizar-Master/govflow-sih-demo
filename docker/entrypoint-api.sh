#!/usr/bin/env bash
# Brings the schema and demo data up to date, then starts the API.
# Safe to run repeatedly: `db push` is declarative and the seed is idempotent.
#
# Compose already gates this container on the Postgres healthcheck, so the retry
# loop below only covers the brief window between "accepting connections" and
# "ready for our first query".
set -euo pipefail

echo "[govflow] applying schema (prisma db push)..."
for attempt in $(seq 1 20); do
  if npx prisma db push --skip-generate --accept-data-loss; then
    break
  fi
  if [ "$attempt" -eq 20 ]; then
    echo "[govflow] could not reach the database after 20 attempts" >&2
    exit 1
  fi
  echo "[govflow] database not ready yet (attempt $attempt) - retrying in 3s"
  sleep 3
done

echo "[govflow] seeding synthetic demo data..."
npx tsx prisma/seed.ts

echo "[govflow] starting API..."
exec npm run start -w @govflow/api
