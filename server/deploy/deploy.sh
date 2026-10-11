#!/bin/sh
# Copies server/ to the relay machine and (re)starts the relay
# (server/deploy/README.md). Run it from anywhere in the repo:
#   server/deploy/deploy.sh root@relay.example.com
# It needs ssh to that machine as root, or as a user who may sudo without a
# password, and rsync on both ends.
set -eu
target=${1:?usage: deploy.sh user@host}
here=$(cd "$(dirname "$0")/.." && pwd)
as_root='S=; [ "$(id -u)" = 0 ] || S=sudo;'

rsync -rlptz --chmod=D755,F644 --delete --exclude __pycache__ --exclude test_server.py \
  --rsync-path="$as_root \$S mkdir -p /opt/stompy/server && \$S rsync" \
  "$here/" "$target:/opt/stompy/server/"

ssh "$target" "$as_root"' set -e
  $S install -m 644 /opt/stompy/server/deploy/stompy-relay.service /etc/systemd/system/stompy-relay.service
  $S systemctl daemon-reload
  $S systemctl enable --quiet stompy-relay
  $S systemctl restart stompy-relay
  grep -qs "^STOMPY_ORIGINS=." /etc/stompy/relay.env ||
    echo "note: no STOMPY_ORIGINS in /etc/stompy/relay.env, so a hosted page cannot connect yet (README step 4)" >&2
  for i in 1 2 3 4 5; do
    sleep 1
    if python3 -c "import urllib.request as u; print(u.urlopen(\"http://127.0.0.1:8096/health\").read().decode())" 2>/dev/null; then exit 0; fi
  done
  echo "the relay did not answer. Its last words:" >&2
  $S journalctl -u stompy-relay -n 30 --no-pager >&2
  exit 1'
echo "deployed to $target"
