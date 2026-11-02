#!/bin/sh
# Nightly logical backup of the payments database.
#
# Correctness note: the previous version piped pg_dump straight into gzip and
# then tested `$?`. In a pipeline that is gzip's status, not pg_dump's — and
# gzip happily succeeds on a truncated or empty stream. A dump that failed
# (auth error, DB down, disk pressure) still produced a small but non-empty
# .gz and was reported as a successful backup. This version captures pg_dump's
# own status, then verifies the artifact before declaring success.

set -eu

# Dumps hold every merchant and payment record: owner-only. The status file is
# made world-readable explicitly below, because the monitor reads it as a
# non-root user.
umask 077

DATE=$(date +%Y%m%d_%H%M%S)
DUMP_FILE=/backups/Crypteo_${DATE}.sql.gz
RAW_FILE=/backups/.Crypteo_${DATE}.sql.part
STATUS_FILE=/backups/last_backup.json

# Machine-readable outcome for the monitor (scripts/monitor.ts), which alerts on
# a failed or stale backup. Written on every path, success or failure —
# a backup that fails silently is the failure mode this whole file guards
# against.
json_safe() {
  # Strip the characters that would produce invalid JSON and leave the monitor
  # unable to parse its own status file (which it would report as a failure).
  printf '%s' "$1" | tr -d '"\\' | tr '\n\r\t' '   '
}

# Offsite copy outcome: "disabled" unless BACKUP_OFFSITE_CMD is set.
OFFSITE_STATUS=disabled
OFFSITE_ERROR=""

write_status() {
  status=$1
  size=$2
  error=$(json_safe "$3")
  offsite_error=$(json_safe "$OFFSITE_ERROR")
  cat > "$STATUS_FILE" <<EOF
{"status":"$status","timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","sizeBytes":$size,"file":"$DUMP_FILE","error":"$error","offsite":"$OFFSITE_STATUS","offsiteError":"$offsite_error"}
EOF
  chmod 644 "$STATUS_FILE"
}

fail() {
  echo "[$(date)] ERROR: $1" >&2
  rm -f "$RAW_FILE" "$DUMP_FILE"
  write_status "failed" 0 "$1"
  exit 1
}

# Checked explicitly: under `set -u` an unset credential aborts the shell at
# expansion time, before any status could be written, and the failure would only
# surface ~26h later as staleness.
for var in POSTGRES_PASSWORD POSTGRES_USER POSTGRES_DB; do
  eval "val=\${$var:-}"
  [ -n "$val" ] || fail "$var is not set in the backup container's environment"
done

echo "[$(date)] Starting backup..."

# Dump to a temp file first so pg_dump's exit status is observable on its own,
# uncoupled from the compression step.
if ! PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h postgres \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --no-owner \
  --no-privileges > "$RAW_FILE" 2> /tmp/pg_dump_err; then
  fail "pg_dump failed: $(tr -d '\"' < /tmp/pg_dump_err | tr '\n' ' ' | cut -c1-300)"
fi

[ -s "$RAW_FILE" ] || fail "pg_dump produced an empty file"

# Sanity-check the dump really contains the payment tables. A dump that
# connected but selected nothing would otherwise pass the size check.
grep -q 'CREATE TABLE public."Payment"' "$RAW_FILE" ||
  fail "dump is missing the Payment table — incomplete or wrong database"

if ! gzip -c "$RAW_FILE" > "$DUMP_FILE"; then
  fail "gzip failed"
fi

# Verify the compressed artifact is readable before trusting it as the restore
# point and deleting older ones.
gzip -t "$DUMP_FILE" || fail "backup archive failed integrity check"

rm -f "$RAW_FILE" /tmp/pg_dump_err

SIZE=$(wc -c < "$DUMP_FILE" | tr -d ' ')
echo "[$(date)] Backup completed: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"

# Optional offsite copy of the verified dump. Everything above keeps restore
# points on this host only, which a lost disk or host takes with it. The
# operator-supplied command gets the dump path as $1 (and $BACKUP_FILE). It runs
# inside `if` so its failure cannot trip `set -e`: it is recorded in the status
# file (the monitor alerts on it) while the local backup still counts as good.
if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
  echo "[$(date)] Copying backup offsite..."
  if BACKUP_FILE="$DUMP_FILE" timeout "${BACKUP_OFFSITE_TIMEOUT:-3600}" \
      sh -c "$BACKUP_OFFSITE_CMD" offsite "$DUMP_FILE" > /tmp/offsite_out 2>&1; then
    OFFSITE_STATUS=ok
    echo "[$(date)] Offsite copy completed"
  else
    rc=$?
    OFFSITE_STATUS=failed
    OFFSITE_ERROR="offsite command exited $rc: $(tail -c 300 /tmp/offsite_out)"
    echo "[$(date)] ERROR: $OFFSITE_ERROR" >&2
  fi
  rm -f /tmp/offsite_out
fi

write_status "ok" "$SIZE" ""

# Prune only after a verified-good backup exists, so a run of failures can never
# erode the existing restore points. The retention floor is a second guard: if
# backups silently stopped for over a week, age-based pruning alone would delete
# every remaining restore point and leave nothing to recover from.
KEEP_MIN=3
TOTAL=$(find /backups -name '*.sql.gz' | wc -l)
DELETED=0

if [ "$TOTAL" -gt "$KEEP_MIN" ]; then
  # Oldest first, never touching the newest $KEEP_MIN.
  for old in $(ls -1t /backups/*.sql.gz 2>/dev/null | tail -n +$((KEEP_MIN + 1))); do
    if [ -n "$(find "$old" -mtime +7 2>/dev/null)" ]; then
      rm -f "$old"
      DELETED=$((DELETED + 1))
    fi
  done
fi
echo "[$(date)] Cleaned up $DELETED old backup(s); $((TOTAL - DELETED)) retained"

# Drop any partials left behind by a previously killed run.
find /backups -name '.Crypteo_*.sql.part' -mtime +1 -delete 2>/dev/null || true
