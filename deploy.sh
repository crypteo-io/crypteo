#!/bin/bash
set -e

# ── Crypteo deploy/rollback controller ─────────────────────────────────
# Tag-based, two-version-buffer deploys with rollback. Run on the prod host.
#
#   deploy.sh                  Deploy the latest git tag
#   deploy.sh deploy <tag>     Deploy a specific tag
#   deploy.sh rollback         Roll back to the previously deployed tag
#                              (a deploy that fails its health check rolls
#                              back to the pre-deploy tag on its own)
#   deploy.sh status           Show current/previous versions + container state
#
#   SEED=true deploy.sh ...     Also run `prisma db seed` after migrations
# ─────────────────────────────────────────────────────────────────────────────

# Where this stack is checked out on the host.
APP_DIR="${APP_DIR:-$HOME/crypteo}"
VERSION_FILE="${VERSION_FILE:-$HOME/.crypteo_versions}"
COMPOSE="docker compose -f $APP_DIR/docker-compose.yml"
# Host-wide: never two image builds at once (other stacks on the host can take it too).
BUILD_LOCK="${BUILD_LOCK:-/tmp/vps-docker-build.lock}"
# Locally-built, version-tagged images to prune (postgres/nginx use fixed tags).
IMAGES=("crypteo-app" "crypteo-worker")
# Compose service polled for health after bring-up.
APP_SERVICE="app"

# ── Helpers ──────────────────────────────────────────────────────────────────

load_versions() {
  CURRENT_TAG=""
  PREVIOUS_TAG=""
  if [ -f "$VERSION_FILE" ]; then
    CURRENT_TAG=$(grep "^CURRENT=" "$VERSION_FILE" | cut -d= -f2)
    PREVIOUS_TAG=$(grep "^PREVIOUS=" "$VERSION_FILE" | cut -d= -f2)
  fi
}

save_versions() {
  echo "CURRENT=$1" > "$VERSION_FILE"
  echo "PREVIOUS=$2" >> "$VERSION_FILE"
}

get_latest_tag() {
  cd "$APP_DIR"
  git fetch --tags --force > /dev/null 2>&1
  git tag --sort=-version:refname | head -n1
}

run_migrations() {
  # The `migrate` compose service already runs `prisma migrate deploy` before the
  # app starts. This re-run is an idempotent safety net that surfaces failures.
  echo "==> Running database migrations..."
  $COMPOSE exec -T "$APP_SERVICE" npx prisma migrate deploy

  if [ "${SEED:-false}" = "true" ]; then
    echo "==> Seeding database..."
    # The seed refuses NODE_ENV=production unless told otherwise; SEED=true is
    # that explicit request. In production it only ensures the admin account.
    $COMPOSE exec -T -e SEED_ALLOW_PRODUCTION=true "$APP_SERVICE" npx prisma db seed
  fi
}

# A release is healthy only when the app AND nginx are: a broken nginx config
# (e.g. a missing include) restart-loops nginx while the app looks fine.
wait_for_health() {
  wait_for_service_health "$APP_SERVICE" && wait_for_service_health nginx
}

wait_for_service_health() {
  local service="$1"
  echo "==> Waiting for $service health check..."
  local retries=30
  local cid
  cid=$($COMPOSE ps -q "$service")
  if [ -z "$cid" ]; then
    echo "!!  $service container not found — aborting."
    return 1
  fi

  for i in $(seq 1 "$retries"); do
    local health
    health=$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo "unknown")
    case "$health" in
      healthy)
        echo "    $service is healthy."
        return 0
        ;;
      unhealthy)
        echo "!!  $service reported unhealthy."
        return 1
        ;;
      *)
        printf "    [%s/%s] status=%s\n" "$i" "$retries" "$health"
        sleep 5
        ;;
    esac
  done

  echo "!!  $service did not become healthy in time."
  return 1
}

