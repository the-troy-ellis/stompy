// electron-builder's afterPack hook (docs/specs/40-steam-deck.md): the
// packaged app starts through a small launcher script instead of the Electron
// binary itself, because two things have to be decided on the command line,
// before any of the app's JavaScript runs:
//
// 1. X11, not Wayland. Steam's Game Mode runs games in gamescope, which shows
//    X11 windows. Electron picks Wayland whenever a Wayland socket is there,
//    and gamescope has one, so the window went somewhere Game Mode never
//    shows: the owner's first launch sat on a spinning Steam logo
//    (2026-11-12). With an X display, the launcher passes
//    --ozone-platform=x11. STOMPY_WAYLAND=1 skips that.
// 2. The sandbox. Chromium's needs unprivileged user namespaces (an AppImage
//    can't carry the setuid helper). If the system doesn't allow them, or this
//    runs as root, the launcher passes --no-sandbox rather than fail to start.
//    The app only ever loads its own files (main.cjs).
//
// It also keeps the last launch's log: ~/.config/Stompy/stompy.log (the
// previous one as stompy.log.1), with Electron's own output in it.
const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER = `#!/bin/sh
# Stompy's launcher (deck/afterPack.cjs): X11 under gamescope, the sandbox
# the system allows, and a log of the launch.
here="$(dirname "$(readlink -f "$0")")"
dir="\${XDG_CONFIG_HOME:-$HOME/.config}/Stompy"
mkdir -p "$dir" 2>/dev/null
log="$dir/stompy.log"
[ -f "$log" ] && mv -f "$log" "$log.1" 2>/dev/null
flags=""
case " $* " in *" --ozone-platform"*) ;; *)
  if [ -n "$DISPLAY" ] && [ -z "$STOMPY_WAYLAND" ]; then flags="$flags --ozone-platform=x11"; fi ;;
esac
case " $* " in *" --no-sandbox "*) ;; *)
  if [ "$(id -u)" = 0 ] || ! unshare --user --map-root-user true >/dev/null 2>&1; then flags="$flags --no-sandbox"; fi ;;
esac
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) launcher: flags:$flags args: $*" >>"$log" 2>/dev/null
exec "$here/@BIN@" $flags "$@" >>"$log" 2>&1
`;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const name = context.packager.executableName, dir = context.appOutDir;
  const exe = path.join(dir, name), bin = `${name}.bin`;
  fs.renameSync(exe, path.join(dir, bin));
  fs.writeFileSync(exe, LAUNCHER.replace('@BIN@', bin), { mode: 0o755 });
};
