#!/bin/sh
# Stompy's launcher for the Steam Deck: add this file to Steam as a non-Steam game.
# Each start it asks GitHub whether a newer build exists, downloads it if so, checks it,
# and runs the game. Offline, or if anything fails, it runs the copy it already has.
# Nothing here needs Desktop mode after the first install (docs/deck-setup.md).
REPO="the-troy-ellis/stompy"
URL="${STOMPY_UPDATE_URL:-https://github.com/$REPO/releases/download/deck-latest}"
DIR="${STOMPY_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/stompy-deck}"
PKG="stompy-deck.tar.gz"
mkdir -p "$DIR"
log() { echo "stompy-launch: $*" >&2; }

update() {
  # The published checksum is the version: a different one means a new build.
  want=$(curl -fsSL --max-time 5 "$URL/$PKG.sha256" 2>/dev/null | cut -d' ' -f1)
  case "$want" in
    [0-9a-f]*) ;;
    *) log "no update check (offline?)"; return ;;
  esac
  [ "$want" = "$(cat "$DIR/installed.sha256" 2>/dev/null)" ] && [ -x "$DIR/stompy" ] && return
  tmp=$(mktemp -d) || return
  if curl -fsSL --max-time 120 "$URL/$PKG" -o "$tmp/$PKG" &&
     [ "$(sha256sum "$tmp/$PKG" | cut -d' ' -f1)" = "$want" ] &&
     tar -xzf "$tmp/$PKG" -C "$tmp" stompy VERSION && [ -x "$tmp/stompy" ]; then
    # Swap the new binary in whole, so a half-written file is never run.
    mv "$tmp/stompy" "$DIR/stompy.new" && mv -f "$DIR/stompy.new" "$DIR/stompy" &&
      cp "$tmp/VERSION" "$DIR/VERSION" && echo "$want" > "$DIR/installed.sha256" &&
      log "updated to $(cat "$DIR/VERSION")"
  else
    log "update failed; keeping the installed build"
  fi
  rm -rf "$tmp"
}

[ -n "${STOMPY_NO_UPDATE:-}" ] || update
if [ ! -x "$DIR/stompy" ]; then
  log "no build installed yet, and none could be downloaded"
  exit 1
fi
exec "$DIR/stompy" "$@"