# Bring the stack up on <tag>'s checkout, reusing its already-built images.
bring_up() {
  local tag="$1"
  # Not fatal: nginx waits on a healthy app, so an unhealthy release makes `up`
  # itself fail. Under `set -e` that would exit before the health check below
  # and skip the automatic rollback — wait_for_health is the verdict.
  if ! APP_VERSION="$tag" $COMPOSE up -d --remove-orphans; then
    echo "!!  compose up reported a failure — deferring to the health check."
  fi
  recreate_if_stale_config "$tag" || true
}

# nginx.conf is a single-file bind mount, which pins the inode it was created
# with. `git checkout` writes a new file rather than editing in place, so a
# running nginx keeps serving the old config — and `nginx -s reload` would just
# re-read the old inode. Compare what the container actually sees with the
# checkout and recreate only when they differ (a recreate is a brief blip).
# Otherwise reload: the snippets are a directory mount, so their new contents
# are visible in place but only take effect on a (graceful) reload.
recreate_if_stale_config() {
  local tag="$1"
  if ! $COMPOSE exec -T nginx cat /etc/nginx/nginx.conf 2>/dev/null |
      cmp -s - "$APP_DIR/nginx/nginx.conf"; then
    echo "==> nginx config changed — recreating nginx..."
    APP_VERSION="$tag" $COMPOSE up -d --force-recreate --no-deps nginx
  else
    $COMPOSE exec -T nginx nginx -s reload
  fi
}

# Return the host to <tag> after a failed deploy: the checkout (bind-mounted
# nginx.conf, backup.sh, compose file) and the containers must agree.
restore_tag() {
  local tag="$1"
  echo "==> Restoring $tag..."
  git checkout "tags/$tag"
  bring_up "$tag"
}

prune_old_images() {
  local keep_current="$1"
  local keep_previous="$2"
  echo "==> Pruning old images (keeping: ${keep_current:-none}, ${keep_previous:-none})..."
  for repo in "${IMAGES[@]}"; do
    while IFS= read -r tag; do
      [ -z "$tag" ] && continue
      [ "$tag" = "<none>" ] && continue
      if [ "$tag" != "$keep_current" ] && [ "$tag" != "$keep_previous" ]; then
        echo "    Removing $repo:$tag"
        docker rmi "$repo:$tag" 2>/dev/null || true
      fi
    done < <(docker images --format "{{.Tag}}" "$repo" | sort -rV)
  done
}

prune_build_cache() {
  echo "==> Pruning build cache older than 7 days..."
  docker builder prune -f --filter "until=168h" > /dev/null 2>&1 || true
}

