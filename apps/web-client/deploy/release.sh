#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/opt/dsh-remote-web/repo"
WEB_ROOT="/opt/dsh-remote-web"
MODE="${1:-stage}"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Repository not initialized at $REPO_DIR" >&2
  exit 1
fi

case "$MODE" in
  stage)
    git -C "$REPO_DIR" fetch origin main
    git -C "$REPO_DIR" reset --hard origin/main
    COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
    STAGE_REL="$WEB_ROOT/staging-$(date +%Y%m%d%H%M%S)-$COMMIT"
    rm -rf "$STAGE_REL"
    mkdir -p "$STAGE_REL"
    cp -a "$REPO_DIR/apps/web-client/dist" "$STAGE_REL/dist"
    if [[ -d "$WEB_ROOT/current/dist/native/versions" ]]; then
      cp -rn "$WEB_ROOT/current/dist/native/versions/"* "$STAGE_REL/dist/native/versions/" 2>/dev/null || true
    fi
    ln -sfn "$STAGE_REL" "$WEB_ROOT/staging"
    nginx -t
    systemctl reload nginx
    echo "Staged commit $COMMIT -> $STAGE_REL (https://47.102.38.163:5556)"
    ;;
  promote)
    if [[ ! -L "$WEB_ROOT/staging" ]]; then
      echo "No active staging symlink at $WEB_ROOT/staging" >&2
      exit 1
    fi
    STAGE_TARGET="$(readlink -f "$WEB_ROOT/staging")"
    if [[ -L "$WEB_ROOT/current" ]]; then
      PREV_TARGET="$(readlink -f "$WEB_ROOT/current")"
      if [[ "$PREV_TARGET" != "$STAGE_TARGET" ]]; then
        ln -sfn "$PREV_TARGET" "$WEB_ROOT/previous"
      fi
    fi
    ln -sfn "$STAGE_TARGET" "$WEB_ROOT/current"
    nginx -t
    systemctl reload nginx
    echo "Promoted $STAGE_TARGET -> $WEB_ROOT/current (https://47.102.38.163:5555)"
    ;;
  rollback)
    if [[ ! -L "$WEB_ROOT/previous" ]]; then
      echo "No previous release symlink at $WEB_ROOT/previous" >&2
      exit 1
    fi
    PREV_TARGET="$(readlink -f "$WEB_ROOT/previous")"
    ln -sfn "$PREV_TARGET" "$WEB_ROOT/current"
    nginx -t
    systemctl reload nginx
    echo "Rolled back $WEB_ROOT/current -> $PREV_TARGET"
    ;;
  *)
    echo "Usage: $0 {stage|promote|rollback}" >&2
    exit 1
    ;;
esac
