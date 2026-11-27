#!/bin/sh
# Builds the release binary and packages it for the Deck's launcher:
#   dist/stompy-rs.tar.gz          the binary
#   dist/stompy-rs.tar.gz.sha256   its checksum, which the launcher also uses as the version
# Run it from deck-rs/, inside an old-glibc environment so the binary runs on every SteamOS 3:
# CI uses Valve's Steam Runtime 3 "sniper" SDK container (glibc 2.31). It installs Rust if it is missing.
set -eu
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  . "$HOME/.cargo/env"
fi
cargo build --release --locked -p stompy
rm -rf dist && mkdir -p dist/pkg
cp target/release/stompy dist/pkg/
git rev-parse --short HEAD > dist/pkg/VERSION 2>/dev/null || echo unknown > dist/pkg/VERSION
tar -czf dist/stompy-rs.tar.gz -C dist/pkg stompy VERSION
(cd dist && sha256sum stompy-rs.tar.gz > stompy-rs.tar.gz.sha256)
echo "glibc needed: $(objdump -T target/release/stompy | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1)"
cat dist/stompy-rs.tar.gz.sha256