prune_orphaned_volumes() {
  echo "==> Pruning orphaned anonymous volumes..."
  # This stack's only: the host may run other stacks, whose volumes are
  # never ours to prune.
  docker volume prune -f --filter "label=com.docker.compose.project=crypteo" > /dev/null 2>&1 || true
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd_deploy() {
  local NEW_TAG="$1"
  if [ -z "$NEW_TAG" ]; then
    echo "Usage: deploy.sh deploy <tag>"
    exit 1
  fi

  load_versions
  echo "==> Current: ${CURRENT_TAG:-none} | Previous: ${PREVIOUS_TAG:-none} | Deploying: $NEW_TAG"
  echo ""

  cd "$APP_DIR"
  echo "==> Fetching tags..."
  git fetch --tags --force

  echo "==> Checking out $NEW_TAG..."
  git checkout "tags/$NEW_TAG"

  # Build before touching any container, so a failed build leaves the running
  # release untouched. The checkout still has to go back, though: nginx.conf,
  # backup.sh and the compose file are read from it by the running containers.
  # One image build at a time on the host: it has 4 GB of RAM and also builds
  # another stack on the host that takes the same lock.
  echo "==> Building $NEW_TAG (waiting for $BUILD_LOCK if another build runs)..."
  if ! flock "$BUILD_LOCK" env APP_VERSION="$NEW_TAG" $COMPOSE build; then
    echo "!!  Build of $NEW_TAG failed — nothing was restarted."
    if [ -n "$CURRENT_TAG" ]; then
      echo "==> Checking $CURRENT_TAG back out to match the running containers..."
      git checkout "tags/$CURRENT_TAG"
    fi
    exit 1
  fi

  echo "==> Starting $NEW_TAG..."
  bring_up "$NEW_TAG"

  if ! wait_for_health; then
    echo ""
    echo "!!  Deploy of $NEW_TAG failed health check."
    if [ -z "$CURRENT_TAG" ]; then
      echo "!!  No previously deployed tag to fall back to — manual intervention needed."
      exit 1
    fi
    # Roll back to what was running before this deploy (CURRENT, not PREVIOUS —
    # PREVIOUS is two releases back). Its image was kept by the last prune.
    # Migrations the new tag applied are NOT reverted; they must be backwards
    # compatible for this to be safe.
    restore_tag "$CURRENT_TAG"
    if wait_for_health; then
      echo "!!  Rolled back to $CURRENT_TAG; $NEW_TAG was not recorded as deployed."
    else
      echo "!!  $CURRENT_TAG is also unhealthy after rollback — manual intervention needed."
    fi
    exit 1
  fi

  run_migrations

  prune_old_images "$NEW_TAG" "$CURRENT_TAG"
  prune_build_cache
  prune_orphaned_volumes

  save_versions "$NEW_TAG" "$CURRENT_TAG"

  echo ""
  echo "==> Deploy complete."
  echo "    Current:  $NEW_TAG"
  echo "    Previous: ${CURRENT_TAG:-none} (rollback available)"
}

cmd_rollback() {
  load_versions
  if [ -z "$PREVIOUS_TAG" ]; then
    echo "No previous version recorded. Cannot rollback."
    exit 1
  fi

  echo "==> Rolling back: ${CURRENT_TAG:-none} → $PREVIOUS_TAG"
  echo ""

  cd "$APP_DIR"
  git fetch --tags --force
  git checkout "tags/$PREVIOUS_TAG"

  # Reuse the retained previous image (kept by prune) — no rebuild.
  echo "==> Starting previous image ($PREVIOUS_TAG)..."
  bring_up "$PREVIOUS_TAG"

  if ! wait_for_health; then
    echo "!!  Rollback target $PREVIOUS_TAG is unhealthy — restoring ${CURRENT_TAG:-nothing}."
    if [ -n "$CURRENT_TAG" ]; then
      restore_tag "$CURRENT_TAG"
      wait_for_health || echo "!!  $CURRENT_TAG is unhealthy too — manual intervention needed."
    fi
    exit 1
  fi

  prune_orphaned_volumes
  save_versions "$PREVIOUS_TAG" ""

  echo ""
  echo "==> Rollback complete."
  echo "    Current:  $PREVIOUS_TAG"
  echo "    Previous: none (deploy a new tag to restore the two-version buffer)"
  $COMPOSE ps
}

cmd_status() {
  load_versions
  echo "Current:  ${CURRENT_TAG:-none}"
  echo "Previous: ${PREVIOUS_TAG:-none}"
  echo ""
  $COMPOSE ps
}

# ── Entrypoint ───────────────────────────────────────────────────────────────

case "$1" in
  deploy)
    cmd_deploy "$2"
    ;;
  rollback)
    cmd_rollback
    ;;
  status)
    cmd_status
    ;;
  "")
    echo "==> No tag specified, resolving latest..."
    LATEST=$(get_latest_tag)
    if [ -z "$LATEST" ]; then
      echo "No tags found in repo. Tag a release first."
      exit 1
    fi
    echo "==> Latest tag: $LATEST"
    cmd_deploy "$LATEST"
    ;;
  *)
    echo "Usage:"
    echo "  deploy.sh                  Deploy the latest git tag"
    echo "  deploy.sh deploy <tag>     Deploy a specific tag"
    echo "  deploy.sh rollback         Roll back to the previous tag"
    echo "  deploy.sh status           Show current/previous versions"
    exit 1
    ;;
esac
